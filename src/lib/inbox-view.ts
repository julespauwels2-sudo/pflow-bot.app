/**
 * Boîte de réception, affichage (fonctions pures + mémoire « déjà lu » de cet appareil).
 * - Ordre : par dernier message, la plus récente en haut (celles qui attendent l'équipe sont signalées, pas remontées).
 * - Non lu : le dernier message vient du client et il est arrivé après la dernière ouverture de la conversation sur
 *   cet appareil. La mémoire est locale (localStorage) : rien en base. Au premier passage, tout ce qui est plus ancien
 *   compte comme lu.
 */
import type { EtatConversation, InboxCanal, InboxConversation, StoredMessageLike } from "@/channels/core/inbox";

export interface InboxRow {
  canal: InboxCanal;
  conv: InboxConversation;
}

/** Date du dernier mouvement de la conversation. */
export const lastAt = (conv: InboxConversation) => conv.dernierMessage?.at ?? conv.updatedAt;

/** Toutes les conversations, tous numéros confondus, de la plus récente à la plus ancienne (dernier message). */
export function sortConversations(canaux: InboxCanal[]): InboxRow[] {
  return canaux.flatMap((canal) => canal.conversations.map((conv) => ({ canal, conv }))).sort((a, b) => lastAt(b.conv).localeCompare(lastAt(a.conv)));
}

export interface InboxFiltre {
  /** Resto affiché (id du resto, « pflow » pour le numéro PFlow) ; vide : tous. */
  resto: string;
  /** Afficher les numéros de test de Meta (+1 555 …), masqués par défaut. */
  numerosTest: boolean;
}

export const FILTRE_PAR_DEFAUT: InboxFiltre = { resto: "", numerosTest: false };

const cleResto = (canal: InboxCanal) => canal.restaurantId || "pflow";

/** Restos proposés dans le filtre (un par resto, même s'il a plusieurs numéros). */
export function restosDuFiltre(canaux: InboxCanal[], numerosTest: boolean): { id: string; nom: string }[] {
  const seen = new Map<string, string>();
  for (const c of canaux) if (numerosTest || !c.testMeta) seen.set(cleResto(c), c.nomResto.replace(/ \(démo\)$/, ""));
  return [...seen].map(([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

export function filtrerCanaux(canaux: InboxCanal[], filtre: InboxFiltre): InboxCanal[] {
  return canaux.filter((c) => (filtre.numerosTest || !c.testMeta) && (!filtre.resto || cleResto(c) === filtre.resto));
}

const heure = (iso: string, now = new Date()) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })} ${time}`;
};

/** Libellé et ton de l'état d'une conversation (badge unique de la liste et de la conversation). */
export function etatLabel(etat: EtatConversation, now = new Date()): { texte: string; ton: "actif" | "pause" | "alerte" | "ignore" } {
  const jusqua = (until: string | null) => (until ? ` (jusqu'à ${heure(until, now)})` : "");
  switch (etat.code) {
    case "transfert":
      return { texte: `🔔 En pause : transfert${jusqua(etat.until)}`, ton: "alerte" };
    case "equipe":
      return { texte: `⏸ En pause : l'équipe a répondu${jusqua(etat.until)}`, ton: "pause" };
    case "main":
      return { texte: "✋ En pause : tu as repris la main", ton: "pause" };
    case "ignore":
      return { texte: `🚫 ${noteLabel(`ignore:${etat.raison}`) ?? "Ignoré"}`, ton: "ignore" };
    default:
      return { texte: "🤖 Bot actif", ton: "actif" };
  }
}

/** Raison pour laquelle le bot n'a pas répondu à un message (colonne erreur « ignore:… »). */
export function noteLabel(note: string | undefined): string | null {
  if (!note?.startsWith("ignore:")) return null;
  const code = note.slice("ignore:".length);
  return (
    {
      aucun_declencheur: "Ignoré : pas de mot-clé",
      pause_transfert_humain: "Pas de réponse : bot en pause (transfert)",
      pause_echo_gerant: "Pas de réponse : l'équipe a répondu (pause 12 h)",
      pause_manuel: "Pas de réponse : tu as repris la main",
      media_non_gere: "Pas de réponse : type de message non géré",
      retour_commande: "Pas de réponse : retour de la page de commande",
      fenetre_fermee: "Pas de réponse : fenêtre de 24 h fermée",
    }[code] ?? `Pas de réponse (${code})`
  );
}

/** Qui a écrit : le client, le bot, ou l'équipe (depuis l'appli WhatsApp Business ou depuis la boîte de réception). */
export function auteurLabel(m: StoredMessageLike): { texte: string; cote: "gauche" | "droite"; ton: "client" | "bot" | "equipe" } {
  if (m.sens === "entrant") return { texte: "Client", cote: "gauche", ton: "client" };
  if (m.sens === "echo") return { texte: "👩‍🍳 Équipe · appli WhatsApp", cote: "droite", ton: "equipe" };
  if (m.auteur === "humain") return { texte: "👩‍🍳 Équipe · boîte de réception", cote: "droite", ton: "equipe" };
  return { texte: "🤖 Bot", cote: "droite", ton: "bot" };
}

export interface SeenState {
  /** Avant cette date, tout compte comme lu (premier passage sur cet appareil). */
  initAt: string;
  /** Dernière ouverture de chaque conversation. */
  seen: Record<string, string>;
}

export function isUnread(conv: InboxConversation, state: SeenState): boolean {
  const last = conv.dernierMessage;
  if (!last || last.sens !== "entrant") return false;
  return last.at > (state.seen[conv.contactId] ?? state.initAt);
}

const KEY = "pflow-inbox-vu";

/** Mémoire « déjà lu » de cet appareil ; vide (tout lu jusqu'à maintenant) si le stockage est indisponible. */
export function readSeen(now = new Date()): SeenState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SeenState;
      if (typeof parsed.initAt === "string" && parsed.seen && typeof parsed.seen === "object") return parsed;
    }
  } catch {
    // Stockage indisponible (navigation privée…) : on continue sans.
  }
  const fresh = { initAt: now.toISOString(), seen: {} };
  writeSeen(fresh);
  return fresh;
}

export function markSeen(state: SeenState, contactId: string, at: string): SeenState {
  if ((state.seen[contactId] ?? "") >= at) return state;
  // Au plus 500 conversations retenues (les plus récemment ouvertes).
  const entries = Object.entries({ ...state.seen, [contactId]: at })
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, 500);
  const next = { ...state, seen: Object.fromEntries(entries) };
  writeSeen(next);
  return next;
}

function writeSeen(state: SeenState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Rien : la mémoire « lu » est un confort.
  }
}

/** Mise en forme WhatsApp (*gras*, _italique_, ~barré~) : les morceaux à afficher, sans HTML. */
export function waSegments(text: string): { text: string; style?: "bold" | "italic" | "strike" }[] {
  const out: { text: string; style?: "bold" | "italic" | "strike" }[] = [];
  const re = /([*_~])(?=\S)([^*_~\n]*?\S)\1/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[2], style: m[1] === "*" ? "bold" : m[1] === "_" ? "italic" : "strike" });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Extrait d'une ligne pour la liste (sans les marques *gras*, _italique_). */
export const plainExtract = (text: string) =>
  waSegments(text)
    .map((s) => s.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** Heure façon WhatsApp : « 14:05 » aujourd'hui, « Hier », sinon « 07/11 ». */
export function shortTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(d) === day(yesterday)) return "Hier";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}
