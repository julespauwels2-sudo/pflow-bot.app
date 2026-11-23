/**
 * Boîte de réception : conversations par resto, reprendre la main (le bot se tait), rendre la main au
 * bot, répondre à la main (dans la fenêtre de 24 h). Même stockage que le webhook.
 */
import { canSendFreeform, repriseMinutes, type ContactState, type OutgoingMessage } from "@/engine";
import type { WorkspaceData } from "@/data/types";
import type { Canal, ChannelContact, ChannelSender, ChannelStore, Plateforme, StoredMessage } from "./types";
import { sendOptions } from "./send-options";
import { formatDuration } from "../voice/duration";

/**
 * État unique d'une conversation (boîte de réception) :
 * - actif : le bot répond ;
 * - transfert : en pause après un transfert vers l'équipe (un mot-clé du client ou « Rendre au bot » le relance) ;
 * - equipe : en pause parce que l'équipe a répondu à la main (appli WhatsApp Business ou boîte de réception) ;
 * - main : l'équipe a repris la main, sans limite de durée ;
 * - ignore : le bot est actif mais a laissé passer le dernier message (pas de mot-clé).
 */
export type EtatConversation =
  | { code: "actif" }
  | { code: "transfert"; until: string | null }
  /**
   * Pause intelligente (`repriseMinutes` présent) : `attente` = le client a réécrit et attend ; le bot reprend à `until`
   * si personne ne répond. Sans client en attente, le bot reprendra `repriseMinutes` après son prochain message.
   */
  | { code: "equipe"; until: string | null; attente?: boolean; repriseMinutes?: number }
  | { code: "main" }
  | { code: "ignore"; raison: string };

/** Pause encore en cours (une pause dont l'heure de fin est passée ne compte plus : le bot répondra). */
export function pauseActive(pause: ContactState["pause"], now: Date): ContactState["pause"] {
  return pause && (pause.until === null || Date.parse(pause.until) > now.getTime()) ? pause : null;
}

export function etatConversation(
  pause: ContactState["pause"],
  dernier: Pick<StoredMessage, "sens" | "erreur"> | undefined,
  now: Date,
  repriseMinutes?: number,
): EtatConversation {
  const active = pauseActive(pause, now);
  if (active?.reason === "transfert_humain") return { code: "transfert", until: active.until };
  if (active?.reason === "echo_gerant") {
    if (!repriseMinutes) return { code: "equipe", until: active.until };
    const attente = dernier?.sens === "entrant" && Boolean(dernier.erreur?.startsWith("ignore:pause_echo_gerant"));
    return { code: "equipe", until: active.until, attente, repriseMinutes };
  }
  // « manuel » avec une fin : ancienne réponse depuis la boîte de réception (avant le 22 novembre 2026).
  if (active?.reason === "manuel") return active.until ? { code: "equipe", until: active.until } : { code: "main" };
  if (dernier?.sens === "entrant" && dernier.erreur?.startsWith("ignore:")) return { code: "ignore", raison: dernier.erreur.slice("ignore:".length) };
  return { code: "actif" };
}

/** Ce qu'il faut d'un message pour dire qui l'a écrit. */
export type StoredMessageLike = Pick<StoredMessage, "sens" | "auteur">;

/** Numéro de test fourni par Meta (+1 555 …) : masqué par défaut dans la boîte de réception. */
export function estNumeroTestMeta(numero: string | undefined): boolean {
  return (numero ?? "").replace(/\D/g, "").startsWith("1555");
}

export interface InboxConversation {
  contactId: string;
  waId: string;
  nom?: string;
  pause: ContactState["pause"];
  /** État lisible (pause encore en cours, ou dernier message ignoré). */
  etat: EtatConversation;
  /** Le client peut encore recevoir un message libre (fenêtre de 24 h). */
  fenetreOuverte: boolean;
  dernierMessage?: { texte: string; sens: StoredMessage["sens"]; auteur?: StoredMessage["auteur"]; at: string; note?: string };
  /** Transfert ouvert ET bot encore en pause : la conversation attend vraiment l'équipe. */
  transfertOuvert: boolean;
  updatedAt: string;
  /** Numéro PFlow : nom de la démo en cours (absent = bot PFlow de base). */
  demoEnCours?: string;
  /** Non-lus synchronisés : dernière lecture de cette conversation par l'utilisateur (tous ses appareils). */
  luJusqua?: string;
  /** Recherche : extrait du message qui correspond (recherche dans le contenu). */
  correspondance?: string;
}

/** Options de la liste : recherche (nom, numéro ou contenu d'un message) et lectures de l'utilisateur. */
export interface InboxListOptions {
  q?: string;
  userId?: string;
  /** Appelé avec la disponibilité des lectures synchronisées (table bot_lectures). */
  onLectures?: (available: boolean) => void;
}

