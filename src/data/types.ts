import type { AiDecision, AiTextMode, AiUsage, Flow, FlowEdge, FlowNode, InfoSheet, TriggerMode } from "@/engine";
import type { BotOption } from "./options";

/** Client (resto) tel que vu par l'app bots. À l'étape B : lu depuis le CRM + réglages bot_. */
export interface BotClient {
  id: string;
  nomResto: string;
  /** Slug du mini-site : order.pflow.fr/c/<slug> */
  orderSlug: string;
  /** Fuseau IANA, America/Guadeloupe par défaut. */
  timezone: string;
  /**
   * Mode de déclenchement du canal WhatsApp. Provisoire (étape A) : à l'étape C, il sera porté
   * par chaque canal (bot_channels). « mots_cles_uniquement » pour les numéros en coexistence
   * (numéro perso du gérant) : le bot ne répond qu'aux mots-clés.
   */
  triggerMode: TriggerMode;
  /** Bot lié au modèle maître : ses flux publiés s'ajoutent à ceux du client. Absent = non lié. */
  template?: { templateId: string; linkedAt: string };
  /** Options payantes activées (ex. relance panier abandonné). */
  options?: Partial<Record<BotOption, boolean>>;
  createdAt: string;
  updatedAt: string;
}

export type NewClient = Pick<BotClient, "nomResto" | "orderSlug"> & Partial<Pick<BotClient, "timezone" | "triggerMode">>;
export type ClientPatch = Partial<Pick<BotClient, "nomResto" | "orderSlug" | "timezone" | "triggerMode" | "options">>;

/** Contenu d'un flux (format React Flow). */
export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** Propriétaire d'un flux ou d'un dossier : un client, ou le modèle maître. */
export type OwnerKind = "client" | "template";

/**
 * Modèle maître : la trame commune à tous les bots, écrite uniquement avec des variables.
 * Un seul pour l'instant (le format en permet plusieurs).
 */
export interface BotTemplate {
  id: string;
  name: string;
  /** Agent IA du modèle (consigne, réglages, fonctions) : configuré à l'étape A6. */
  agent?: TemplateAgent;
  createdAt: string;
  updatedAt: string;
}

/** Fonction de l'agent : un flux du modèle que l'IA a le droit de lancer. */
export interface TemplateAgentFunction {
  /** Nom vu par l'IA (minuscules, chiffres et _), ex. lancer_commande. */
  name: string;
  /** Flux du modèle (dans un bot lié, sa personnalisation éventuelle). */
  flowId: string;
  description: string;
  /** Absent = « silence » (l'IA se tait, le flux répond seul). */
  aiText?: AiTextMode;
}

/** Agent IA du modèle maître : consigne générale, réglages et fonctions. */
export interface TemplateAgent {
  /** Consigne générale ({{nom_resto}} et les autres variables sont remplacées pour chaque client). */
  consigne?: string;
  /** Modèle Claude (absent = celui du serveur, ANTHROPIC_MODEL). */
  model?: string;
  /** Appels IA maximum par contact et par jour (jour du fuseau du client). */
  dailyLimit?: number;
  /** Délai d'inactivité par défaut des blocs IA, en minutes. */
  inactivityMinutes?: number;
  functions?: TemplateAgentFunction[];
}

/** Ligne du journal des appels IA (coût et tokens suivis par client). */
export interface AiCallLog {
  id: string;
  clientId: string;
  /** Date réelle de l'appel. */
  at: string;
  source: "simulateur" | "whatsapp";
  model?: string;
  /** Message (ou texte d'entrée) envoyé à l'IA. */
  message: string;
  decision?: AiDecision;
  usage?: AiUsage;
  costUsd?: number | null;
  /** Erreur (l'IA n'a pas répondu : le contact a été passé à l'équipe). */
  error?: string;
}

/**
 * Dossier de flux (un seul niveau, comme dans UChat). `ownerId` = id du client
 * ou du modèle maître.
 */
export interface BotFolder {
  id: string;
  ownerId: string;
  name: string;
  /** Ordre d'affichage (0, 1, 2…). */
  order: number;
}

export interface StoredFlow {
  id: string;
  ownerKind: OwnerKind;
  /** Id du client ou du modèle maître. */
  ownerId: string;
  /** Dossier du flux (absent = « Sans dossier »). */
  folderId?: string;
  /**
   * Flux personnalisé : copie d'un flux du modèle qui le remplace pour ce client seulement.
   * Il garde l'id du flux du modèle dans le bot, pour que les « Aller à un flux » restent bons.
   */
  overridesTemplateFlowId?: string;
  /** Version du flux du modèle au moment de la personnalisation. */
  basedOnTemplateVersion?: number;
  name: string;
  description?: string;
  /** Version en cours d'édition. */
  draft: FlowGraph;
  /** Version utilisée par le bot (null tant que le flux n'a jamais été publié). */
  published: FlowGraph | null;
  /** Nom et description au moment de la publication. */
  publishedMeta: { name: string; description?: string } | null;
  publishedAt: string | null;
  /** Incrémenté à chaque publication. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type NewFlow = {
  ownerId: string;
  /** Par défaut : client. */
  ownerKind?: OwnerKind;
  name: string;
  description?: string;
  draft?: FlowGraph;
  folderId?: string;
};
/** `folderId: null` sort le flux de son dossier. */
export type FlowPatch = Partial<Pick<StoredFlow, "name" | "description" | "draft">> & { folderId?: string | null };

/** Flux publié, au format attendu par le moteur. */
export function toEngineFlow(flow: Pick<StoredFlow, "id" | "published" | "publishedMeta">): Flow | null {
  if (!flow.published || !flow.publishedMeta) return null;
  return {
    id: flow.id,
    name: flow.publishedMeta.name,
    description: flow.publishedMeta.description,
    nodes: flow.published.nodes,
    edges: flow.published.edges,
  };
}

/** JSON indépendant de l'ordre des clés (le stockage peut les réordonner). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Vrai si le brouillon a changé depuis la dernière publication. */
export function hasUnpublishedChanges(flow: StoredFlow): boolean {
  if (!flow.published || !flow.publishedMeta) return true;
  return (
    stableStringify(flow.draft) !== stableStringify(flow.published) ||
    flow.name !== flow.publishedMeta.name ||
    (flow.description ?? "") !== (flow.publishedMeta.description ?? "")
  );
}

export const EMPTY_INFO_SHEET: InfoSheet = { horaires: [] };

/** Contenu complet du stockage local (et format de la sauvegarde complète). */
export interface WorkspaceData {
  clients: BotClient[];
  flows: StoredFlow[];
  folders: BotFolder[];
  templates: BotTemplate[];
  infoSheets: Record<string, InfoSheet>;
  /** Journal des appels IA (les plus récents à la fin). */
  aiCalls: AiCallLog[];
}
