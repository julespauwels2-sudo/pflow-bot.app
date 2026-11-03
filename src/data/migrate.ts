/**
 * Mise à niveau des flux enregistrés avec une ancienne version de l'éditeur.
 * Aujourd'hui : l'ancien bloc « Boutons » devient un bloc Message avec boutons
 * (même id, mêmes ids de boutons : les flèches restent valides).
 */
import type { FlowNode } from "@/engine";
import type { FlowGraph } from "./types";

export function migrateGraph(graph: FlowGraph): FlowGraph {
  if (!graph.nodes.some((n) => n.type === "buttons")) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((n): FlowNode =>
      n.type === "buttons" ? { id: n.id, type: "message", position: n.position, data: { text: n.data.text, buttons: n.data.buttons } } : n,
    ),
  };
}
