import type { ContactState } from "./types";

/** Fenêtre de service client WhatsApp : 24 h après le dernier message du contact. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Vrai si on peut envoyer un message libre (hors template) à ce contact.
 * Hors fenêtre, seuls les templates validés par Meta sont autorisés (phase 2).
 */
export function canSendFreeform(contact: Pick<ContactState, "lastInboundAt">, now: Date): boolean {
  if (!contact.lastInboundAt) return false;
  const last = Date.parse(contact.lastInboundAt);
  if (Number.isNaN(last)) return false;
  return now.getTime() - last < WHATSAPP_WINDOW_MS;
}
