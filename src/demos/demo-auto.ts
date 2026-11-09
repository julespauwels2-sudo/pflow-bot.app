/**
 * Démo permanente automatique (numéro PFlow Démo) : le parcours avance tout seul, comme le vrai produit.
 *
 * 1. Les liens [Je commande] et [Voir le dashboard] envoyés par le bot portent un jeton propre au contact
 *    (demo-token.ts : chiffré, 24 h, ne vaut que pour ce contact) : variables {{demo_lien_commande}} et
 *    {{demo_lien_dashboard}} (demoLinks, appelé par le processeur).
 * 2. La page de commande de démo (CRM) envoie la commande validée : POST /api/demo/commande → handleDemoOrder :
 *    confirmation « Commande enregistrée » (comme un vrai client PFlow Order, « commande de démo, rien n'est
 *    préparé »), puis l'étape 2/3.
 * 3. Le lien du dashboard passe par GET /api/demo/dashboard/<jeton> → handleDemoDashboard : l'ouverture est notée
 *    et l'étape 3/3 programmée (DEMO_ETAPE3 secondes plus tard), puis redirection vers le dashboard de démo (avec
 *    la commande du prospect après le #, jamais envoyée au serveur du CRM).
 * 4. La tâche planifiée à la minute (GET /api/cron/demo) → runDemoDue envoie les étapes 3/3 dues. Elle marche même
 *    si le prospect a fermé l'onglet.
 *
 * Garde-fous : jeton faux, altéré ou expiré → refus ; il n'écrit qu'au contact du jeton, sur le canal PFlow ;
 * 3 confirmations au plus par heure et par contact ; une même commande n'est confirmée qu'une fois ; rien n'est
 * envoyé à un contact en pause (Jules a la main) ; l'étape 3/3 n'est jamais envoyée deux fois. Isolation : aucun
 * appel à Stripe ni à PFlow Order, aucune alerte ; tout passe par le canal PFlow Démo (rôle « pflow »).
 */
import { z } from "zod";
import { runEngine, type IncomingMessage } from "@/engine";
import type { Canal, ChannelContact, ChannelSender, ChannelStore } from "@/channels/core/types";
import { sendOptions } from "@/channels/core/send-options";
import { DEFAULT_DEMO_VARS, DEMO_PERMANENTE, PFLOW_FLOWS, pflowBaseBot } from "./pflow-bot";
import { nextParcours, type DemoOrderSnapshot, type ParcoursState } from "./parcours";
import { createDemoToken, readDemoToken } from "./demo-token";

/** Délai par défaut entre l'ouverture du dashboard et l'étape 3/3 (variable PFLOW_DEMO_ETAPE3_SECONDES). */
export const DEMO_ETAPE3_DEFAULT_SECONDS = 20;
export const DEMO_ETAPE3_MIN_SECONDS = 10;
export const DEMO_ETAPE3_MAX_SECONDS = 900;
/** Confirmations de commande de démo au plus, par contact et par heure. */
export const DEMO_CONFIRMATIONS_PER_HOUR = 3;
/** Adresse publique de PFlow Bots par défaut (redirection du dashboard). */
export const DEFAULT_BOTS_URL = "https://pflow-bot-app.vercel.app";
/** Seuls ces sites peuvent envoyer une commande de démo (CORS). */
export const DEMO_ORDER_ORIGINS = ["https://order.pflow.fr"];

const MAX_TYPING_MS = 2000;

export function etape3Seconds(raw: string | undefined): number {
  const n = Number(raw);
  if (!raw?.trim() || !Number.isFinite(n)) return DEMO_ETAPE3_DEFAULT_SECONDS;
  return Math.min(DEMO_ETAPE3_MAX_SECONDS, Math.max(DEMO_ETAPE3_MIN_SECONDS, Math.round(n)));
}

