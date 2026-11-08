/**
 * Types du moteur PFlow Bots.
 *
 * Ce dossier (`src/engine`) ne dépend de rien d'autre : ni Next.js, ni WhatsApp,
 * ni base de données. Le simulateur et le webhook WhatsApp l'utilisent tels quels.
 */

import type { OrderEvent } from "./events";

// ---------------------------------------------------------------------------
// Client, canal, fiche d'infos
// ---------------------------------------------------------------------------

export type TriggerMode = "mots_cles_uniquement" | "toujours";

export const DEFAULT_TIMEZONE = "America/Guadeloupe";
export const DEFAULT_ORDER_BASE_URL = "https://order.pflow.fr/c/";

export interface ClientContext {
  id: string;
  nomResto: string;
  /** Slug du mini-site de commande : order.pflow.fr/c/<slug> */
  orderSlug: string;
  /** Fuseau IANA du resto (ex. America/Guadeloupe, America/Martinique). */
  timezone: string;
  orderBaseUrl?: string;
  /**
   * Adresse complète de la page de commande, à la place de celle du slug. Démos : la page de
   * démonstration du CRM (aucune commande réelle). Absente avec un slug vide : pas de bouton.
   */
  orderUrl?: string;
  /**
   * Démo jouée sur le numéro PFlow. sansCarte : la carte du resto n'est pas (encore) dans la démo. L'IA ne
   * connaît alors aucun produit ni aucun prix : elle le dit, ses réponses portent les boutons PFlow
   * (« Je veux le mien », « Tester la démo ») et les fonctions de commande lui sont retirées.
   * ficheVide : ni carte ni fiche remplie. Les champs du CRM (livraison / retrait, horaires, zones, adresse,
   * paiement) sont alors ses valeurs par défaut, pas des infos du resto : l'IA ne les reçoit pas, et dit que
   * ces infos ne sont pas encore renseignées.
   * boutons : ces boutons, avec des ids compris par le bot PFlow de base.
   */
  demo?: { sansCarte: boolean; ficheVide: boolean; boutons: ChoiceOption[] };
}

export interface ChannelConfig {
  id: string;
  clientId: string;
  triggerMode: TriggerMode;
  /** Pause du bot après un message envoyé par le gérant depuis l'appli (coexistence). */
  echoPauseHours: number;
  /** Pause du bot après un transfert humain. */
  handoffPauseHours: number;
  /** Durée d'inactivité après laquelle une session expire. */
  sessionTimeoutMinutes: number;
  /** Nombre maximum d'appels IA par contact et par jour (jour du fuseau du client). */
  aiDailyLimitPerContact: number;
}

export const DEFAULT_CHANNEL_SETTINGS = {
  echoPauseHours: 12,
  handoffPauseHours: 24,
  sessionTimeoutMinutes: 30,
  aiDailyLimitPerContact: 20,
} as const;

/** 1 = lundi … 7 = dimanche (norme ISO). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface TimeRange {
  /** "HH:MM" */
  de: string;
  /** "HH:MM" — si `a` < `de`, la plage passe minuit. */
  a: string;
}

export interface OpeningDay {
  jour: IsoWeekday;
  plages: TimeRange[];
}

/** Tournée de livraison (mode « sur planning ») : date locale du client. */
export interface DeliveryRound {
  id: string;
  /** "YYYY-MM-DD" (jour dans le fuseau du client). */
  date: string;
  /** Plage horaire facultative, "HH:MM". */
  de?: string;
  a?: string;
  /** Zone ou entreprises desservies. */
  lieux: string;
}

/** Jours de livraison fixes d'une zone, chaque semaine (ex. Jarry : mardi, mercredi, vendredi). */
export interface DeliveryDays {
  id: string;
  /** Nom de la zone (de préférence le même que dans les zones de livraison). */
  zone: string;
  jours: IsoWeekday[];
  /** Précision facultative (ex. « le midi », « à partir de 10 commandes »). */
  note?: string;
}

export interface OnlinePayment {
  mode: "choix" | "obligatoire" | "non";
  aConfigurer: boolean;
}