const foldSearch = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export interface InboxCanal {
  canalId: string;
  restaurantId: string;
  plateforme: Plateforme;
  nomResto: string;
  numero?: string;
  etat: string;
  /** Numéro de test de Meta (+1 555 …). */
  testMeta: boolean;
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
  // Bruit des échos de l'appli WhatsApp Business : réaction, message modifié, type non pris en charge.
  if (m.type === "reaction") return "👍 Réaction";
  if (m.type === "edit") return "✏️ Message modifié";
  if (m.type === "unsupported") return "📎 Contenu non affichable ici (voir l'appli WhatsApp)";
  if (m.type === "sticker") return "🏷️ Autocollant";
  if (m.type === "video") return "🎬 Vidéo";
  if (m.type === "document") return "📄 Document";
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
export async function listInbox(store: ChannelStore, workspace: WorkspaceData | Promise<WorkspaceData>, now: Date, options: InboxListOptions = {}): Promise<InboxCanal[]> {
  const q = options.q?.trim() ?? "";
  const [data, canaux, lectures, trouves] = await Promise.all([
    workspace,
    store.listCanaux(),
    options.userId ? store.getLectures(options.userId) : Promise.resolve({ available: false, lu: {} as Record<string, string> }),
    q ? store.searchMessages(q, 200) : Promise.resolve([] as StoredMessage[]),
  ]);
  options.onLectures?.(lectures.available);
  // Recherche dans le contenu : le message le plus récent qui correspond, par conversation.
  const parContenu = new Map<string, string>();
  for (const m of trouves) if (!parContenu.has(m.contactId)) parContenu.set(m.contactId, messageText(m));
  const needle = foldSearch(q);
  const digits = q.replace(/\D/g, "");
  const names = new Map(data.clients.map((c) => [c.id, c.nomResto]));
  // Contacts et transferts de tous les numéros en même temps, puis le dernier message de chaque conversation.
  const perCanal = await Promise.all(canaux.map((canal) => Promise.all([store.listContacts(canal.id), store.listTransferts(canal.id)])));
  const contacts = perCanal.flatMap(([list]) => list);
  const lasts = await mapLimit(contacts, LIST_CONCURRENCY, async (contact) => (await store.listMessages(contact.id, 1))[0]);
  const lastById = new Map(contacts.map((c, i) => [c.id, lasts[i]]));
  return canaux.map((canal, index) => {
    const [list, transferts] = perCanal[index]!;
    const open = new Set(transferts.filter((t) => !t.resoluLe).map((t) => t.contactId));
    // Pause intelligente : seulement sur les numéros des restos (délai de la fiche, 10 min par défaut).
    const reprise = canal.role === "pflow" ? undefined : repriseMinutes(data.infoSheets?.[canal.restaurantId] ?? { horaires: [] });
    const conversations: InboxConversation[] = list.map((contact) => {
      const last = lastById.get(contact.id);
      const etat = etatConversation(contact.state.pause, last, now, reprise);
      return {
        contactId: contact.id,
        waId: contact.waId,
        nom: contact.state.profileName,
        pause: pauseActive(contact.state.pause, now),
        etat,
        fenetreOuverte: canSendFreeform(contact.state, now),
        ...(last
          ? {
              dernierMessage: {
                texte: messageText(last),
                sens: last.sens,
                ...(last.auteur ? { auteur: last.auteur } : {}),
                at: last.at,
                ...(last.erreur?.startsWith("ignore:") ? { note: last.erreur } : {}),
              },
            }
          : {}),
        transfertOuvert: open.has(contact.id) && etat.code === "transfert",
        updatedAt: last?.at ?? contact.updatedAt,
        ...(contact.demo?.clientId ? { demoEnCours: names.get(contact.demo.clientId) ?? "démo supprimée" } : {}),
        ...(lectures.available && lectures.lu[contact.id] ? { luJusqua: lectures.lu[contact.id] } : {}),
        ...(parContenu.has(contact.id) ? { correspondance: parContenu.get(contact.id) } : {}),
      };
    }).filter((conv) => {
      if (!q) return true;
      // Nom, numéro (chiffres seulement, sans indicatif imposé) ou contenu d'un message.
      if (conv.nom && foldSearch(conv.nom).includes(needle)) return true;
      if (digits.length >= 3 && conv.waId.includes(digits)) return true;
      return Boolean(conv.correspondance);
    });
    conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      canalId: canal.id,
      restaurantId: canal.restaurantId,
      plateforme: canal.plateforme,
      nomResto: canal.role === "pflow" ? "Numéro PFlow (démos)" : (names.get(canal.restaurantId) ?? "Resto inconnu"),
      ...(canal.numeroAffiche ? { numero: canal.numeroAffiche } : {}),
      etat: canal.etat,
      testMeta: estNumeroTestMeta(canal.numeroAffiche),
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
 * - repondre : message libre envoyé par une personne ; le bot se met en pause « l'équipe a répondu » (comme quand
 *   l'équipe répond depuis l'appli WhatsApp Business) pour ne pas lui couper la parole.
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
  // Même pause que quand l'équipe répond depuis l'appli WhatsApp Business : « l'équipe a répondu ».
  if (pauser) contact.state.pause = { reason: "echo_gerant", until };
  // Message et pause : deux écritures indépendantes, faites en même temps, toutes deux AVANT la réponse (rien ne se
  // perd si la fonction s'arrête juste après).
  const [message] = await Promise.all([
    store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "humain", wamid, type: "text", contenu: { kind: "text", text: texte }, statut: "envoye" }),
    pauser ? store.saveContact(contact) : Promise.resolve(),
  ]);
  return { message, pause: contact.state.pause };
}
