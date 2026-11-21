/**
 * Boîte de réception : conversations par resto, reprendre la main (le bot se tait), rendre la main au
 * bot, répondre à la main (dans la fenêtre de 24 h). Même stockage que le webhook.
 */
import { canSendFreeform, type ContactState, type OutgoingMessage } from "@/engine";
import type { WorkspaceData } from "@/data/types";
import type { Canal, ChannelContact, ChannelSender, ChannelStore, Plateforme, StoredMessage } from "./types";
import { sendOptions } from "./send-options";
import { formatDuration } from "../voice/duration";

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
  /** Numéro PFlow : nom de la démo en cours (absent = bot PFlow de base). */
  demoEnCours?: string;
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
  // Message vocal transcrit : le vocal (avec sa durée) et sa transcription. L'audio lui-même n'est pas gardé.
  if (m.type === "audio" && typeof c.transcription === "string") {
    const duree = typeof c.duree === "number" ? ` (${formatDuration(c.duree)})` : "";
    return `🎤 Message vocal${duree}\n« ${c.transcription} »`;
  }
  if (m.type === "audio" && typeof c.statut === "string" && c.statut !== "transcrit") {
    const duree = typeof c.duree === "number" ? ` (${formatDuration(c.duree)})` : "";
    const raison = { trop_long: "trop long", plafond: "plafond du jour atteint", echec: "non compris" }[c.statut] ?? c.statut;
    return `🎤 Message vocal${duree} : non transcrit (${raison}), le bot a demandé d'écrire`;
  }
  if (typeof c.texte === "string" && c.texte) return c.texte;
  const out = c as Partial<OutgoingMessage> & { kind?: string };
  if (out.kind === "text" && typeof out.text === "string") return out.text;
  if (out.kind === "buttons") return `${out.text}\n${(out.buttons ?? []).map((b) => `[${b.title}]`).join(" ")}`;
  if (out.kind === "list") return `${out.text}\n[${out.buttonLabel}] ${(out.items ?? []).map((i) => i.title).join(", ")}`;
  // L'adresse du lien n'apparaît pas dans le texte (extrait de la liste) : le bouton la porte.
  if (out.kind === "link") return `${out.text}\n[🔗 ${out.buttonLabel}]`;
  if (m.type === "audio") return typeof c.erreur === "string" ? `🎤 Message vocal (non transcrit : ${c.erreur})` : "🎤 Message vocal";
  if (m.type === "image") return "📷 Photo";
  return `(${m.type})`;
}

/**
 * Applique `fn` à chaque élément avec au plus `limit` appels en cours (ordre du résultat conservé). La liste lit le
 * dernier message de chaque conversation : une requête par conversation, en parallèle plutôt qu'à la file (à
 * ~200 ms par requête Supabase, 50 conversations à la file = 10 s).
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Requêtes « dernier message » en parallèle au plus (liste de la boîte de réception). */
const LIST_CONCURRENCY = 8;

/** `workspace` peut être une promesse : sa lecture se fait en même temps que celle des numéros. */
export async function listInbox(store: ChannelStore, workspace: WorkspaceData | Promise<WorkspaceData>, now: Date): Promise<InboxCanal[]> {
  const [data, canaux] = await Promise.all([workspace, store.listCanaux()]);
  const names = new Map(data.clients.map((c) => [c.id, c.nomResto]));
  // Contacts et transferts de tous les numéros en même temps, puis le dernier message de chaque conversation.
  const perCanal = await Promise.all(canaux.map((canal) => Promise.all([store.listContacts(canal.id), store.listTransferts(canal.id)])));
  const contacts = perCanal.flatMap(([list]) => list);
  const lasts = await mapLimit(contacts, LIST_CONCURRENCY, async (contact) => (await store.listMessages(contact.id, 1))[0]);
  const lastById = new Map(contacts.map((c, i) => [c.id, lasts[i]]));
  return canaux.map((canal, index) => {
    const [list, transferts] = perCanal[index]!;
    const open = new Set(transferts.filter((t) => !t.resoluLe).map((t) => t.contactId));
    const conversations: InboxConversation[] = list.map((contact) => {
      const last = lastById.get(contact.id);
      return {
        contactId: contact.id,
        waId: contact.waId,
        nom: contact.state.profileName,
        pause: contact.state.pause,
        fenetreOuverte: canSendFreeform(contact.state, now),
        ...(last ? { dernierMessage: { texte: messageText(last), sens: last.sens, at: last.at } } : {}),
        transfertOuvert: open.has(contact.id),
        updatedAt: last?.at ?? contact.updatedAt,
        ...(contact.demo?.clientId ? { demoEnCours: names.get(contact.demo.clientId) ?? "démo supprimée" } : {}),
      };
    });
    conversations.sort((a, b) => Number(b.transfertOuvert) - Number(a.transfertOuvert) || b.updatedAt.localeCompare(a.updatedAt));
    return {
      canalId: canal.id,
      restaurantId: canal.restaurantId,
      plateforme: canal.plateforme,
      nomResto: canal.role === "pflow" ? "Numéro PFlow (démos)" : (names.get(canal.restaurantId) ?? "Resto inconnu"),
      ...(canal.numeroAffiche ? { numero: canal.numeroAffiche } : {}),
      etat: canal.etat,
      conversations,
    };
  });
}

