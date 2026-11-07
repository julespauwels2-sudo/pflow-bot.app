import type { Canal, SendOptions } from "./types";

/** WhatsApp : le compte WhatsApp (WABA) du canal envoie et paie le message (voir SendOptions). */
export const sendOptions = (canal: Canal): SendOptions =>
  canal.plateforme === "whatsapp" && canal.wabaId ? { messagingAccountId: canal.wabaId } : {};
