import type { FlowEdge, FlowNode } from "@/engine";
import type { FlowGraph } from "@/data/types";
import { hasInput, nodeOutputs } from "./catalog";

export const handleOf = (edge: Pick<FlowEdge, "sourceHandle">) => edge.sourceHandle ?? "next";

/**
 * Retire les flèches devenues invalides : bloc supprimé, bouton supprimé,
 * flèche vers un déclencheur, ou deuxième flèche sur une même sortie.
 */
export function pruneEdges(graph: FlowGraph): FlowGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const used = new Set<string>();
  const edges = graph.edges.filter((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target || !hasInput(target)) return false;
    const handle = handleOf(edge);
    if (!nodeOutputs(source).some((o) => o.id === handle)) return false;
    const key = `${edge.source}:${handle}`;
    if (used.has(key)) return false;
    used.add(key);
    return true;
  });
  return edges.length === graph.edges.length ? graph : { ...graph, edges };
}

/** Ajoute une flèche ; une sortie déjà reliée est remplacée (une sortie = une seule suite). */
export function connect(graph: FlowGraph, source: string, sourceHandle: string | null, target: string): FlowGraph {
  const handle = sourceHandle ?? "next";
  if (source === target) return graph;
  const edges = graph.edges.filter((e) => !(e.source === source && handleOf(e) === handle));
  edges.push({ id: `e-${source}-${handle}-${target}`, source, sourceHandle: handle, target });
  return pruneEdges({ ...graph, edges });
}

/** Ids des blocs atteignables depuis le déclencheur. */
export function reachableFrom(graph: FlowGraph, startId: string): Set<string> {
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of graph.edges) {
      if (e.source === id && !seen.has(e.target)) {
        seen.add(e.target);
        queue.push(e.target);
      }
    }
  }
  return seen;
}

/** Retire les infos propres à l'affichage (sélection, dimensions…) pour ne garder que le flux. */
export function cleanNode(node: FlowNode & Record<string, unknown>): FlowNode {
  const { id, type, position, data } = node;
  return { id, type, position: { x: Math.round(position.x), y: Math.round(position.y) }, data } as FlowNode;
}

export function cleanEdge(edge: FlowEdge & Record<string, unknown>): FlowEdge {
  return { id: edge.id, source: edge.source, sourceHandle: edge.sourceHandle ?? "next", target: edge.target };
}
