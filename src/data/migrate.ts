/**
 * Conversion des flux enregistrés avec une ancienne version de l'éditeur vers le format
 * actuel. Appliquée à la lecture de tout JSON (stockage, import, presse-papiers), avant la
 * validation : le moteur ne connaît que le format actuel.
 *
 * - Message { text, buttons? }       → Message { bubbles: [une bulle, boutons de réponse] }
 * - ancien bloc « Boutons »         → idem
 * - ancien bloc « Lien de commande » → Message : 1 bulle + bouton lien « Lien de commande »
 *
 * Les ids des boutons sont conservés : les flèches restent valides.
 */
import { TEXTS } from "@/engine";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

function replyButtons(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).map((b) => ({ id: b.id, kind: "reply", title: b.title ?? "" }));
}

export function isLegacyNode(raw: unknown): boolean {
  if (!isObj(raw)) return false;
  if (raw.type === "buttons" || raw.type === "order_link") return true;
  return raw.type === "message" && isObj(raw.data) && !Array.isArray(raw.data.bubbles);
}

export function migrateRawNode(raw: unknown): unknown {
  if (!isLegacyNode(raw)) return raw;
  const node = raw as Raw;
  const data = isObj(node.data) ? node.data : {};
  const id = String(node.id);

  if (node.type === "order_link") {
    const text = typeof data.text === "string" && data.text.trim() ? data.text : TEXTS.orderLink;
    const title = typeof data.buttonLabel === "string" && data.buttonLabel.trim() ? data.buttonLabel : TEXTS.orderButton;
    return {
      ...node,
      type: "message",
      data: { bubbles: [{ id: `${id}-1`, text, buttons: [{ id: `${id}-lien`, kind: "link", title, orderLink: true }] }] },
    };
  }
  return {
    ...node,
    type: "message",
    data: { bubbles: [{ id: `${id}-1`, text: typeof data.text === "string" ? data.text : "", buttons: replyButtons(data.buttons) }] },
  };
}

/** Convertit les nœuds d'un graphe brut ({ nodes, edges }). Le reste est laissé tel quel. */
export function migrateRawGraph(raw: unknown): unknown {
  if (!isObj(raw) || !Array.isArray(raw.nodes)) return raw;
  if (!raw.nodes.some(isLegacyNode)) return raw;
  return { ...raw, nodes: raw.nodes.map(migrateRawNode) };
}

/** Vrai si un document JSON (sauvegarde complète, flux…) contient encore d'anciens blocs. */
export function containsLegacyNodes(raw: unknown): boolean {
  if (Array.isArray(raw)) return raw.some(containsLegacyNodes);
  if (!isObj(raw)) return false;
  if (isLegacyNode(raw)) return true;
  return Object.values(raw).some(containsLegacyNodes);
}