export interface InfoSheet {
  /** Horaires d'ouverture, exprimés dans le fuseau du client. Un jour absent = fermé. */
  horaires: OpeningDay[];
  horairesNote?: string;
  adresse?: string;
  livraison?: boolean;
  /**
   * « zones » : zones fixes (texte libre). « planning » : tournées à des dates précises
   * (ex. livraison en entreprises) ; seules les tournées à venir sont utilisées.
   */
  livraisonMode?: "zones" | "planning";
  tournees?: DeliveryRound[];
  /**
   * Jours fixes par zone, chaque semaine. S'il y en a, ils sont toujours annoncés ; des tournées
   * datées à venir s'y ajoutent comme livraisons exceptionnelles.
   */
  joursLivraison?: DeliveryDays[];
  retrait?: boolean;
  /**
   * Paiement en ligne, lu dans le CRM (mode réellement en vigueur, fonction paiement_mode_public) :
   * « choix » (en ligne par carte ou sur place), « obligatoire » (en ligne seulement), « non » (sur
   * place seulement). aConfigurer : aucun prestataire de paiement en ligne prêt (onboarding).
   * Absent hors CRM (mode local).
   */
  paiementEnLigne?: OnlinePayment;
  /** Précisions sur le paiement sur place (facultatif), ex. « Espèces, carte, tickets resto ». */
  modesPaiement?: string;
  zonesLivraison?: string;
  pointsDeVente?: string;
  /** Carte complète pour l'IA (produits, prix, allergènes). Étape B : lue dans PFlow Order. */
  resumeCarte?: string;
  /** Questions fréquentes, en texte libre (pour l'IA). */
  faq?: string;
  reglesSpeciales?: string;
}

// ---------------------------------------------------------------------------
// Flux (format compatible React Flow : nodes + edges)
// ---------------------------------------------------------------------------

export interface Position {
  x: number;
  y: number;
}

export interface ChoiceOption {
  id: string;
  title: string;
  description?: string;
}

/** Bouton de réponse : a sa propre sortie dans le flux. */
export interface ReplyButton {
  id: string;
  kind: "reply";
  title: string;
}

/** Bouton lien (bouton natif WhatsApp « CTA URL ») : ouvre une page, pas de sortie. */
export interface LinkButton {
  id: string;
  kind: "link";
  title: string;
  /** URL libre (variables {{...}} acceptées). Ignorée si `orderLink`. */
  url?: string;
  /** Lien de commande du client : order.pflow.fr/c/<slug>, calculé à l'envoi. */
  orderLink?: boolean;
}

export type BubbleButton = ReplyButton | LinkButton;

/**
 * Une bulle = un message WhatsApp. Règles WhatsApp : soit aucun bouton, soit 1 à 3 boutons
 * de réponse, soit 1 bouton lien — jamais de mélange.
 */
export interface MessageBubble {
  id: string;
  text: string;
  buttons: BubbleButton[];
}

export type QuestionValidation = "texte" | "nombre" | "telephone" | "oui_non";

export type ConditionRule =
  | {
      kind: "variable";
      variable: string;
      operator: "egal" | "different" | "contient" | "existe" | "vide" | "superieur" | "inferieur";
      value?: string;
    }
  /** Jours de la semaine dans le fuseau du client. */
  | { kind: "jour"; jours: IsoWeekday[] }
  /** Plage horaire dans le fuseau du client (peut passer minuit). */
  | { kind: "heure"; de: string; a: string }
  /** Ouvert maintenant d'après les horaires de la fiche d'infos. */
  | { kind: "ouvert_maintenant" };

