/**
 * Stockage Supabase (étape B). Même format que le stockage du navigateur (WorkspaceData), pour
 * réutiliser toute la logique des repositories :
 * - read() lit les tables bot_ et, en lecture seule, le CRM (restos, horaires, zones, carte) ;
 * - write() compare avec la dernière lecture et n'écrit que les différences, uniquement dans les
 *   tables bot_. Les champs venant du CRM ne sont jamais écrits.
 */
import { DEFAULT_TIMEZONE, type DeliveryRound, type InfoSheet } from "@/engine";
import type { WorkspaceStore } from "../local/store";
import type { AiCallLog, BotClient, BotFolder, BotTemplate, StoredFlow, WorkspaceData } from "../types";
import { stableStringify } from "../types";
import { crmInfoSheet, crmTimezone, readCrm, type CrmSheetField } from "./crm";
import type { Db, Row } from "./db";

/** Appels IA chargés (les plus récents). */
export const AI_CALLS_LIMIT = 1000;
const DEFAULT_TRIGGER = "mots_cles_uniquement";
/** Lectures rapprochées (une page appelle plusieurs repositories) : une seule lecture de la base. */
const CACHE_MS = 4000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (id: string) => UUID.test(id);

interface Snapshot {
  data: WorkspaceData;
  /** Lignes bot_ telles que lues (clé : table → id → ligne), pour n'écrire que les différences. */
  rows: Record<string, Map<string, Row>>;
  locked: Map<string, CrmSheetField[]>;
}

export interface SupabaseStore extends WorkspaceStore {
  /** Champs de la fiche d'infos d'un client qui viennent du CRM (lecture seule). */
  lockedFields(clientId: string): Promise<CrmSheetField[]>;
}

// --- Conversion lignes bot_ ↔ objets de l'app --------------------------------

const toIso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

function templateToRow(t: BotTemplate): Row {
  return { id: t.id, nom: t.name, agent: t.agent ?? null, cree_le: t.createdAt, maj_le: t.updatedAt };
}
function rowToTemplate(r: Row): BotTemplate {
  return {
    id: String(r.id),
    name: String(r.nom),
    ...(r.agent ? { agent: r.agent as BotTemplate["agent"] } : {}),
    createdAt: toIso(r.cree_le)!,
    updatedAt: toIso(r.maj_le)!,
  };
}

function folderToRow(f: BotFolder, templateIds: Set<string>): Row {
  return { id: f.id, proprietaire_type: templateIds.has(f.ownerId) ? "modele" : "client", proprietaire_id: f.ownerId, nom: f.name, ordre: f.order };
}
function rowToFolder(r: Row): BotFolder {
  return { id: String(r.id), ownerId: String(r.proprietaire_id), name: String(r.nom), order: Number(r.ordre) };
}

function flowToRow(f: StoredFlow): Row {
  return {
    id: f.id,
    proprietaire_type: f.ownerKind === "template" ? "modele" : "client",
    proprietaire_id: f.ownerId,
    dossier_id: f.folderId ?? null,
    remplace_flux_modele_id: f.overridesTemplateFlowId ?? null,
    base_version_modele: f.basedOnTemplateVersion ?? null,
    nom: f.name,
    description: f.description ?? null,
    brouillon: f.draft,
    publie: f.published,
    publie_meta: f.publishedMeta,
    publie_le: f.publishedAt,
    version: f.version,
    cree_le: f.createdAt,
    maj_le: f.updatedAt,
  };
}
function rowToFlow(r: Row): StoredFlow {
  return {
    id: String(r.id),
    ownerKind: r.proprietaire_type === "modele" ? "template" : "client",
    ownerId: String(r.proprietaire_id),
    ...(r.dossier_id ? { folderId: String(r.dossier_id) } : {}),
    ...(r.remplace_flux_modele_id ? { overridesTemplateFlowId: String(r.remplace_flux_modele_id) } : {}),
    ...(r.base_version_modele !== null && r.base_version_modele !== undefined ? { basedOnTemplateVersion: Number(r.base_version_modele) } : {}),
    name: String(r.nom),
    ...(r.description ? { description: String(r.description) } : {}),
    draft: r.brouillon as StoredFlow["draft"],
    published: (r.publie as StoredFlow["published"]) ?? null,
    publishedMeta: (r.publie_meta as StoredFlow["publishedMeta"]) ?? null,
    publishedAt: toIso(r.publie_le),
    version: Number(r.version),
    createdAt: toIso(r.cree_le)!,
    updatedAt: toIso(r.maj_le)!,
  };
}