/** Liens de la démo permanente pour ce contact (avec son jeton). Sans secret : les liens simples. */
export function demoLinks(contact: { id: string }, canalId: string, secret: string | undefined, botsUrl: string, now: Date): Record<string, string> {
  if (!secret) return { ...DEFAULT_DEMO_VARS };
  const token = createDemoToken({ contactId: contact.id, canalId }, secret, Math.floor(now.getTime() / 1000));
  return {
    ...DEFAULT_DEMO_VARS,
    demo_lien_commande: `${DEMO_PERMANENTE.commandeUrl}&j=${token}`,
    demo_lien_dashboard: `${botsUrl.replace(/\/+$/, "")}/api/demo/dashboard/${token}`,
  };
}

export interface DemoAutoDeps {
  store: ChannelStore;
  graph: ChannelSender;
  secret: string | undefined;
  botsUrl: string;
  etape3Seconds: number;
  now?(): Date;
  sleep?(ms: number): Promise<void>;
}

type Resolved = { canal: Canal; contact: ChannelContact } | { error: string; status: number };

async function resolveToken(deps: DemoAutoDeps, token: string, now: Date): Promise<Resolved> {
  if (!deps.secret) return { error: "démo automatique inactive (PFLOW_BOTS_SECRET)", status: 503 };
  const payload = readDemoToken(token, deps.secret, Math.floor(now.getTime() / 1000));
  if (!payload) return { error: "jeton invalide ou expiré", status: 403 };
  const canal = (await deps.store.listCanaux()).find((c) => c.id === payload.canalId);
  if (!canal || canal.role !== "pflow" || canal.plateforme !== "whatsapp" || canal.etat === "coupe") return { error: "canal indisponible", status: 403 };
  const contact = await deps.store.getContact(payload.contactId);
  if (!contact || contact.canalId !== canal.id) return { error: "contact inconnu", status: 403 };
  if (canal.etat === "test" && !canal.testNumeros.includes(contact.waId)) return { error: "canal en test", status: 403 };
  return { canal, contact };
}

const paused = (contact: ChannelContact, now: Date) => {
  const p = contact.state.pause;
  return Boolean(p && (p.until === null || Date.parse(p.until) > now.getTime()));
};

/** Joue un message pour le bot PFlow de base de ce contact et envoie les réponses (comme le processeur). */
async function play(deps: DemoAutoDeps, canal: Canal, contact: ChannelContact, message: IncomingMessage, now: Date, parcoursPatch: (p: ParcoursState | undefined) => ParcoursState | undefined) {
  const bot = pflowBaseBot();
  bot.client.vars = demoLinks(contact, canal.id, deps.secret, deps.botsUrl, now);
  const stored = await deps.store.getSession(contact.id);
  const result = await runEngine({
    now,
    client: bot.client,
    channel: {
      id: canal.id,
      clientId: bot.client.id,
      triggerMode: "toujours",
      echoPauseHours: canal.echoPauseHours,
      handoffPauseHours: canal.handoffPauseHours,
      sessionTimeoutMinutes: canal.sessionMinutes,
      aiDailyLimitPerContact: 0,
    },
    flows: bot.flows,
    infoSheet: bot.infoSheet,
    contact: contact.state,
    session: stored?.session ?? null,
    message,
  }, {});
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let sent = 0;
  const errors: string[] = [];
  for (const out of result.outgoing) {
    if (out.kind === "typing") {
      await sleep(Math.min(out.ms, MAX_TYPING_MS));
      continue;
    }
    try {
      const wamid = await deps.graph.send(canal.accountId, contact.waId, out, sendOptions(canal));
      await deps.store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "bot", wamid, type: out.kind, contenu: out, statut: "envoye" });
      sent += 1;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(msg);
      await deps.store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "bot", type: out.kind, contenu: out, statut: "echec", erreur: msg });
    }
  }
  const parcours = parcoursPatch(nextParcours(contact.demo?.parcours, result.events, now));
  const demo = { ...(contact.demo ?? { clientId: "", lastAt: now.toISOString(), visited: [] }), ...(parcours ? { parcours } : {}) };
  await deps.store.saveContact({ ...contact, state: result.contact, demo });
  await deps.store.saveSession(contact.id, result.session, stored?.version ?? null);
  return { sent, errors, ignored: result.events.find((e) => e.type === "ignored") };
}

