/**
 * État de l'éditeur : blocs et flèches au format React Flow + historique.
 * Tout passe par ce reducer : chaque action « métier » = une étape d'annulation.
 */
import { applyEdgeChanges, applyNodeChanges, type Edge, type EdgeChange, type Node, type NodeChange } from "@xyflow/react";
import type { FlowNode, NodeDataMap } from "@/engine";
import type { FlowGraph } from "@/data/types";
import { copyBlocks, pasteBlocks, type ClipboardPayload } from "@/editor/clipboard";
import { cleanEdge, cleanNode, connect, pruneEdges } from "@/editor/graph";
import { createHistory, record, redo, undo, type History } from "@/editor/history";

export type RFNode = Node<FlowNode["data"]> & { type: FlowNode["type"] };
export type RFEdge = Edge;

export interface EditorState {
  nodes: RFNode[];
  edges: RFEdge[];
  history: History<FlowGraph>;
}

export type EditorAction =
  | { type: "nodesChange"; changes: NodeChange<RFNode>[]; now: number }
  | { type: "edgesChange"; changes: EdgeChange<RFEdge>[]; now: number }
  | { type: "connect"; source: string; sourceHandle: string | null; target: string; now: number }
  | { type: "add"; node: FlowNode; now: number }
  | { type: "updateData"; id: string; data: FlowNode["data"]; key: string; now: number }
  | { type: "deleteSelected"; now: number }
  | { type: "deleteEdge"; id: string; now: number }
  | { type: "paste"; payload: ClipboardPayload; offset: number; now: number }
  | { type: "selectOnly"; ids: string[] }
  | { type: "selectAll" }
  | { type: "undo" }
  | { type: "redo" };

function toRFNode(node: FlowNode, selected = false): RFNode {
  return { ...structuredClone(node), selected, deletable: node.type !== "trigger" } as RFNode;
}

function toRFEdge(edge: FlowGraph["edges"][number]): RFEdge {
  return { ...edge, sourceHandle: edge.sourceHandle ?? "next" };
}

export function graphOf(state: Pick<EditorState, "nodes" | "edges">): FlowGraph {
  return {
    nodes: state.nodes.map((n) => cleanNode(n as unknown as FlowNode & Record<string, unknown>)),
    edges: state.edges.map((e) => cleanEdge(e as unknown as FlowGraph["edges"][number] & Record<string, unknown>)),
  };
}

export function initEditor(graph: FlowGraph): EditorState {
  const clean = pruneEdges(graph);
  return { nodes: clean.nodes.map((n) => toRFNode(n)), edges: clean.edges.map(toRFEdge), history: createHistory(clean) };
}

/** Remplace le flux par `graph` en gardant la sélection et les dimensions mesurées. */
function withGraph(state: EditorState, graph: FlowGraph, selectedIds?: Set<string>): EditorState {
  const previous = new Map(state.nodes.map((n) => [n.id, n]));
  const nodes = graph.nodes.map((n) => {
    const old = previous.get(n.id);
    const rf = toRFNode(n, selectedIds ? selectedIds.has(n.id) : (old?.selected ?? false));
    return old?.measured ? { ...rf, measured: old.measured } : rf;
  });
  const selectedEdges = new Set(state.edges.filter((e) => e.selected).map((e) => e.id));
  const edges = graph.edges.map((e) => ({ ...toRFEdge(e), selected: !selectedIds && selectedEdges.has(e.id) }));
  return { ...state, nodes, edges };
}

/** Enregistre l'état courant dans l'historique (si le flux a vraiment changé). */
function commit(state: EditorState, now: number, key?: string): EditorState {
  const graph = pruneEdges(graphOf(state));
  const synced = graph.edges.length === state.edges.length ? state : withGraph(state, graph);
  if (JSON.stringify(graph) === JSON.stringify(synced.history.present)) return synced;
  return { ...synced, history: record(synced.history, graph, key, now) };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "nodesChange": {
      // Les suppressions passent par « deleteSelected » (une seule étape d'annulation).
      const changes = action.changes.filter((c) => c.type !== "remove");
      const next = { ...state, nodes: applyNodeChanges(changes, state.nodes) };
      const moved = changes.some((c) => c.type === "position" && !c.dragging && c.position);
      const dragEnded = changes.some((c) => c.type === "position" && c.dragging === false);
      return moved || dragEnded ? commit(next, action.now, "move") : next;
    }

    case "edgesChange": {
      const changes = action.changes.filter((c) => c.type !== "remove");
      return { ...state, edges: applyEdgeChanges(changes, state.edges) };
    }

    case "connect": {
      const graph = connect(graphOf(state), action.source, action.sourceHandle, action.target);
      return commit(withGraph(state, graph), action.now);
    }

    case "add": {
      const graph = graphOf(state);
      const next = withGraph(state, { ...graph, nodes: [...graph.nodes, action.node] }, new Set([action.node.id]));
      return commit(next, action.now);
    }

    case "updateData": {
      const nodes = state.nodes.map((n) => (n.id === action.id ? ({ ...n, data: action.data as NodeDataMap[typeof n.type] } as RFNode) : n));
      // Les flèches d'un bouton supprimé sont retirées par commit() (pruneEdges).
      return commit({ ...state, nodes }, action.now, action.key);
    }

    case "deleteSelected": {
      const removedNodes = new Set(state.nodes.filter((n) => n.selected && n.type !== "trigger").map((n) => n.id));
      const nodes = state.nodes.filter((n) => !removedNodes.has(n.id));
      const edges = state.edges.filter((e) => !e.selected && !removedNodes.has(e.source) && !removedNodes.has(e.target));
      if (nodes.length === state.nodes.length && edges.length === state.edges.length) return state;
      return commit({ ...state, nodes, edges }, action.now);
    }

    case "deleteEdge": {
      const edges = state.edges.filter((e) => e.id !== action.id);
      return edges.length === state.edges.length ? state : commit({ ...state, edges }, action.now);
    }

    case "paste": {
      const { graph, pastedIds } = pasteBlocks(graphOf(state), action.payload, action.offset);
      if (!pastedIds.length) return state;
      return commit(withGraph(state, graph, new Set(pastedIds)), action.now);
    }

    case "selectOnly": {
      const ids = new Set(action.ids);
      return {
        ...state,
        nodes: state.nodes.map((n) => (n.selected === ids.has(n.id) ? n : { ...n, selected: ids.has(n.id) })),
        edges: state.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
      };
    }

    case "selectAll":
      return { ...state, nodes: state.nodes.map((n) => (n.selected ? n : { ...n, selected: true })) };

    case "undo":
    case "redo": {
      const history = action.type === "undo" ? undo(state.history) : redo(state.history);
      if (history === state.history) return state;
      return { ...withGraph(state, history.present, new Set()), history };
    }
  }
}

export function selectedNodeIds(state: EditorState): string[] {
  return state.nodes.filter((n) => n.selected).map((n) => n.id);
}

export function copySelection(state: EditorState): ClipboardPayload | null {
  return copyBlocks(graphOf(state), selectedNodeIds(state));
}