export type InboxAction = { type: "reprendre" } | { type: "relancer" } | { type: "repondre"; texte: string };

export class InboxError extends Error {}

/** L'envoi à Meta a échoué : la tentative est gardée dans la conversation (statut « échec »), renvoyée à l'écran. */
export class InboxSendError extends InboxError {
  constructor(
    message: string,
    readonly stored: StoredMessage,
  ) {
    super(message);
  }
}

/** Ce que l'action a changé, pour mettre l'écran à jour sans recharger toute la boîte. */
export interface InboxActionResult {
  /** Répondre : le message enregistré (son id remplace l'id provisoire affiché tout de suite). */
  message?: StoredMessage;
  /** Pause du bot après l'action. */
  pause: ContactState["pause"];
}

/**
 * - reprendre : le bot se tait pour ce contact, sans limite de durée, jusqu'à « Rendre au bot » ;
 * - relancer : le bot reprend (pause levée, transferts marqués traités, conversation repartie de zéro) ;
 * - repondre : message libre envoyé par une personne ; le bot se met en pause (comme quand le gérant
 *   répond depuis son appli) pour ne pas lui couper la parole.
 *
 * `deps.contact`, `deps.canaux` : déjà lus par l'appelant (la route les lit pour vérifier l'accès), pour ne pas les relire.
 */
export async function applyInboxAction(
  deps: {
    store: ChannelStore;
    senders: Partial<Record<Plateforme, Pick<ChannelSender, "send">>>;
    now: Date;
    echoPauseHours?: number;
    contact?: ChannelContact;
    canaux?: Canal[];
  },
  contactId: string,
  action: InboxAction,
): Promise<InboxActionResult> {
  const { store, now } = deps;
  // Contact et numéros lus en même temps (deux requêtes indépendantes).
  const [contact, canaux] = await Promise.all([deps.contact && deps.contact.id === contactId ? deps.contact : store.getContact(contactId), deps.canaux ?? store.listCanaux()]);
  if (!contact) throw new InboxError("Conversation introuvable");
  const canal = canaux.find((c) => c.id === contact.canalId);
  if (!canal) throw new InboxError("Numéro introuvable");

  if (action.type === "reprendre") {
    contact.state.pause = { reason: "manuel", until: null };
    const [, session] = await Promise.all([store.saveContact(contact), store.getSession(contact.id)]);
    await store.saveSession(contact.id, null, session?.version ?? null);
    return { pause: contact.state.pause };
  }
  if (action.type === "relancer") {
    contact.state.pause = null;
    await Promise.all([store.saveContact(contact), store.resolveTransferts(contact.id)]);
    return { pause: null };
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
    wamid = await sender.send(canal.accountId, contact.waId, { kind: "text", text: texte }, sendOptions(canal));
  } catch (error) {
    const erreur = String(error instanceof Error ? error.message : error);
    const stored = await store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "humain", type: "text", contenu: { kind: "text", text: texte }, statut: "echec", erreur });
    throw new InboxSendError(erreur, stored);
  }
  // Pause du bot (on ne raccourcit jamais une pause plus longue déjà en cours).
  const until = new Date(now.getTime() + (deps.echoPauseHours ?? canal.echoPauseHours) * 3_600_000).toISOString();
  const current = contact.state.pause;
  const pauser = !current || (current.until !== null && Date.parse(current.until) < Date.parse(until));
  if (pauser) contact.state.pause = { reason: "manuel", until };
  // Message et pause : deux écritures indépendantes, faites en même temps, toutes deux AVANT la réponse (rien ne se
  // perd si la fonction s'arrête juste après).
  const [message] = await Promise.all([
    store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "humain", wamid, type: "text", contenu: { kind: "text", text: texte }, statut: "envoye" }),
    pauser ? store.saveContact(contact) : Promise.resolve(),
  ]);
  return { message, pause: contact.state.pause };
}
