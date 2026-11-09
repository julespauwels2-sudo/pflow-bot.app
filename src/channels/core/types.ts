/**
 * Canaux (WhatsApp, Instagram) : types partagés par les webhooks, l'envoi et la boîte de réception.
 * La logique ne dépend pas de Next.js : elle peut être déplacée (ex. Supabase Edge Functions).
 */
import type { DemoKnowledge } from "@/demos/demo-knowledge";
import type { ContactDemo } from "@/demos/router";
import type { ContactState, IncomingMessage, OutgoingMessage, Session, TriggerMode } from "@/engine";

export type Plateforme = "whatsapp" | "instagram";
export type EventSource = Plateforme | "pflow_order";

/** Envoi vers une plateforme (API Graph de WhatsApp, API d'Instagram). */
/** Options d'envoi (WhatsApp). */
export interface SendOptions {
  /**
   * Compte de messagerie qui envoie (et paie) le message (bot_canaux.messaging_account_id, PAS le WABA).
   * Sans lui, Meta choisit lui-même parmi les comptes du numéro ; si le token n'y a pas accès :
   * « (#10) Viewer cannot access the provided Paid Message Account ».
   */
  messagingAccountId?: string;
}

export interface ChannelSender {
  /** Envoie un message et renvoie son identifiant sur la plateforme. */
  send(accountId: string, to: string, message: OutgoingMessage, options?: SendOptions): Promise<string | undefined>;
  /** Accusé de lecture et « en train d'écrire ». */
  markRead(accountId: string, messageId: string, typing: boolean, to?: string): Promise<void>;
  /** Téléchargement d'un média reçu (message vocal). */
  downloadMedia?(media: MediaRef, accountId?: string): Promise<{ data: Uint8Array; mimeType: string }>;
}

/** Média à télécharger : identifiant WhatsApp ou adresse Instagram. */
export interface MediaRef {
  id?: string;
  url?: string;
  mimeType?: string;
}

export interface Canal {
  id: string;
  /** Resto du canal ; vide pour le numéro PFlow (démos). */
  restaurantId: string;
  /**
   * « resto » (défaut) : le numéro d'un resto. « pflow » : le numéro PFlow partagé par toutes les
   * démos (aiguillage par mot-clé, bot PFlow de base sinon).
   */
  role?: "resto" | "pflow";
  plateforme: Plateforme;
  /** WhatsApp : phone_number_id ; Instagram : id du compte professionnel. */
  accountId: string;
  /** WhatsApp uniquement. */
  wabaId?: string;
  /**
   * Compte de messagerie (« Messaging Account » / « Paid Message Account ») qui envoie et paie les messages.
   * Distinct du WABA sur les numéros récents (ex. numéro de test : WABA 1440…, messagerie 1511…).
   * À attribuer, comme le WABA, à l'utilisateur système (guide-meta.md).
   */
  messagingAccountId?: string;
  numeroAffiche?: string;
  triggerMode: TriggerMode;
  coexistence: boolean;
  echoPauseHours: number;
  handoffPauseHours: number;
  sessionMinutes: number;
  /** Numéro du gérant (bot_canaux.tel_alerte). Plus utilisé pour les alertes : elles partent en notification push. */
  telAlerte?: string;
  /** test : ne répond qu'aux numéros de testNumeros ; coupe : ne répond à personne. */
  etat: "test" | "actif" | "coupe";
  testNumeros: string[];
}

export interface ChannelContact {
  id: string;
  canalId: string;
  /** Identifiant du client sur la plateforme (WhatsApp : numéro ; Instagram : IGSID). */
  waId: string;
  /** État vu par le moteur (pause, fenêtre de 24 h, compteur IA). */
  state: ContactState;
  stopOptions: boolean;
  updatedAt: string;
  /** Numéro PFlow : démo en cours de ce contact et démos déjà ouvertes. */
  demo?: ContactDemo;
}

export type MessageDirection = "entrant" | "sortant" | "echo";

export interface StoredMessage {
  id: string;
  canalId: string;
  contactId: string;
  sens: MessageDirection;
  auteur?: "bot" | "humain";
  wamid?: string;
  type: string;
  contenu: unknown;
  statut?: "recu" | "envoye" | "delivre" | "lu" | "echec";
  erreur?: string;
  at: string;
}

export interface Transfert {
  id: string;
  canalId: string;
  contactId: string;
  source: "bloc" | "ia" | "limite_ia" | "erreur_ia";
  dernierMessage?: string;
  gerantPrevenu: boolean;
  /** Historique seulement (anciennes alertes WhatsApp / e-mail) : plus écrit depuis que l'alerte part en push. */
  alerteVoie?: AlertVoie;
  /** Erreurs de l'envoi de l'alerte (push), s'il a échoué. */
  alerteErreur?: string;
  /** Notification push de l'alerte : la seule voie (src/channels/core/alerts.ts). */
  alertePush?: AlertPush;
  at: string;
  vuLe?: string;
  resoluLe?: string;
}

