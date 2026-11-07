import type { Canal, SendOptions } from "./types";

/**
 * WhatsApp : le compte de messagerie du canal envoie et paie le message (voir SendOptions). Ce n'est pas le
 * WABA : sans compte de messagerie renseigné, le champ est omis et Meta choisit.
 */
export const sendOptions = (canal: Canal): SendOptions =>
  canal.plateforme === "whatsapp" && canal.messagingAccountId ? { messagingAccountId: canal.messagingAccountId } : {};
