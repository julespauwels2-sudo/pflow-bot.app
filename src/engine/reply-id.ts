/**
 * Identifiants des boutons et lignes de liste envoyés sur WhatsApp.
 *
 * On encode flux + bloc + sortie dans l'id renvoyé par WhatsApp quand le contact
 * clique. Ainsi, un clic sur un ancien bouton (session expirée, autre flux)
 * reste exploitable. Limite WhatsApp : 256 caractères.
 */
const SEP = "|";

export interface ReplyRef {
  flowId: string;
  nodeId: string;
  handle: string;
}

export function encodeReplyId(ref: ReplyRef): string {
  return ["pf", ref.flowId, ref.nodeId, ref.handle].map(encodeURIComponent).join(SEP);
}

export function decodeReplyId(id: string): ReplyRef | null {
  const parts = id.split(SEP);
  if (parts.length !== 4 || parts[0] !== "pf") return null;
  try {
    const [, flowId, nodeId, handle] = parts.map(decodeURIComponent);
    if (!flowId || !nodeId || !handle) return null;
    return { flowId, nodeId, handle };
  } catch {
    return null;
  }
}