/** Un abonnement Web Push (navigateur ou application installée). Les clés sont celles du navigateur, pas des secrets. */
export interface PushSubscriptionRecord {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  appareil?: string;
  creeLe?: string;
  dernierEnvoiLe?: string;
  dernierEchecLe?: string;
  dernierEchec?: string;
}

/** Notification push d'une alerte : partie vers au moins un appareil, en échec, aucun appareil, ou clés VAPID absentes. */
export type AlertPush = "envoyee" | "echec" | "aucun_abonnement" | "non_configure";

/** Anciennes voies (avant le push seul) : message libre, modèle, e-mail, ou rien. Gardées pour l'historique. */
export type AlertVoie = "texte" | "modele" | "email" | "aucune";

/** Dates limites de conservation : tout ce qui est plus ancien est supprimé. */
export interface PurgeCutoffs {
  /** Conversations : messages, transferts, sessions (historique IA), appels à l'IA. */
  conversations: Date;
  /** Journal technique des notifications reçues (contient le texte des messages). */
  evenements: Date;
}

export interface PurgeCounts {
  messages: number;
  transferts: number;
  sessions: number;
  appelsIa: number;
  evenements: number;
}

/** Stockage du canal : Supabase (tables de la migration C) ou mémoire (tests, démo locale). */
export interface ChannelStore {
  /** Note un événement reçu. Faux s'il a déjà été reçu (renvoi de Meta) : il n'est pas retraité. */
  claimEvent(source: EventSource, key: string, charge: unknown): Promise<boolean>;
  finishEvent(source: EventSource, key: string, error?: string): Promise<void>;
  canalByAccount(plateforme: Plateforme, accountId: string): Promise<Canal | null>;
  /** Derniers événements reçus (page « État du système »). */
  recentEvents(limit?: number): Promise<{ source: EventSource; key: string; at: string; error?: string }[]>;
  /** Suppression automatique (durées de la politique de confidentialité : voir retention.ts). */
  purgeOlderThan(cutoffs: PurgeCutoffs): Promise<PurgeCounts>;
  listCanaux(): Promise<Canal[]>;
  /** Change l'état d'un canal (page État : bascule et retour arrière). */
  setCanalEtat(canalId: string, etat: Canal["etat"]): Promise<void>;
  /**
   * Embedded Signup : crée le canal WhatsApp d'un resto (toujours en « test »), ou renvoie celui qui existe déjà pour ce
   * numéro (aucun doublon, aucun canal existant modifié).
   */
  ensureCanal(canal: Omit<Canal, "id">): Promise<{ canal: Canal; created: boolean }>;
  getOrCreateContact(canalId: string, waId: string, profileName?: string): Promise<ChannelContact>;
  getContact(contactId: string): Promise<ChannelContact | null>;
  saveContact(contact: ChannelContact): Promise<void>;
  getSession(contactId: string): Promise<{ session: Session; version: number } | null>;
  /** Faux si la session a changé entre-temps (autre message traité en parallèle). */
  saveSession(contactId: string, session: Session | null, expectedVersion: number | null): Promise<boolean>;
  addMessage(message: Omit<StoredMessage, "id" | "at"> & { at?: string }): Promise<StoredMessage>;
  updateMessageStatus(wamid: string, statut: NonNullable<StoredMessage["statut"]>, erreur?: string): Promise<void>;
  addTransfert(transfert: Omit<Transfert, "id" | "at" | "gerantPrevenu"> & { gerantPrevenu?: boolean }): Promise<Transfert>;
  listContacts(canalId: string): Promise<ChannelContact[]>;
  listMessages(contactId: string, limit?: number): Promise<StoredMessage[]>;
  listTransferts(canalId: string): Promise<Transfert[]>;
  resolveTransferts(contactId: string): Promise<void>;
  /** Notifications push (Web Push) : abonnements des administrateurs, un par appareil (bot_push_abonnements). */
  savePushSubscription(subscription: PushSubscriptionRecord): Promise<void>;
  listPushSubscriptions(userId?: string): Promise<PushSubscriptionRecord[]>;
  deletePushSubscription(endpoint: string): Promise<void>;
  /** Base de connaissances du bot PFlow Démo (null : pas encore enregistrée, la base par défaut s'applique). */
  getDemoKnowledge(): Promise<DemoKnowledge | null>;
  saveDemoKnowledge(knowledge: DemoKnowledge): Promise<void>;
}

/** Un message reçu par un webhook, prêt pour le moteur. */
export interface InboundEvent {
  plateforme: Plateforme;
  accountId: string;
  /** Numéro du client (pour un écho : le destinataire du message du gérant). */
  waId: string;
  profileName?: string;
  wamid: string;
  timestamp: string;
  message: IncomingMessage;
  /** Réaction, message système… : noté, sans réponse. */
  ignored?: boolean;
  /** Contenu pour la boîte de réception. */
  type: string;
  contenu: unknown;
  /** Média à télécharger (message vocal) : identifiant WhatsApp ou adresse Instagram. */
  media?: MediaRef;
}

export interface StatusEvent {
  plateforme: Plateforme;
  accountId: string;
  wamid: string;
  statut: "envoye" | "delivre" | "lu" | "echec";
  erreur?: string;
}
