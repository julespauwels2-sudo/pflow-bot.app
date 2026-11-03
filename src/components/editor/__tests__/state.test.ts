import { describe, expect, it } from "vitest";
import type { FlowGraph } from "@/data/types";
import { copySelection, editorReducer, graphOf, initEditor, type EditorAction, type EditorState } from "../state";

const graph: FlowGraph = {
  nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { keywords: ["menu"] } },
    { id: "m", type: "message", position: { x: 300, y: 0 }, data: { text: "Bonjour" } },
    { id: "f", type: "end", position: { x: 600, y: 0 }, data: {} },
  ],
  edges: [
    { id: "e1", source: "t", sourceHandle: "next", target: "m" },
    { id: "e2", source: "m", sourceHandle: "next", target: "f" },
  ],
};

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);

describe("état de l'éditeur", () => {
  it("modifier un texte puis annuler", () => {
    let s = initEditor(graph);
    s = run(s, { type: "updateData", id: "m", data: { text: "Salut" }, key: "m:text", now: 0 });
    expect(graphOf(s).nodes[1].data).toEqual({ text: "Salut" });
    s = run(s, { type: "undo" });
    expect(graphOf(s).nodes[1].data).toEqual({ text: "Bonjour" });
    s = run(s, { type: "redo" });
    expect(graphOf(s).nodes[1].data).toEqual({ text: "Salut" });
  });

  it("supprimer un bloc et ses flèches = une seule étape d'annulation", () => {
    let s = initEditor(graph);
    s = run(s, { type: "selectOnly", ids: ["m"] }, { type: "deleteSelected", now: 0 });
    expect(graphOf(s).nodes.map((n) => n.id)).toEqual(["t", "f"]);
    expect(graphOf(s).edges).toEqual([]);
    s = run(s, { type: "undo" });
    expect(graphOf(s)).toEqual(graph);
  });

  it("le déclencheur ne peut pas être supprimé", () => {
    let s = initEditor(graph);
    s = run(s, { type: "selectAll" }, { type: "deleteSelected", now: 0 });
    expect(graphOf(s).nodes.map((n) => n.id)).toEqual(["t"]);
    expect(s.nodes[0].deletable).toBe(false);
  });

  it("relier une sortie déjà reliée remplace la flèche", () => {
    let s = initEditor(graph);
    s = run(s, { type: "connect", source: "t", sourceHandle: "next", target: "f", now: 0 });
    expect(graphOf(s).edges.filter((e) => e.source === "t").map((e) => e.target)).toEqual(["f"]);
  });

  it("dupliquer : nouveaux blocs sélectionnés, une étape d'annulation", () => {
    let s = initEditor(graph);
    s = run(s, { type: "selectOnly", ids: ["m", "f"] });
    const payload = copySelection(s)!;
    s = run(s, { type: "paste", payload, offset: 40, now: 0 });
    expect(s.nodes).toHaveLength(5);
    expect(s.nodes.filter((n) => n.selected).map((n) => n.type)).toEqual(["message", "end"]);
    expect(graphOf(s).edges).toHaveLength(3);
    s = run(s, { type: "undo" });
    expect(s.nodes).toHaveLength(3);
  });

  it("déplacer un bloc : une étape à la fin du glisser, pas à chaque pixel", () => {
    let s = initEditor(graph);
    s = run(
      s,
      { type: "nodesChange", changes: [{ type: "position", id: "m", position: { x: 310, y: 5 }, dragging: true }], now: 0 },
      { type: "nodesChange", changes: [{ type: "position", id: "m", position: { x: 320, y: 10 }, dragging: true }], now: 10 },
    );
    expect(s.history.past).toHaveLength(0);
    s = run(s, { type: "nodesChange", changes: [{ type: "position", id: "m", position: { x: 330, y: 15 }, dragging: false }], now: 20 });
    expect(s.history.past).toHaveLength(1);
    expect(s.history.present.nodes[1].position).toEqual({ x: 330, y: 15 });
  });

  it("ajouter un bloc le sélectionne", () => {
    let s = initEditor(graph);
    s = run(s, { type: "add", node: { id: "q", type: "question", position: { x: 0, y: 200 }, data: { text: "?", variable: "v", validation: "texte" } }, now: 0 });
    expect(s.nodes.find((n) => n.id === "q")?.selected).toBe(true);
    expect(s.nodes.find((n) => n.id === "m")?.selected).toBe(false);
  });
});