export interface NodeDataMap {
  trigger: {
    keywords: string[];
    matchMode?: "contient" | "exact";
    /**
     * Flux par défaut : lancé par n'importe quel message quand aucun mot-clé ne correspond
     * et qu'aucune session n'est en cours. Un seul par client. Jamais sur un canal
     * en mode « mots-clés uniquement ».
     */
    isDefault?: boolean;
    /**
     * Déclencheur « Événement PFlow Order » : le flux est lancé par cet événement (commande
     * validée, prête…), jamais par un message. Mots-clés et flux par défaut sont alors ignorés.
     */
    event?: OrderEvent;
  };
  /**
   * Plusieurs bulles envoyées à la suite (comme dans UChat). Sorties : une par bouton de
   * réponse, plus « next » (Étape suivante). Si « next » est reliée, la suite part tout de
   * suite et les boutons restent cliquables ; sinon, le bot attend un clic.
   */
  message: { bubbles: MessageBubble[] };
  list: { text: string; buttonLabel: string; items: ChoiceOption[] };
  question: {
    text: string;
    variable: string;
    validation: QuestionValidation;
    errorText?: string;
    maxRetries?: number;
  };
  condition: { rules: ConditionRule[]; match?: "toutes" | "une" };
  /**
   * Agent IA (comme l'action « Agent IA » d'UChat). Le bot reste sur ce bloc et l'IA répond à
   * chaque message, jusqu'à une fonction, un transfert, un mot-clé ou l'inactivité.
   */
  ai: {
    /** Message envoyé en arrivant sur le bloc (facultatif). */
    intro?: string;
    /**
     * Texte d'entrée : si rempli, l'IA est appelée tout de suite avec ce texte (variables
     * acceptées), sans attendre de message. Ex. : « Le client a choisi le goût {{choix}}. »
     */
    input?: string;
    /** Consigne propre à ce bloc, ajoutée à celle de l'agent. */
    instructions?: string;
    /** Noms des fonctions autorisées dans ce bloc. Absent = toutes les fonctions de l'agent. */
    functions?: string[];
    /** Délai d'inactivité (minutes) avant que l'IA ne lâche la conversation. Absent = réglage de l'agent. */
    inactivityMinutes?: number;
  };
  handoff: { text?: string };
  /**
   * Commande du client dans PFlow Order (étape C5), par le pont existant : « suivi » (où en est sa
   * dernière commande) ou « annulation » (toujours précédée d'une confirmation dans le flux). La réponse
   * de PFlow Order est envoyée telle quelle, puis le flux continue.
   */
  commande: { action: OrderAction };
  goto_flow: { flowId: string };
  end: { text?: string };
  /** Pause avec l'indicateur « en train d'écrire ». */
  delay: { mode: "fixe" | "intelligent"; seconds?: number };
}

export type NodeType = keyof NodeDataMap;

export type FlowNodeOf<T extends NodeType> = {
  id: string;
  type: T;
  position: Position;
  data: NodeDataMap[T];
};

export type FlowNode = { [T in NodeType]: FlowNodeOf<T> }[NodeType];

export interface FlowEdge {
  id: string;
  source: string;
  /** Sortie du bloc : "next", id d'un bouton, "vrai"/"faux", "echec"… */
  sourceHandle?: string | null;
  target: string;
}

