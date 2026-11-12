/**
 * Fin de l'Embedded Signup v4 avec coexistence (le resto garde son appli WhatsApp Business sur le même numéro).
 * La page /connecter/<jeton> renvoie le code de Meta et les identifiants (WABA, numéro, portefeuille) ; ici, côté
 * serveur, dans l'ordre :
 *   1. échange du code contre le jeton du client (jeton d'utilisateur système d'intégration, propre à ce client) ;
 *   2. jeton gardé CHIFFRÉ (bot_jetons_whatsapp, AES-256-GCM, clé BOT_JETONS_CLE) : jamais en clair, jamais journalisé ;
 *   3. lecture du numéro (numéro affiché, appli WhatsApp Business ou non) ;
 *   4. abonnement de l'app PFlow Bots aux webhooks du compte du client (AVANT la synchronisation : l'historique n'est
 *      envoyé qu'une fois) ;
 *   5. coexistence : synchronisation des contacts puis de l'historique (à faire dans les 24 h, une seule fois) ;
 *      jamais d'enregistrement du numéro (il l'est déjà par l'appli) ;
 *   6. canal créé en « test » (le bot ne répond qu'aux numéros de test tant que Jules ne l'a pas passé en actif) ;
 *   7. les 10 modèles de la livraison créés sur le compte du client (ceux qui existent déjà sont laissés tels quels).
 * Chaque étape est notée (page État). Les étapes 1, 2 et 6 sont indispensables ; les autres sont notées en erreur
 * sans tout arrêter (elles se refont à la main depuis la page État ou WhatsApp Manager).
 */
import { chiffrerJeton } from "@/lib/jetons-chiffres";
import type { Canal, ChannelStore } from "../core/types";
import type { Connexion, ConnexionEtape, ConnexionStore } from "../core/connexions";
import { ANCIENS_NOMS_LIVRAISON, LIVRAISON_TEMPLATES, templateComponents, templatePayload } from "./livraison-templates";

/** Seul numéro de test des canaux créés par l'Embedded Signup : le bot ne répond qu'à Jules tant qu'il est en test. */
export const JULES_TEST_NUMERO = "590690938108";

export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  /** Configuration « WhatsApp Embedded Signup » v4 de Facebook Login for Business. */
  configId: string;
  base: string;
  version: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface SignupInput {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
  /** FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING (coexistence) ou FINISH (parcours classique : le numéro quitte l'appli). */
  evenement: "FINISH" | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
}

export interface SignupDeps {
  meta: MetaAppConfig;
  connexions: ConnexionStore;
  store: Pick<ChannelStore, "ensureCanal">;
  now?: () => Date;
  /** Chiffrement (injecté dans les tests). */
  chiffrer?: (jeton: string) => string;
}

class MetaError extends Error {}

function metaErrorText(json: Record<string, unknown>, status: number): string {
  const e = json.error as { message?: string; code?: number; error_subcode?: number } | undefined;
  return e ? `${e.message ?? "erreur"} (code ${e.code ?? "?"}${e.error_subcode ? `/${e.error_subcode}` : ""})` : `HTTP ${status}`;
}

/** Appel à l'API Graph, borné dans le temps. Le jeton passe en en-tête, jamais dans l'URL (sauf l'échange du code). */
type GraphTarget = Pick<MetaAppConfig, "base" | "version" | "fetch" | "timeoutMs">;