function aiCallToRow(c: AiCallLog): Row {
  return {
    id: c.id,
    restaurant_id: c.clientId,
    cree_le: c.at,
    source: c.source,
    modele: c.model ?? null,
    message: c.message,
    decision: c.decision ?? null,
    usage: c.usage ?? null,
    cout_usd: c.costUsd ?? null,
    erreur: c.error ?? null,
  };
}
function rowToAiCall(r: Row): AiCallLog {
  return {
    id: String(r.id),
    clientId: String(r.restaurant_id),
    at: toIso(r.cree_le)!,
    source: r.source === "whatsapp" ? "whatsapp" : "simulateur",
    ...(r.modele ? { model: String(r.modele) } : {}),
    message: String(r.message),
    ...(r.decision ? { decision: r.decision as AiCallLog["decision"] } : {}),
    ...(r.usage ? { usage: r.usage as AiCallLog["usage"] } : {}),
    ...(r.cout_usd !== null && r.cout_usd !== undefined ? { costUsd: Number(r.cout_usd) } : {}),
    ...(r.erreur ? { error: String(r.erreur) } : {}),
  };
}

/** Partie de la fiche enregistrée côté bot : tout sauf les champs du CRM et les tournées. */
function botSheetPart(sheet: InfoSheet, locked: CrmSheetField[]): Record<string, unknown> {
  const part: Record<string, unknown> = { ...sheet };
  delete part.tournees;
  for (const key of locked) delete part[key];
  for (const [k, v] of Object.entries(part)) if (v === undefined) delete part[k];
  return part;
}

const hhmm = (t: unknown) => (t ? String(t).slice(0, 5) : undefined);

// --- Le stockage -------------------------------------------------------------

