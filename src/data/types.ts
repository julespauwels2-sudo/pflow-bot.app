import type { Flow, FlowEdge, FlowNode, InfoSheet, TriggerMode } from "@/engine";

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
  createdAt: string;
  updatedAt: string;
}

export type NewClient = Pick<BotClient, "nomResto" | "orderSlug"> & Partial<Pick<BotClient, "timezone" | "triggerMode">>;
export type ClientPatch = Partial<Pick<BotClient, "nomResto" | "orderSlug" | "timezone" | "triggerMode">>;

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
  infoSheets: Record<string, InfoSheet>;
}