async function graph(meta: GraphTarget, method: "GET" | "POST" | "DELETE", path: string, token: string | null, body?: unknown): Promise<Record<string, unknown>> {
  const doFetch = meta.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), meta.timeoutMs ?? 10_000);
  try {
    const response = await doFetch(`${meta.base.replace(/\/$/, "")}/${meta.version}/${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new MetaError(metaErrorText(json, response.status));
    return json;
  } catch (error) {
    if (error instanceof MetaError) throw error;
    throw new MetaError(`Meta injoignable : ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 1. Le code (valable quelques dizaines de secondes) contre le jeton du client. */
export async function echangerCode(meta: MetaAppConfig, code: string): Promise<{ token: string; type?: string; expiresIn?: number }> {
  const q = new URLSearchParams({ client_id: meta.appId, client_secret: meta.appSecret, code });
  const json = await graph(meta, "GET", `oauth/access_token?${q.toString()}`, null);
  const token = typeof json.access_token === "string" ? json.access_token : "";
  if (!token) throw new MetaError("Meta n'a pas renvoyé de jeton");
  return { token, type: typeof json.token_type === "string" ? json.token_type : undefined, expiresIn: secondes(json.expires_in) };
}

const secondes = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/** Ce que Meta dit d'un jeton (debug_token, avec le jeton de l'app) : échéance et droits réellement accordés. */
export interface JetonInspecte {
  valide: boolean;
  /** null : Meta indique que le jeton n'expire pas (expires_at = 0). */
  expireLe: string | null;
  scopes: string[];
  /** Droits par compte : permission → identifiants des comptes WhatsApp (ou de l'entreprise) concernés. */
  granular: { scope: string; targetIds: string[] }[];
}

export async function inspecterJeton(meta: MetaAppConfig, token: string): Promise<JetonInspecte> {
  // debug_token exige le jeton à examiner en paramètre ; l'appel se fait avec le jeton de l'app (id|secret), en en-tête.
  const json = await graph(meta, "GET", `debug_token?${new URLSearchParams({ input_token: token }).toString()}`, `${meta.appId}|${meta.appSecret}`);
  const d = (json.data ?? {}) as { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: unknown; granular_scopes?: unknown };
  const granular = Array.isArray(d.granular_scopes)
    ? (d.granular_scopes as { scope?: unknown; target_ids?: unknown }[]).map((g) => ({
        scope: String(g.scope ?? ""),
        targetIds: Array.isArray(g.target_ids) ? g.target_ids.map(String) : [],
      }))
    : [];
  return {
    valide: d.is_valid === true,
    expireLe: typeof d.expires_at === "number" && d.expires_at > 0 ? new Date(d.expires_at * 1000).toISOString() : null,
    scopes: Array.isArray(d.scopes) ? d.scopes.map(String) : [],
    granular,
  };
}

/**
 * Renouvelle un jeton d'utilisateur système qui expire (60 jours) : Meta renvoie un NOUVEAU jeton valable 60 jours ;
 * l'ancien reste valable jusqu'à sa propre échéance. Documentation Meta « Install Apps, Generate, Refresh, and Revoke
 * Tokens » : GET oauth/access_token, grant_type=fb_exchange_token, set_token_expires_in_60_days=true.
 */
export async function renouvelerJeton(meta: MetaAppConfig, token: string): Promise<{ token: string; expiresIn?: number }> {
  const q = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: meta.appId,
    client_secret: meta.appSecret,
    set_token_expires_in_60_days: "true",
    fb_exchange_token: token,
  });
  const json = await graph(meta, "GET", `oauth/access_token?${q.toString()}`, null);
  const nouveau = typeof json.access_token === "string" ? json.access_token : "";
  if (!nouveau) throw new MetaError("Meta n'a pas renvoyé de nouveau jeton");
  return { token: nouveau, expiresIn: secondes(json.expires_in) };
}

/** Échéance d'un jeton : d'après la réponse de Meta (expires_in), sinon d'après debug_token. */
export async function echeanceJeton(meta: MetaAppConfig, token: string, expiresIn: number | undefined, now: Date): Promise<{ expireLe: string | null; nExpirePas?: boolean; inspecte?: JetonInspecte }> {
  if (expiresIn) return { expireLe: new Date(now.getTime() + expiresIn * 1000).toISOString() };
  const inspecte = await inspecterJeton(meta, token);
  return inspecte.expireLe ? { expireLe: inspecte.expireLe, inspecte } : { expireLe: null, nExpirePas: true, inspecte };
}

const ID = /^\d{5,30}$/;
export const idsValides = (i: Pick<SignupInput, "wabaId" | "phoneNumberId" | "businessId">) =>
  ID.test(i.wabaId) && ID.test(i.phoneNumberId) && (!i.businessId || ID.test(i.businessId));

