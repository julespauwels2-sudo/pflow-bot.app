/**
 * Types du moteur PFlow Bots.
 *
 * Ce dossier (`src/engine`) ne dépend de rien d'autre : ni Next.js, ni WhatsApp,
 * ni base de données. Le simulateur et le webhook WhatsApp l'utilisent tels quels.
 */

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

export interface InfoSheet {
  /** Horaires d'ouverture, exprimés dans le fuseau du client. Un jour absent = fermé. */
  horaires: OpeningDay[];
  horairesNote?: string;
  adresse?: string;
  livraison?: boolean;
  retrait?: boolean;
  zonesLivraison?: string;
  pointsDeVente?: string;
  resumeCarte?: string;
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
  };
  /** Texte, éventuellement suivi de boutons de réponse (une sortie par bouton). */
  message: { text: string; buttons?: ChoiceOption[] };
  /** Ancien bloc « Boutons » : toujours exécuté, converti en Message + boutons dans l'éditeur. */
  buttons: { text: string; buttons: ChoiceOption[] };
  list: { text: string; buttonLabel: string; items: ChoiceOption[] };
  question: {
    text: string;
    variable: string;
    validation: QuestionValidation;
    errorText?: string;
    maxRetries?: number;
  };
  condition: { rules: ConditionRule[]; match?: "toutes" | "une" };
  order_link: { text?: string; buttonLabel?: string };
  ai: { intro?: string; instructions?: string };
  handoff: { text?: string };
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

export interface Session {
  flowId: string;
  /** Bloc qui attend la réponse du contact. */
  nodeId: string;
  vars: Record<string, string>;
  /** Nombre de réponses invalides au bloc en cours. */
  retries: number;
  startedAt: string;
  expiresAt: string;
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
  | { kind: "unsupported"; mediaType: string };

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

export interface AiDecision {
  action: "aller_au_flux" | "repondre" | "transfert_humain";
  flux_id?: string;
  texte?: string;
}

export interface AiRequest {
  message: string;
  client: { nomResto: string; timezone: string; maintenantLocal: string; lienCommande: string };
  infoSheet: InfoSheet;
  flows: { id: string; name: string; description?: string }[];
  /** Consignes du bloc IA, le cas échéant. */
  instructions?: string;
}

export interface AiResult {
  decision: AiDecision;
  usage: { inputTokens: number; outputTokens: number };
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
}

export interface EngineDeps {
  /** Absent = pas d'IA disponible (le moteur se rabat sur un transfert ou ignore). */
  ai?: AiPort;
}

export type EngineEvent =
  | { type: "ignored"; reason: "pause" | "aucun_declencheur" | "media_non_gere" | "echo" }
  | { type: "pause_expired" }
  | { type: "session_expired"; flowId: string }
  | { type: "flow_started"; flowId: string; via: "mot_cle" | "defaut" | "ia" | "aller_au_flux" | "bouton" }
  | { type: "flow_ended"; flowId: string }
  | { type: "paused"; reason: PauseReason; until: string | null }
  | { type: "handoff"; source: "bloc" | "ia" | "limite_ia" | "erreur_ia"; message?: string }
  | { type: "ai_called"; decision: AiDecision; usage: AiResult["usage"] }
  | { type: "ai_unavailable" }
  | { type: "error"; message: string };

export interface EngineResult {
  contact: ContactState;
  session: Session | null;
  outgoing: OutgoingMessage[];
  events: EngineEvent[];
}
