/**
 * Canaux (WhatsApp, Instagram) : types partagés par les webhooks, l'envoi et la boîte de réception.
 * La logique ne dépend pas de Next.js : elle peut être déplacée (ex. Supabase Edge Functions).
 */
import type { ContactDemo } from "@/demos/router";
import type { ContactState, IncomingMessage, OutgoingMessage, Session, TriggerMode } from "@/engine";

export type Plateforme = "whatsapp" | "instagram";
export type EventSource = Plateforme | "pflow_order";

/** Envoi vers une plateforme (API Graph de WhatsApp, API d'Instagram). */
export interface ChannelSender {
  /** Envoie un message et renvoie son identifiant sur la plateforme. */
  send(accountId: string, to: string, message: OutgoingMessage): Promise<string | undefined>;
  /** Accusé de lecture et « en train d'écrire ». */
  markRead(accountId: string, messageId: string, typing: boolean, to?: string): Promise<void>;
  /** Téléchargement d'un média reçu (message vocal). */
  downloadMedia?(media: MediaRef): Promise<{ data: Uint8Array; mimeType: string }>;
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
  numeroAffiche?: string;
  triggerMode: TriggerMode;
  coexistence: boolean;
  echoPauseHours: number;
  handoffPauseHours: number;
  sessionMinutes: number;
  /** Numéro du gérant prévenu lors d'un transfert. */
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
  at: string;
  vuLe?: string;
  resoluLe?: string;
}

/** Stockage du canal : Supabase (tables de la migration C) ou mémoire (tests, démo locale). */
export interface ChannelStore {
  /** Note un événement reçu. Faux s'il a déjà été reçu (renvoi de Meta) : il n'est pas retraité. */
  claimEvent(source: EventSource, key: string, charge: unknown): Promise<boolean>;
  finishEvent(source: EventSource, key: string, error?: string): Promise<void>;
  canalByAccount(plateforme: Plateforme, accountId: string): Promise<Canal | null>;
  /** Derniers événements reçus (page « État du système »). */
  recentEvents(limit?: number): Promise<{ source: EventSource; key: string; at: string; error?: string }[]>;
  /** Purge des messages plus anciens que la date (préparée, non activée : voir docs/securite.md). */
  purgeMessagesBefore(before: Date): Promise<number>;
  listCanaux(): Promise<Canal[]>;
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
