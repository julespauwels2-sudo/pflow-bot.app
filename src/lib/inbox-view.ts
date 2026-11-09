/**
 * Boîte de réception, affichage (fonctions pures + mémoire « déjà lu » de cet appareil).
 * - Ordre : d'abord les conversations qui attendent Jules (transfert ouvert), puis les plus récentes.
 * - Non lu : le dernier message vient du client et il est arrivé après la dernière ouverture de la conversation sur
 *   cet appareil. La mémoire est locale (localStorage) : rien en base. Au premier passage, tout ce qui est plus ancien
 *   compte comme lu.
 */
import type { InboxCanal, InboxConversation } from "@/channels/core/inbox";

export interface InboxRow {
  canal: InboxCanal;
  conv: InboxConversation;
}

/** Date du dernier mouvement de la conversation. */
export const lastAt = (conv: InboxConversation) => conv.dernierMessage?.at ?? conv.updatedAt;

/** Toutes les conversations, celles qui attendent Jules d'abord, puis de la plus récente à la plus ancienne. */
export function sortConversations(canaux: InboxCanal[]): InboxRow[] {
  return canaux
    .flatMap((canal) => canal.conversations.map((conv) => ({ canal, conv })))
    .sort((a, b) => Number(b.conv.transfertOuvert) - Number(a.conv.transfertOuvert) || lastAt(b.conv).localeCompare(lastAt(a.conv)));
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