/** Déroule la fin de la connexion et met à jour la demande (étapes, état). Renvoie la demande à jour. */
export async function terminerConnexion(deps: SignupDeps, connexion: Connexion, input: SignupInput): Promise<Connexion> {
  const now = () => (deps.now ? deps.now() : new Date());
  const c: Connexion = {
    ...connexion,
    etat: "en_cours",
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    businessId: input.businessId,
    erreur: undefined,
  };
  const note = (etape: string, ok: boolean, detail?: string) => {
    const e: ConnexionEtape = { etape, ok, le: now().toISOString(), ...(detail ? { detail: detail.slice(0, 300) } : {}) };
    c.etapes = [...c.etapes, e];
  };
  const fail = async (message: string) => {
    c.etat = "erreur";
    c.erreur = message.slice(0, 300);
    await deps.connexions.update(c);
    return c;
  };
  await deps.connexions.update(c);
  const coexistence = input.evenement === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";

  // 1. Jeton du client
  let token: string;
  try {
    const t = await echangerCode(deps.meta, input.code);
    token = t.token;
    note("code_echange", true, t.type ? `jeton ${t.type}` : undefined);
    // Échéance du jeton (60 jours avec la configuration de PFlow) et droits réellement accordés (debug_token) :
    // notés, jamais bloquants. Échéance inconnue : la tâche quotidienne (/api/cron/jetons) la redemande à Meta.
    let expiration: { expireLe: string | null; nExpirePas?: boolean } | undefined;
    let inspecte: JetonInspecte | undefined;
    try {
      inspecte = await inspecterJeton(deps.meta, token);
    } catch {
      inspecte = undefined;
    }
    if (t.expiresIn) expiration = { expireLe: new Date(now().getTime() + t.expiresIn * 1000).toISOString() };
    else if (inspecte) expiration = inspecte.expireLe ? { expireLe: inspecte.expireLe } : { expireLe: null, nExpirePas: true };
    note(
      "jeton_echeance",
      true,
      !expiration ? "échéance pas encore lue (la tâche quotidienne la redemande à Meta)"
        : expiration.expireLe ? `expire le ${expiration.expireLe.slice(0, 10)}, renouvelé automatiquement`
        : "n'expire pas",
    );
    if (inspecte) {
      const droits = inspecte.scopes.filter((s) => s.startsWith("whatsapp_") || s === "business_management");
      note("jeton_droits", droits.includes("whatsapp_business_management") && droits.includes("whatsapp_business_messaging"), droits.join(", ") || "aucun droit WhatsApp");
    }
    // 2. Gardé chiffré (indispensable : sans lui, le numéro du client ne peut pas être servi)
    await deps.connexions.saveJeton(input.wabaId, c.restaurantId, (deps.chiffrer ?? chiffrerJeton)(token), t.type, expiration);
    note("jeton_garde", true, "chiffré (AES-256-GCM)");
  } catch (error) {
    note("code_echange", false, (error as Error).message);
    return fail(`Échange du code ou stockage du jeton impossible : ${(error as Error).message}`);
  }

  // 3. Le numéro
  try {
    const n = await graph(deps.meta, "GET", `${input.phoneNumberId}?fields=display_phone_number,verified_name,is_on_biz_app,platform_type`, token);
    c.numeroAffiche = typeof n.display_phone_number === "string" ? n.display_phone_number : undefined;
    note("numero", true, `${c.numeroAffiche ?? "?"}${n.verified_name ? ` · ${n.verified_name}` : ""}${n.is_on_biz_app ? " · appli WhatsApp Business (coexistence)" : ""}`);
  } catch (error) {
    note("numero", false, (error as Error).message);
  }

  // 4. Webhooks du compte du client vers PFlow Bots
  try {
    await graph(deps.meta, "POST", `${input.wabaId}/subscribed_apps`, token);
    note("app_abonnee", true);
  } catch (error) {
    note("app_abonnee", false, (error as Error).message);
  }

  // 5. Coexistence : contacts puis historique (une seule fois, dans les 24 h). Parcours classique : rien à synchroniser,
  //    mais le numéro a quitté l'appli et doit être enregistré (PIN à choisir avec le resto : étape à la main).
  if (coexistence) {
    for (const sync of ["smb_app_state_sync", "history"] as const) {
      try {
        await graph(deps.meta, "POST", `${input.phoneNumberId}/smb_app_data`, token, { messaging_product: "whatsapp", sync_type: sync });
        note(sync === "history" ? "historique_demande" : "contacts_demandes", true);
      } catch (error) {
        note(sync === "history" ? "historique_demande" : "contacts_demandes", false, (error as Error).message);
      }
    }
  } else {
    note("coexistence", false, "Parcours classique : le numéro n'est plus dans l'appli WhatsApp Business. Enregistrement du numéro (PIN) à faire avec le resto.");
  }

  // 6. Canal en test
  try {
    const canal: Omit<Canal, "id"> = {
      restaurantId: c.restaurantId,
      role: "resto",
      plateforme: "whatsapp",
      accountId: input.phoneNumberId,
      wabaId: input.wabaId,
      ...(c.numeroAffiche ? { numeroAffiche: c.numeroAffiche } : {}),
      triggerMode: "toujours",
      coexistence,
      echoPauseHours: 12,
      handoffPauseHours: 24,
      sessionMinutes: 30,
      etat: "test",
      // En test, le bot ne répond qu'à Jules : aucune réponse automatique aux vrais clients du numéro.
      testNumeros: [JULES_TEST_NUMERO],
    };
    const r = await deps.store.ensureCanal(canal);
    c.canalId = r.canal.id;
    note("canal", true, r.created ? "créé en test" : `déjà présent (${r.canal.etat}) : laissé tel quel`);
  } catch (error) {
    note("canal", false, (error as Error).message);
    return fail(`Canal non créé : ${(error as Error).message}`);
  }

  // 7. Modèles de la livraison
  try {
    const r = await modelesLivraison(deps.meta, input.wabaId, token, true);
    const deja = r.etat.filter((t) => t.status && !r.crees.includes(t.name)).length;
    note("modeles_livraison", r.echecs.length === 0, `${r.crees.length} créé(s), ${deja} déjà là${r.echecs.length ? `, ${r.echecs.length} en échec (${r.echecs[0].name} : ${r.echecs[0].erreur})` : ""}`);
  } catch (error) {
    note("modeles_livraison", false, (error as Error).message);
  }

  c.etat = "terminee";
  c.termineLe = now().toISOString();
  const ratees = c.etapes.filter((e) => !e.ok && e.etape !== "coexistence").map((e) => e.etape);
  if (ratees.length) c.erreur = `Terminé, à reprendre à la main : ${ratees.join(", ")}`;
  await deps.connexions.update(c);
  return c;
}

