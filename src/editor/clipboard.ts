/** Copier / coller / dupliquer des blocs (avec les flèches entre les blocs copiés). */
import type { FlowEdge, FlowNode } from "@/engine";
import type { FlowGraph } from "@/data/types";
import { flowEdgeSchema, flowNodeSchema } from "@/data/schemas";
import { z } from "zod";
import { shortId } from "./catalog";
import { pruneEdges } from "./graph";

export const CLIPBOARD_FORMAT = "pflow-bots/blocks";
export const CLIPBOARD_KEY = "pflow-bots:clipboard";

export interface ClipboardPayload {
  format: typeof CLIPBOARD_FORMAT;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** Copie les blocs sélectionnés et les flèches qui les relient entre eux. */
export function copyBlocks(graph: FlowGraph, nodeIds: string[]): ClipboardPayload | null {
  const ids = new Set(nodeIds);
  const nodes = graph.nodes.filter((n) => ids.has(n.id));
  if (!nodes.length) return null;
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return structuredClone({ format: CLIPBOARD_FORMAT, nodes, edges });
}

export interface PasteResult {
  graph: FlowGraph;
  pastedIds: string[];
  /** Nombre de déclencheurs ignorés (un flux n'en a qu'un). */
  skippedTriggers: number;
}

/** Colle des blocs avec de nouveaux identifiants, décalés de `offset` pixels. */
export function pasteBlocks(graph: FlowGraph, payload: ClipboardPayload, offset = 40, newId = shortId): PasteResult {
  const idMap = new Map<string, string>();
  const pasted: FlowNode[] = [];
  let skippedTriggers = 0;

  for (const node of payload.nodes) {
    if (node.type === "trigger") {
      skippedTriggers += 1;
      continue;
    }
    const id = `${node.type}-${newId()}`;
    idMap.set(node.id, id);
    pasted.push({
      ...structuredClone(node),
      id,
      position: { x: node.position.x + offset, y: node.position.y + offset },
    });
  }

  const edges: FlowEdge[] = payload.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({
      ...e,
      id: `e-${idMap.get(e.source)}-${e.sourceHandle ?? "next"}-${idMap.get(e.target)}`,
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
    }));

  return {
    graph: pruneEdges({ nodes: [...graph.nodes, ...pasted], edges: [...graph.edges, ...edges] }),
    pastedIds: pasted.map((n) => n.id),
    skippedTriggers,
  };
}

const payloadSchema = z.object({
  format: z.literal(CLIPBOARD_FORMAT),
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
});

/** Lit un presse-papiers (localStorage) en le validant : rien d'invalide n'entre dans le flux. */
export function parseClipboard(text: string | null): ClipboardPayload | null {
  if (!text) return null;
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
