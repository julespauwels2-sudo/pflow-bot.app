import type { Flow, FlowEdge, FlowNode, InfoSheet } from "@/engine";

/** Client (resto) tel que vu par l'app bots. À l'étape B : lu depuis le CRM + réglages bot_. */
export interface BotClient {
  id: string;
  nomResto: string;
  /** Slug du mini-site : order.pflow.fr/c/<slug> */
  orderSlug: string;
  /** Fuseau IANA, America/Guadeloupe par défaut. */
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export type NewClient = Pick<BotClient, "nomResto" | "orderSlug"> & Partial<Pick<BotClient, "timezone">>;
export type ClientPatch = Partial<Pick<BotClient, "nomResto" | "orderSlug" | "timezone">>;

/** Contenu d'un flux (format React Flow). */
export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface StoredFlow {
  id: string;
  clientId: string;
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

export type NewFlow = { clientId: string; name: string; description?: string; draft?: FlowGraph };
export type FlowPatch = Partial<Pick<StoredFlow, "name" | "description" | "draft">>;

/** Flux publié, au format attendu par le moteur. */
export function toEngineFlow(flow: StoredFlow): Flow | null {
  if (!flow.published || !flow.publishedMeta) return null;
  return {
    id: flow.id,
    name: flow.publishedMeta.name,
    description: flow.publishedMeta.description,
    nodes: flow.published.nodes,
    edges: flow.published.edges,
  };
}

/** Vrai si le brouillon a changé depuis la dernière publication. */
export function hasUnpublishedChanges(flow: StoredFlow): boolean {
  if (!flow.published || !flow.publishedMeta) return true;
  return (
    JSON.stringify(flow.draft) !== JSON.stringify(flow.published) ||
    flow.name !== flow.publishedMeta.name ||
    (flow.description ?? "") !== (flow.publishedMeta.description ?? "")
  );
}

export const EMPTY_INFO_SHEET: InfoSheet = { horaires: [] };

/** Contenu complet du stockage local (et format de la sauvegarde complète). */
export interface WorkspaceData {
  clients: BotClient[];
  flows: StoredFlow[];
  infoSheets: Record<string, InfoSheet>;
}