export interface ModelesResultat {
  /**
   * Les 10 modèles de la livraison et leur statut chez Meta (null : absent du compte) ; motif de refus, catégorie
   * retenue par Meta, score de qualité, et si le texte enregistré chez Meta est celui d'aujourd'hui.
   */
  etat: { name: string; status: string | null; motif?: string; categorie?: string; qualite?: string; texteAJour?: boolean; texteMeta?: string; remplace?: string }[];
  /** Anciens noms remplacés par une version _v2 (refusés, gardés chez Meta) : affichés pour information, jamais utilisés. */
  anciens?: { name: string; status: string; motif?: string; texteMeta?: string; remplacePar: string }[];
  crees: string[];
  /** Modèles refusés modifiés avec le texte d'aujourd'hui (renvoyés à l'examen de Meta). */
  corriges?: string[];
  echecs: { name: string; erreur: string }[];
}

type ModeleMeta = { id?: string; status: string; motif?: string; categorie?: string; qualite?: string; texte?: string };

/**
 * Les 10 modèles de la livraison sur un compte WhatsApp Business : leur statut (APPROVED, PENDING, REJECTED…) et, si
 * `creer`, la création des manquants (envoyés à l'examen de Meta). Si `corriger` : les modèles REFUSÉS dont le texte
 * n'est plus celui d'aujourd'hui sont modifiés sur place (POST /{id}, même nom) et renvoyés à l'examen. Un modèle
 * approuvé ou en cours d'examen n'est jamais modifié.
 */
