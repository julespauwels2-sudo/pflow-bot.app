/**
 * Boîte de réception : conversations par resto, reprendre la main (le bot se tait), rendre la main au
 * bot, répondre à la main (dans la fenêtre de 24 h). Même stockage que le webhook.
 */
import { canSendFreeform, type ContactState, type OutgoingMessage } from "@/engine";
import type { WorkspaceData } from "@/data/types";
import type { ChannelSender, ChannelStore, Plateforme, StoredMessage } from "./types";

export interface InboxConversation {
  contactId: string;
  waId: string;
  nom?: string;
  pause: ContactState["pause"];
  /** Le client peut encore recevoir un message libre (fenêtre de 24 h). */
  fenetreOuverte: boolean;
  dernierMessage?: { texte: string; sens: StoredMessage["sens"]; at: string };
  transfertOuvert: boolean;
  updatedAt: string;
}

export interface InboxCanal {
  canalId: string;
  restaurantId: string;
  plateforme: Plateforme;
  nomResto: string;
  numero?: string;
  etat: string;
  conversations: InboxConversation[];
}

/** Texte lisible d'un message stocké (entrant, écho, ou message du bot). */
export function messageText(m: Pick<StoredMessage, "type" | "contenu">): string {
  const c = (m.contenu ?? {}) as Record<string, unknown>;
  if (typeof c.texte === "string" && c.texte) return c.texte;
  const out = c as Partial<OutgoingMessage> & { kind?: string };
  if (out.kind === "text" && typeof out.text === "string") return out.text;
  if (out.kind === "buttons") return `${out.text}\n${(out.buttons ?? []).map((b) => `[${b.title}]`).join(" ")}`;
  if (out.kind === "list") return `${out.text}\n[${out.buttonLabel}] ${(out.items ?? []).map((i) => i.title).join(", ")}`;
  if (out.kind === "link") return `${out.text}\n[🔗 ${out.buttonLabel}] ${out.url}`;
  if (m.type === "audio") return "🎤 Message vocal";
  if (m.type === "image") return "📷 Photo";
  return `(${m.type})`;
}

export async function listInbox(store: ChannelStore, workspace: WorkspaceData, now: Date): Promise<InboxCanal[]> {
  const names = new Map(workspace.clients.map((c) => [c.id, c.nomResto]));
  const result: InboxCanal[] = [];
  for (const canal of await store.listCanaux()) {
    const [contacts, transferts] = await Promise.all([store.listContacts(canal.id), store.listTransferts(canal.id)]);
    const open = new Set(transferts.filter((t) => !t.resoluLe).map((t) => t.contactId));
    const conversations: InboxConversation[] = [];
    for (const contact of contacts) {
      const last = (await store.listMessages(contact.id, 1))[0];
      conversations.push({
        contactId: contact.id,
        waId: contact.waId,
        nom: contact.state.profileName,
        pause: contact.state.pause,
        fenetreOuverte: canSendFreeform(contact.state, now),
        ...(last ? { dernierMessage: { texte: messageText(last), sens: last.sens, at: last.at } } : {}),
        transfertOuvert: open.has(contact.id),
        updatedAt: last?.at ?? contact.updatedAt,
      });
    }
    conversations.sort((a, b) => Number(b.transfertOuvert) - Number(a.transfertOuvert) || b.updatedAt.localeCompare(a.updatedAt));
    result.push({
      canalId: canal.id,
      restaurantId: canal.restaurantId,
      plateforme: canal.plateforme,
      nomResto: names.get(canal.restaurantId) ?? "Resto inconnu",
      ...(canal.numeroAffiche ? { numero: canal.numeroAffiche } : {}),
      etat: canal.etat,
      conversations,
    });
  }
  return result;
}

export type InboxAction = { type: "reprendre" } | { type: "relancer" } | { type: "repondre"; texte: string };

export class InboxError extends Error {}

/**
 * - reprendre : le bot se tait pour ce contact, sans limite de durée, jusqu'à « Rendre au bot » ;
 * - relancer : le bot reprend (pause levée, transferts marqués traités, conversation repartie de zéro) ;
 * - repondre : message libre envoyé par une personne ; le bot se met en pause (comme quand le gérant
 *   répond depuis son appli) pour ne pas lui couper la parole.
 */
export async function applyInboxAction(
  deps: { store: ChannelStore; senders: Partial<Record<Plateforme, Pick<ChannelSender, "send">>>; now: Date; echoPauseHours?: number },
  contactId: string,
  action: InboxAction,
): Promise<void> {
  const { store, now } = deps;
  const contact = await store.getContact(contactId);
  if (!contact) throw new InboxError("Conversation introuvable");
  const canal = (await store.listCanaux()).find((c) => c.id === contact.canalId);
  if (!canal) throw new InboxError("Numéro introuvable");

  if (action.type === "reprendre") {
    contact.state.pause = { reason: "manuel", until: null };
    await store.saveContact(contact);
    const session = await store.getSession(contact.id);
    await store.saveSession(contact.id, null, session?.version ?? null);
    return;
  }
  if (action.type === "relancer") {
    contact.state.pause = null;
    await store.saveContact(contact);
    await store.resolveTransferts(contact.id);
    return;
  }
  const texte = action.texte.trim();
  if (!texte) throw new InboxError("Message vide");
  if (texte.length > 4096) throw new InboxError("Message trop long (4 096 caractères maximum)");
  if (!canSendFreeform(contact.state, now)) {
    throw new InboxError("Fenêtre de 24 h fermée : le client doit d'abord réécrire (les modèles Meta viendront en phase 2).");
  }
  const sender = deps.senders[canal.plateforme];
  if (!sender) throw new InboxError(`Envoi ${canal.plateforme === "instagram" ? "Instagram" : "WhatsApp"} non configuré.`);
  let wamid: string | undefined;
  try {
    wamid = await sender.send(canal.accountId, contact.waId, { kind: "text", text: texte });
  } catch (error) {
    await store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "humain", type: "text", contenu: { kind: "text", text: texte }, statut: "echec", erreur: String(error instanceof Error ? error.message : error) });
    throw new InboxError(error instanceof Error ? error.message : String(error));
  }
  await store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "humain", wamid, type: "text", contenu: { kind: "text", text: texte }, statut: "envoye" });
  // Pause du bot (on ne raccourcit jamais une pause plus longue déjà en cours).
  const until = new Date(now.getTime() + (deps.echoPauseHours ?? canal.echoPauseHours) * 3_600_000).toISOString();
  const current = contact.state.pause;
  if (!current || (current.until !== null && Date.parse(current.until) < Date.parse(until))) {
    contact.state.pause = { reason: "manuel", until };
    await store.saveContact(contact);
  }
}