export interface Flow {
  id: string;
  name: string;
  /** Utilisée par l'IA pour choisir le bon flux. */
  description?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ---------------------------------------------------------------------------
// Contact et session
// ---------------------------------------------------------------------------

export type PauseReason = "transfert_humain" | "echo_gerant" | "manuel";

export interface ContactState {
  /** wa_id (numéro WhatsApp) ou identifiant du simulateur. */
  id: string;
  profileName?: string;
  pause: { reason: PauseReason; until: string | null } | null;
  lastInboundAt?: string;
  /** Compteur d'appels IA, remis à zéro chaque jour (jour du fuseau du client). */
  aiUsage: { day: string; calls: number };
}

/** Échange gardé en mémoire pendant une conversation avec l'IA (bloc IA). */
export interface AiTurn {
  role: "client" | "assistant";
  text: string;
}

export interface Session {
  flowId: string;
  /** Bloc qui attend la réponse du contact. */
  nodeId: string;
  vars: Record<string, string>;
  /** Nombre de réponses invalides au bloc en cours. */
  retries: number;
  startedAt: string;
  expiresAt: string;
  /** Derniers échanges avec l'IA dans le bloc IA en cours (mémoire courte). */
  aiHistory?: AiTurn[];
}

// ---------------------------------------------------------------------------
// Messages entrants / sortants
// ---------------------------------------------------------------------------

export type IncomingMessage =
  | { kind: "text"; text: string }
  | { kind: "button_reply"; id: string; title: string }
  | { kind: "list_reply"; id: string; title: string }
  /** Message envoyé par le gérant lui-même depuis l'appli WhatsApp Business. */
  | { kind: "echo"; text?: string }
  /** Image, audio, localisation… non gérés en phase 1. */
  | { kind: "unsupported"; mediaType: string }
  /** Événement envoyé par PFlow Order (pas un message du contact). */
  | { kind: "event"; event: OrderEvent; data: Record<string, string> }
  /** Simulateur : lance directement un flux (ex. un sous-flux sans mot-clé), comme si le contact écrivait. */
  | { kind: "start_flow"; flowId: string };

export type OutgoingMessage =
  /** Pause avant le message suivant, avec l'indicateur « en train d'écrire ». */
  | { kind: "typing"; ms: number }
  | { kind: "text"; text: string }
  | { kind: "buttons"; text: string; buttons: ChoiceOption[] }
  | { kind: "list"; text: string; buttonLabel: string; items: ChoiceOption[] }
  | { kind: "link"; text: string; url: string; buttonLabel: string };

// ---------------------------------------------------------------------------
// IA (port injecté)
// ---------------------------------------------------------------------------

/**
 * Ce que devient le texte de l'IA quand elle appelle une fonction :
 * - « silence » : l'IA se tait, le flux répond seul (lancer_commande, parler_equipe) ;
 * - « avant » : le texte de l'IA part, puis le flux ;
 * - « variable » : le texte est passé au flux dans {{ia_reponse}} (proposer_commande).
 */
export type AiTextMode = "silence" | "avant" | "variable";

/** Fonction de l'agent : un flux que l'IA a le droit de lancer. */
export interface AgentFunction {
  /** Nom vu par l'IA, ex. lancer_commande. */
  name: string;
  /** Id du flux dans le bot. */
  flowId: string;
  /** Quand l'utiliser : lu par l'IA pour choisir. */
  description: string;
  aiText: AiTextMode;
}

/** Agent IA du bot (consigne et fonctions du modèle maître). */
export interface AgentConfig {
  /** Consigne générale ({{nom_resto}} accepté). */
  consigne: string;
  /** Modèle Claude (absent = celui du serveur). */
  model?: string;
  functions: AgentFunction[];
  /** Délai d'inactivité par défaut des blocs IA (minutes). */
  inactivityMinutes?: number;
}

export interface AiDecision {
  action: "repondre" | "fonction" | "transfert_humain";
  /** Nom de la fonction (action « fonction »). */
  fonction?: string;
  /** Réponse au client, ou texte passé au flux de la fonction. */
  texte?: string;
}

export interface AiRequest {
  message: string;
  /** Échanges précédents dans le bloc IA (du plus ancien au plus récent). */
  history: AiTurn[];
  client: {
    nomResto: string;
    timezone: string;
    maintenantLocal: string;
    lienCommande: string;
    prenomContact?: string;
    /** Démo sur le numéro PFlow (voir ClientContext.demo). */
    demo?: { sansCarte: boolean; ficheVide?: boolean };
  };
  /** Consigne de l'agent, déjà rendue ({{nom_resto}} remplacé). */
  consigne: string;
  model?: string;
  infoSheet: InfoSheet;
  /** Fonctions que l'IA peut appeler ici. */
  functions: { name: string; description: string }[];
  /** Consigne du bloc IA, le cas échéant. */
  instructions?: string;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface AiResult {
  decision: AiDecision;
  usage: AiUsage;
  model?: string;
  /** Coût estimé en dollars (null si le tarif du modèle est inconnu). */
  costUsd?: number | null;
}

export type AiPort = (request: AiRequest) => Promise<AiResult>;

// ---------------------------------------------------------------------------
// Entrée / sortie du moteur
// ---------------------------------------------------------------------------

export interface EngineInput {
  now: Date;
  client: ClientContext;
  channel: ChannelConfig;
  /** Flux publiés du client. */
  flows: Flow[];
  infoSheet: InfoSheet;
  contact: ContactState;
  session: Session | null;
  message: IncomingMessage;
  /** Agent IA (absent = l'IA répond seulement avec la fiche d'infos, sans fonctions). */
  agent?: AgentConfig;
  /**
   * Paramètres ajoutés aux boutons « Commander » (canal WhatsApp) : « via=wa » pour que la page sache
   * que le client vient du bot, et le jeton de pré-remplissage. Absent dans le simulateur.
   */
  orderLinkQuery?: string;
}

/**
 * Bloc Commande : « suivi » (état de la dernière commande), « annulable » (vérifie qu'il y a une commande
 * qui peut encore être annulée : sortie « oui » vers la confirmation, sinon le client reçoit la raison et
 * le flux suit la sortie « non »), « annulation » (annule, après confirmation).
 */
export type OrderAction = "suivi" | "annulable" | "annulation";

/** Pont vers PFlow Order (suivi, annulation) : la réponse est le texte à envoyer au client. */
export interface OrderBridgeRequest {
  action: "suivi" | "annulation";
  /** Slug du resto dans PFlow Order. */
  slug: string;
  /** Numéro WhatsApp du client (identifiant du contact). */
  tel: string;
}
export interface OrderBridgeResult {
  ok: boolean;
  /** Texte pour le client (rédigé par PFlow Order). */
  texte: string;
  /** Code de PFlow Order (ex. ANNULATION_ANNULEE, AUCUNE_COMMANDE). */
  code?: string;
  /** Suivi : une commande récente existe-t-elle ? */
  trouve?: boolean;
  /** Suivi : statut de la dernière commande (nouvelle, attente_paiement, en_preparation, prete, terminee, annulee). */
  statut?: string;
  /** Suivi : numéro de la dernière commande. */
  numero?: string;
}
export type OrderBridge = (request: OrderBridgeRequest) => Promise<OrderBridgeResult>;

export interface EngineDeps {
  /** Absent = pas d'IA disponible (le moteur se rabat sur un transfert ou ignore). */
  ai?: AiPort;
  /** Absent = pont PFlow Order non configuré (le bloc Commande répond un texte de repli). */
  orderBridge?: OrderBridge;
}

export type EngineEvent =
  | {
      type: "ignored";
      reason: "pause" | "aucun_declencheur" | "media_non_gere" | "echo" | "fenetre_fermee" | "aucun_flux_evenement" | "retour_commande";
    }
  | { type: "pause_expired" }
  | { type: "session_expired"; flowId: string }
  | { type: "flow_started"; flowId: string; via: "mot_cle" | "defaut" | "ia" | "aller_au_flux" | "bouton" | "evenement" | "manuel" }
  /** Mot-clé reconnu (avant le lancement du flux). */
  | { type: "keyword_matched"; flowId: string; keyword: string }
  /** Bloc Commande : appel du pont PFlow Order (suivi, annulation). */
  | { type: "order_action"; action: OrderAction; ok: boolean; code?: string; fallback?: boolean; annulable?: boolean }
  /** Mot-clé présent dans une phrase longue : pas de flux, l'IA répond. */
  | { type: "keyword_skipped"; flowId: string; keyword: string }
  /** Bloc exécuté (trace pour le simulateur et le journal). */
  | { type: "step"; flowId: string; nodeId: string; nodeType: string }
  | { type: "flow_ended"; flowId: string }
  | { type: "paused"; reason: PauseReason; until: string | null }
  | { type: "handoff"; source: "bloc" | "ia" | "limite_ia" | "erreur_ia"; message?: string }
  | { type: "ai_called"; decision: AiDecision; usage: AiUsage; model?: string; costUsd?: number | null; message: string }
  /** Garde-fou : lien ou salutation retirés du texte de l'IA (et repli sur le bouton de commande). */
  | { type: "ai_text_cleaned"; removedLinks: string[]; removedGreeting: boolean; fallback?: "proposer_commande" | "bouton_commande" }
  | { type: "ai_unavailable" }
  | { type: "error"; message: string };

export interface EngineResult {
  contact: ContactState;
  session: Session | null;
  outgoing: OutgoingMessage[];
  events: EngineEvent[];
}