export async function modelesLivraison(target: GraphTarget, wabaId: string, token: string, creer: boolean, corriger = false): Promise<ModelesResultat> {
  const lire = async () => {
    const liste = await graph(target, "GET", `${wabaId}/message_templates?fields=id,name,status,category,rejected_reason,quality_score,language,components&limit=200`, token);
    const parNom = new Map<string, ModeleMeta>();
    type Brut = { id?: string; name?: string; status?: string; category?: string; rejected_reason?: string; quality_score?: { score?: string }; language?: string; components?: { type?: string; text?: string }[] };
    for (const t of (liste.data as Brut[] | undefined) ?? []) {
      if (!t.name || (t.language && t.language !== "fr")) continue;
      const texte = t.components?.find((c) => c.type === "BODY")?.text;
      parNom.set(t.name, {
        status: t.status ?? "?",
        ...(t.id ? { id: t.id } : {}),
        ...(t.rejected_reason && t.rejected_reason !== "NONE" ? { motif: t.rejected_reason } : {}),
        ...(t.category ? { categorie: t.category } : {}),
        ...(t.quality_score?.score && t.quality_score.score !== "UNKNOWN" ? { qualite: t.quality_score.score } : {}),
        ...(texte !== undefined ? { texte } : {}),
      });
    }
    return parNom;
  };
  const avant = await lire();
  const crees: string[] = [];
  const echecs: ModelesResultat["echecs"] = [];
  if (creer) {
    for (const t of LIVRAISON_TEMPLATES) {
      if (avant.has(t.name)) continue;
      try {
        const r = await graph(target, "POST", `${wabaId}/message_templates`, token, templatePayload(t));
        crees.push(t.name);
        avant.set(t.name, { status: typeof r.status === "string" ? r.status : "PENDING" });
      } catch (error) {
        echecs.push({ name: t.name, erreur: (error as Error).message });
      }
    }
  }
  const corriges: string[] = [];
  if (corriger) {
    for (const t of LIVRAISON_TEMPLATES) {
      const m = avant.get(t.name);
      if (!m?.id || m.status !== "REJECTED" || m.texte === t.body) continue;
      try {
        await graph(target, "POST", encodeURIComponent(m.id), token, { category: "UTILITY", components: templateComponents(t) });
        corriges.push(t.name);
        avant.set(t.name, { ...m, status: "PENDING", texte: t.body, motif: undefined });
      } catch (error) {
        const message = (error as Error).message;
        // Meta refuse de modifier un modèle refusé pour sa catégorie : il faut une nouvelle version (nouveau nom, _v2…).
        const bloque = /cat[ée]gor/i.test(message);
        echecs.push({ name: t.name, erreur: bloque ? `Modification bloquée par Meta (catégorie) : il faut une nouvelle version du modèle. Réponse de Meta : ${message}` : message });
      }
    }
  }
  const anciens = ANCIENS_NOMS_LIVRAISON.flatMap((name) => {
    const m = avant.get(name);
    const remplacePar = LIVRAISON_TEMPLATES.find((t) => t.remplace === name)!.name;
    return m ? [{ name, status: m.status, ...(m.motif ? { motif: m.motif } : {}), ...(m.texte !== undefined ? { texteMeta: m.texte } : {}), remplacePar }] : [];
  });
  return {
    etat: LIVRAISON_TEMPLATES.map((t) => {
      const m = avant.get(t.name);
      return {
        name: t.name,
        status: m?.status ?? null,
        ...(m?.motif ? { motif: m.motif } : {}),
        ...(m?.categorie ? { categorie: m.categorie } : {}),
        ...(m?.qualite ? { qualite: m.qualite } : {}),
        ...(m && m.texte !== undefined ? { texteAJour: m.texte === t.body, texteMeta: m.texte } : {}),
        ...(t.remplace ? { remplace: t.remplace } : {}),
      };
    }),
    ...(anciens.length ? { anciens } : {}),
    crees,
    ...(corriger ? { corriges } : {}),
    echecs,
  };
}

/**
 * Débrancher un numéro connecté (par exemple le numéro de la vidéo de l'examen Meta) : désabonnement de l'app aux
 * webhooks du compte du client (avec SON jeton), canal coupé (le bot ne répond plus à personne), jeton effacé.
 * Le gérant garde son appli et son numéro. Côté Meta, il peut aussi retirer PFlow de ses partenaires (voir la doc).
 */
export async function debrancherConnexion(
  deps: { meta: GraphTarget; connexions: ConnexionStore; store: Pick<ChannelStore, "setCanalEtat">; now?: () => Date },
  connexion: Connexion,
  token: string | null,
): Promise<Connexion> {
  const now = () => (deps.now ? deps.now() : new Date());
  const c: Connexion = { ...connexion, etapes: [...connexion.etapes] };
  const note = (etape: string, ok: boolean, detail?: string) => c.etapes.push({ etape, ok, le: now().toISOString(), ...(detail ? { detail: detail.slice(0, 300) } : {}) });
  if (c.wabaId && token) {
    try {
      await graph(deps.meta, "DELETE", `${c.wabaId}/subscribed_apps`, token);
      note("app_desabonnee", true);
    } catch (error) {
      note("app_desabonnee", false, (error as Error).message);
    }
  } else {
    note("app_desabonnee", false, "Jeton du client absent : désabonnement à faire dans les paramètres du portefeuille du client");
  }
  if (c.canalId) {
    try {
      await deps.store.setCanalEtat(c.canalId, "coupe");
      note("canal_coupe", true);
    } catch (error) {
      note("canal_coupe", false, (error as Error).message);
    }
  }
  if (c.wabaId) {
    await deps.connexions.deleteJeton(c.wabaId);
    note("jeton_efface", true);
  }
  c.etat = "debranchee";
  await deps.connexions.update(c);
  return c;
}