// ---------------------------------------------------------------------------
// Commande de démo validée (POST /api/demo/commande)
// ---------------------------------------------------------------------------

const clean = (max: number) =>
  z
    .string()
    .transform((s) =>
      s
        .replace(/https?:\/\/\S+|www\.\S+/gi, "") // jamais de lien dans un message envoyé par PFlow
        .replace(/[\u0000-\u001f\u007f*_~`]/g, " ") // ni contrôle ni mise en forme WhatsApp
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max),
    );
const money = z.coerce.number().finite().min(0).max(10_000);

export const demoOrderSchema = z.object({
  jeton: z.string().min(10).max(400),
  commande: z.object({
    numero: z.coerce.number().int().min(1).max(99_999),
    mode: z.enum(["livraison", "retrait"]).catch("retrait"),
    total: money,
    creneau: clean(60).nullish(),
    client_nom: clean(40).nullish(),
    articles: z
      .array(
        z.object({
          nom: clean(80),
          qte: z.coerce.number().int().min(1).max(99),
          prix: money,
          total: money.optional(),
          supplements: z.array(z.object({ nom: clean(60), prix: money.catch(0), groupe: clean(40).nullish() })).max(12).catch([]),
        }),
      )
      .min(1)
      .max(25),
  }),
});
export type DemoOrderBody = z.infer<typeof demoOrderSchema>;

const euros = (n: number) => `${n.toFixed(2).replace(".", ",").replace(/,00$/, "")} €`;

/** « 1× Burger + frites + boisson — 19,90 €\n   Spicy Matcha, Citronnade maison, + Supplément steak » */
export function formatDemoRecap(order: DemoOrderBody["commande"]): string {
  return order.articles
    .filter((a) => a.nom)
    .map((a) => {
      const options = a.supplements.filter((s) => s.nom).map((s) => (s.groupe && !(s.prix > 0) ? s.nom : `+ ${s.nom}`));
      const total = a.total ?? (a.prix + a.supplements.reduce((t, s) => t + s.prix, 0)) * a.qte;
      return `• ${a.qte}× ${a.nom} — ${euros(total)}${options.length ? `\n   ${options.join(", ")}` : ""}`;
    })
    .join("\n");
}

export type DemoOrderResult =
  | { ok: true; envoye: true }
  | { ok: true; envoye: false; raison: "deja_confirmee" | "pause" | "fenetre_fermee" }
  | { ok: false; status: number; erreur: string };

export async function handleDemoOrder(deps: DemoAutoDeps, input: unknown): Promise<DemoOrderResult> {
  const now = deps.now ? deps.now() : new Date();
  const parsed = demoOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, erreur: "commande illisible" };
  const { jeton, commande } = parsed.data;
  const found = await resolveToken(deps, jeton, now);
  if ("error" in found) return { ok: false, status: found.status, erreur: found.error };
  const { canal, contact } = found;
  if (paused(contact, now)) return { ok: true, envoye: false, raison: "pause" };

  const recent = (contact.demo?.parcours?.confirmations ?? []).filter((t) => now.getTime() - Date.parse(t) < 3_600_000);
  if (recent.length >= DEMO_CONFIRMATIONS_PER_HOUR) return { ok: false, status: 429, erreur: "trop de commandes de démo, réessayez plus tard" };
  if (!(await deps.store.claimEvent("pflow_order", `demo-commande:${contact.id}:${commande.numero}`, { demo: true, numero: commande.numero }))) {
    return { ok: true, envoye: false, raison: "deja_confirmee" };
  }

  const snapshot: DemoOrderSnapshot = {
    id: `wa-${commande.numero}`,
    le: now.getTime(),
    resto: DEMO_PERMANENTE.nomResto,
    numero: commande.numero,
    client_nom: commande.client_nom || null,
    mode: commande.mode,
    adresse: null,
    creneau: commande.creneau || null,
    note: null,
    total: commande.total,
    articles: commande.articles.map((a) => ({
      nom: a.nom,
      qte: a.qte,
      prix: a.prix,
      total: a.total ?? a.prix * a.qte,
      supplements: a.supplements.map((s) => ({ nom: s.nom, prix: s.prix, ...(s.groupe ? { groupe: s.groupe } : {}) })),
    })),
  };
  const data = {
    commande_numero: String(commande.numero),
    commande_mode: commande.mode === "livraison" ? "en livraison" : "à emporter",
    commande_recap: formatDemoRecap(commande),
    commande_total: euros(commande.total),
    client_nom: commande.client_nom || "",
  };
  const played = await play(deps, canal, contact, { kind: "event", event: "commande_validee", data }, now, (p) =>
    p ? { ...p, confirmations: [...recent, now.toISOString()], derniereCommande: snapshot } : p,
  );
  if (played.sent === 0) {
    const reason = played.ignored && "reason" in played.ignored ? played.ignored.reason : "";
    await deps.store.finishEvent("pflow_order", `demo-commande:${contact.id}:${commande.numero}`, reason || played.errors[0] || "rien envoyé");
    if (reason === "fenetre_fermee") return { ok: true, envoye: false, raison: "fenetre_fermee" };
    return { ok: false, status: 502, erreur: "envoi WhatsApp impossible" };
  }
  await deps.store.finishEvent("pflow_order", `demo-commande:${contact.id}:${commande.numero}`, played.errors[0]);
  return { ok: true, envoye: true };
}

// ---------------------------------------------------------------------------
// Ouverture du dashboard (GET /api/demo/dashboard/<jeton>)
// ---------------------------------------------------------------------------

/** La commande dans l'adresse du dashboard de démo (#commande=…, format de js/demo-commun.js du CRM). */
export function dashboardUrlWithOrder(order: DemoOrderSnapshot | undefined): string {
  if (!order) return DEMO_PERMANENTE.dashboardUrl;
  return `${DEMO_PERMANENTE.dashboardUrl}#commande=${Buffer.from(JSON.stringify(order), "utf8").toString("base64url")}`;
}

/** Programme l'étape 3/3 et renvoie l'adresse du dashboard. Ne bloque jamais le prospect (jeton faux : dashboard simple). */
export async function handleDemoDashboard(
  deps: DemoAutoDeps,
  token: string,
): Promise<{ redirect: string; programmee: boolean; raison?: string; contactId?: string; due?: string }> {
  const now = deps.now ? deps.now() : new Date();
  const found = await resolveToken(deps, token, now);
  if ("error" in found) return { redirect: DEMO_PERMANENTE.dashboardUrl, programmee: false, raison: found.error };
  const { contact } = found;
  const parcours = contact.demo?.parcours;
  const redirect = dashboardUrlWithOrder(parcours?.derniereCommande);
  if (!parcours) return { redirect, programmee: false, raison: "pas de parcours" };
  if (parcours.etape >= 3 || parcours.etape3EnvoyeeAt) return { redirect, programmee: false, raison: "étape 3 déjà envoyée" };
  if (parcours.etape3Due) return { redirect, programmee: false, raison: "déjà programmée" };
  const due = new Date(now.getTime() + deps.etape3Seconds * 1000).toISOString();
  await deps.store.saveContact({ ...contact, demo: { ...contact.demo!, parcours: { ...parcours, etape3Due: due } } });
  return { redirect, programmee: true, contactId: contact.id, due };
}

/** Attente maximale dans la route du dashboard (la fonction a 300 s au plus). */
export const MAX_INLINE_WAIT_MS = 240_000;

/**
 * Envoi de l'étape 3/3 à l'heure dite, depuis la route du dashboard (après la réponse, `after` de Next.js : la
 * fonction reste active le temps de l'attente). La tâche à la minute reste le filet de sécurité ; la clé unique
 * « demo-etape3:<contact>:<échéance> » empêche tout double envoi entre les deux.
 */
export async function sendEtape3WhenDue(deps: DemoAutoDeps, contactId: string, due: string, sleep: (ms: number) => Promise<void>): Promise<DemoDueReport> {
  const now = deps.now ? deps.now() : new Date();
  const wait = Date.parse(due) - now.getTime();
  // Échéance lointaine (réglage de plusieurs minutes) : la tâche à la minute s'en charge.
  if (wait > MAX_INLINE_WAIT_MS) return { envoyees: 0, ignorees: [{ contact: contactId.slice(0, 8), raison: "échéance lointaine : tâche à la minute" }] };
  if (wait > 0) await sleep(wait + 250);
  return runDemoDue(deps, { contactId });
}

// ---------------------------------------------------------------------------
// Tâche planifiée à la minute (GET /api/cron/demo)
// ---------------------------------------------------------------------------

export interface DemoDueReport {
  envoyees: number;
  ignorees: { contact: string; raison: string }[];
}

export async function runDemoDue(deps: DemoAutoDeps, only?: { contactId: string }): Promise<DemoDueReport> {
  const now = deps.now ? deps.now() : new Date();
  const report: DemoDueReport = { envoyees: 0, ignorees: [] };
  const canaux = (await deps.store.listCanaux()).filter((c) => c.role === "pflow" && c.plateforme === "whatsapp" && c.etat !== "coupe");
  for (const canal of canaux) {
    // Un seul contact (envoi à ~20 s depuis la route du dashboard) : relu juste avant, état à jour.
    const contacts = only ? [await deps.store.getContact(only.contactId)].filter((c): c is NonNullable<typeof c> => Boolean(c && c.canalId === canal.id)) : await deps.store.listContacts(canal.id);
    for (const contact of contacts) {
      const parcours = contact.demo?.parcours;
      if (!parcours?.etape3Due || Date.parse(parcours.etape3Due) > now.getTime()) continue;
      const short = contact.id.slice(0, 8);
      const done = (raison: string, patch: Partial<ParcoursState> = {}) => {
        const { etape3Due: _due, ...rest } = parcours;
        void _due;
        report.ignorees.push({ contact: short, raison });
        return deps.store.saveContact({ ...contact, demo: { ...contact.demo!, parcours: { ...rest, ...patch } } });
      };
      if (parcours.etape >= 3 || parcours.etape3EnvoyeeAt) {
        await done("étape 3 déjà envoyée");
        continue;
      }
      if (paused(contact, now)) {
        await done("contact en pause (Jules a la main)");
        continue;
      }
      if (canal.etat === "test" && !canal.testNumeros.includes(contact.waId)) {
        await done("canal en test, numéro hors liste");
        continue;
      }
      // Jamais deux fois, même si deux tâches se croisent.
      if (!(await deps.store.claimEvent("pflow_order", `demo-etape3:${contact.id}:${parcours.etape3Due}`, { demo: true }))) continue;
      const played = await play(deps, canal, contact, { kind: "start_flow", flowId: PFLOW_FLOWS.etape3 }, now, (p) => {
        if (!p) return p;
        const { etape3Due: _due, ...rest } = p;
        void _due;
        return { ...rest, etape3EnvoyeeAt: now.toISOString() };
      });
      await deps.store.finishEvent("pflow_order", `demo-etape3:${contact.id}:${parcours.etape3Due}`, played.errors[0]);
      if (played.sent > 0) report.envoyees += 1;
      else report.ignorees.push({ contact: short, raison: played.errors[0] ?? "rien envoyé" });
    }
  }
  return report;
}