export function createSupabaseStore(db: Db, options: { newId?: () => string; now?: () => number } = {}): SupabaseStore {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const clock = options.now ?? (() => Date.now());
  let snapshot: Snapshot | null = null;
  let cachedAt = 0;
  let inflight: Promise<Snapshot> | null = null;

  async function load(): Promise<Snapshot> {
    const [modeles, clients, dossiers, flux, fiches, tournees, appels] = await Promise.all([
      db.select("bot_modeles", "*"),
      db.select("bot_clients", "*"),
      db.select("bot_dossiers", "*"),
      db.select("bot_flux", "*"),
      db.select("bot_fiches", "*"),
      db.select("bot_tournees", "*", { order: { column: "date" } }),
      db.select("bot_appels_ia", "*", { order: { column: "cree_le", ascending: false }, limit: AI_CALLS_LIMIT }),
    ]);
    const crm = await readCrm(db, clients.map((c) => String(c.restaurant_id)));

    const botClients = new Map(clients.map((c) => [String(c.restaurant_id), c]));
    const fichesById = new Map(fiches.map((f) => [String(f.restaurant_id), f]));
    const locked = new Map<string, CrmSheetField[]>();
    const data: WorkspaceData = { clients: [], flows: [], folders: [], templates: [], infoSheets: {}, aiCalls: [] };

    for (const r of crm.restaurants) {
      const bc = botClients.get(r.id);
      const client: BotClient = {
        id: r.id,
        nomResto: r.nom,
        orderSlug: r.slug ?? "",
        timezone: crmTimezone(r) || DEFAULT_TIMEZONE,
        triggerMode: (bc?.mode_declenchement as BotClient["triggerMode"]) ?? DEFAULT_TRIGGER,
        ...(bc?.modele_id ? { template: { templateId: String(bc.modele_id), linkedAt: toIso(bc.lie_le) ?? toIso(bc.cree_le)! } } : {}),
        // Pas de modèle mais une date de lien : convention pour « bot désactivé » (sans nouvelle colonne).
        ...(bc && !bc.modele_id && bc.lie_le ? { botDisabledAt: toIso(bc.lie_le)! } : {}),
        ...(bc ? { hasBotRecord: true } : {}),
        options: { panier_abandonne: crm.relance.has(r.id) },
        crmStatut: r.statut,
        createdAt: toIso(bc?.cree_le) ?? toIso(r.created_at)!,
        updatedAt: toIso(bc?.maj_le) ?? toIso(r.created_at)!,
      };
      data.clients.push(client);

      const fromCrm = crmInfoSheet(r, crm);
      locked.set(r.id, fromCrm.locked);
      const botPart = (fichesById.get(r.id)?.donnees as Partial<InfoSheet> | undefined) ?? {};
      const rounds: DeliveryRound[] = tournees
        .filter((t) => String(t.restaurant_id) === r.id)
        .map((t) => ({ id: String(t.id), date: String(t.date).slice(0, 10), ...(t.de ? { de: hhmm(t.de) } : {}), ...(t.a ? { a: hhmm(t.a) } : {}), lieux: String(t.lieux) }));
      data.infoSheets[r.id] = {
        horaires: [],
        ...botPart,
        ...fromCrm.sheet,
        ...(rounds.length ? { tournees: rounds } : {}),
      };
    }
    const visible = new Set(data.clients.map((c) => c.id));

    data.templates = modeles.map(rowToTemplate);
    const owners = new Set([...visible, ...data.templates.map((t) => t.id)]);
    data.folders = dossiers.map(rowToFolder).filter((f) => owners.has(f.ownerId));
    data.flows = flux.map(rowToFlow).filter((f) => owners.has(f.ownerId));
    data.aiCalls = appels.map(rowToAiCall).filter((c) => visible.has(c.clientId)).reverse();

    // Lignes de référence pour le calcul des différences (seulement ce qui est visible).
    const index = (rows: Row[], key = "id") => new Map(rows.map((r) => [String(r[key]), r]));
    const rows: Snapshot["rows"] = {
      bot_modeles: index(data.templates.map(templateToRow)),
      bot_clients: index(clients.filter((c) => visible.has(String(c.restaurant_id))).map(clientRowOf), "restaurant_id"),
      bot_dossiers: index(data.folders.map((f) => folderToRow(f, new Set(data.templates.map((t) => t.id))))),
      bot_flux: index(data.flows.map(flowToRow)),
      bot_fiches: index(
        fiches.filter((f) => visible.has(String(f.restaurant_id))).map((f) => ({ restaurant_id: f.restaurant_id, donnees: f.donnees })),
        "restaurant_id",
      ),
      bot_tournees: index(tournees.filter((t) => visible.has(String(t.restaurant_id))).map(tourneeRowOf)),
      bot_appels_ia: index(data.aiCalls.map(aiCallToRow)),
    };
    return { data, rows, locked };
  }

  function clientRowOf(c: Row): Row {
    return { restaurant_id: c.restaurant_id, mode_declenchement: c.mode_declenchement, modele_id: c.modele_id ?? null, lie_le: toIso(c.lie_le) };
  }
  function tourneeRowOf(t: Row): Row {
    return { id: t.id, restaurant_id: t.restaurant_id, date: String(t.date).slice(0, 10), de: hhmm(t.de) ?? null, a: hhmm(t.a) ?? null, lieux: t.lieux };
  }

  async function fresh(): Promise<Snapshot> {
    if (snapshot && clock() - cachedAt < CACHE_MS) return snapshot;
    inflight ??= load().finally(() => {
      inflight = null;
    });
    const loaded = await inflight;
    snapshot = loaded;
    cachedAt = clock();
    return loaded;
  }

  /** Lignes bot_ attendues pour les données de l'app. */
  function rowsOf(data: WorkspaceData, locked: Map<string, CrmSheetField[]>): Snapshot["rows"] {
    const templateIds = new Set(data.templates.map((t) => t.id));
    const index = (rows: Row[], key = "id") => new Map(rows.map((r) => [String(r[key]), r]));
    const owned = new Set(data.flows.map((f) => f.ownerId));

    const clientRows: Row[] = [];
    const ficheRows: Row[] = [];
    const tourneeRows: Row[] = [];
    for (const c of data.clients) {
      const sheet = data.infoSheets[c.id] ?? { horaires: [] };
      const part = botSheetPart(sheet, locked.get(c.id) ?? []);
      const rounds = (sheet.tournees ?? []).map((t) => ({
        id: isUuid(t.id) ? t.id : newId(),
        restaurant_id: c.id,
        date: t.date,
        de: t.de ?? null,
        a: t.a ?? null,
        lieux: t.lieux,
      }));
      const hasSheet = Object.entries(part).some(([k, v]) => !(k === "horaires" && Array.isArray(v) && v.length === 0));
      // Une ligne existante est toujours gardée : sans elle, le bot serait recréé automatiquement.
      const hasBot =
        Boolean(c.template) || Boolean(c.botDisabledAt) || Boolean(c.hasBotRecord) || c.triggerMode !== DEFAULT_TRIGGER || owned.has(c.id) || hasSheet || rounds.length > 0;
      if (hasBot) {
        clientRows.push({
          restaurant_id: c.id,
          mode_declenchement: c.triggerMode,
          modele_id: c.template?.templateId ?? null,
          lie_le: c.template?.linkedAt ?? c.botDisabledAt ?? null,
        });
      }
      if (hasSheet) ficheRows.push({ restaurant_id: c.id, donnees: part });
      tourneeRows.push(...rounds);
    }
    return {
      bot_modeles: index(data.templates.map(templateToRow)),
      bot_clients: index(clientRows, "restaurant_id"),
      bot_dossiers: index(data.folders.map((f) => folderToRow(f, templateIds))),
      bot_flux: index(data.flows.map(flowToRow)),
      bot_fiches: index(ficheRows, "restaurant_id"),
      bot_tournees: index(tourneeRows),
      bot_appels_ia: index(data.aiCalls.map(aiCallToRow)),
    };
  }

  /** Comparaison sans tenir compte des horodatages de création (format variable selon la base). */
  const same = (a: Row, b: Row) => {
    const strip = (r: Row) => {
      const copy = { ...r };
      delete copy.cree_le;
      for (const k of ["maj_le", "publie_le", "lie_le"]) if (copy[k]) copy[k] = toIso(copy[k]);
      return copy;
    };
    return stableStringify(strip(a)) === stableStringify(strip(b));
  };

  // Ordre des écritures : parents avant enfants ; suppressions dans l'ordre inverse.
  const ORDER: { table: string; key: string }[] = [
    { table: "bot_modeles", key: "id" },
    { table: "bot_clients", key: "restaurant_id" },
    { table: "bot_dossiers", key: "id" },
    { table: "bot_flux", key: "id" },
    { table: "bot_fiches", key: "restaurant_id" },
    { table: "bot_tournees", key: "id" },
    { table: "bot_appels_ia", key: "id" },
  ];

  return {
    async read() {
      return structuredClone((await fresh()).data);
    },

    async write(data) {
      const base = await fresh();
      const before = base.rows;
      const after = rowsOf(data, base.locked);

      for (const { table, key } of ORDER) {
        const changed = [...after[table].values()].filter((row) => {
          const old = before[table].get(String(row[key]));
          return !old || !same(old, row);
        });
        if (changed.length) await db.upsert(table, changed, key);
      }
      for (const { table, key } of [...ORDER].reverse()) {
        // On ne supprime que des lignes lues et visibles (jamais de ligne inconnue).
        const removed = [...before[table].keys()].filter((id) => !after[table].has(id));
        if (removed.length) await db.remove(table, key, removed);
      }

      // Les données écrites deviennent la nouvelle référence (les tournées reprennent leurs vrais ids).
      const next = structuredClone(data);
      for (const [clientId, sheet] of Object.entries(next.infoSheets)) {
        if (sheet.tournees) {
          const ids = [...after.bot_tournees.values()].filter((t) => t.restaurant_id === clientId).map((t) => String(t.id));
          sheet.tournees = sheet.tournees.map((t, i) => ({ ...t, id: ids[i] ?? t.id }));
        }
      }
      snapshot = { data: next, rows: after, locked: base.locked };
      cachedAt = clock();
    },

    async lockedFields(clientId) {
      return (await fresh()).locked.get(clientId) ?? [];
    },
  };
}
