import { describe, expect, it } from "vitest";
import type { FlowNode } from "@/engine";
import type { FlowGraph } from "@/data/types";
import { CLIPBOARD_FORMAT, copyBlocks, parseClipboard, pasteBlocks } from "../clipboard";
import { createNode, nodeOutputs } from "../catalog";
import { connect, pruneEdges } from "../graph";
import { createHistory, record, redo, undo } from "../history";
import { issuesByNode, lintFlow, type Issue } from "../lint";
import { flowVariables, insertVariable, usedVariables } from "../variables";

const at = { x: 0, y: 0 };
const n = (node: Omit<FlowNode, "position">): FlowNode => ({ ...node, position: at }) as FlowNode;

/** Flux valide : déclencheur → message → boutons (2 sorties reliées). */
function validGraph(): FlowGraph {
  return {
    nodes: [
      n({ id: "t", type: "trigger", data: { keywords: ["menu"] } }),
      n({ id: "m", type: "message", data: { text: "Bonjour {{prenom}}" } }),
      n({
        id: "b",
        type: "buttons",
        data: { text: "Choisissez", buttons: [{ id: "x", title: "Commander" }, { id: "y", title: "Horaires" }] },
      }),
      n({ id: "l", type: "order_link", data: {} }),
      n({ id: "f", type: "end", data: { text: "Merci" } }),
    ],
    edges: [
      { id: "1", source: "t", sourceHandle: "next", target: "m" },
      { id: "2", source: "m", sourceHandle: "next", target: "b" },
      { id: "3", source: "b", sourceHandle: "x", target: "l" },
      { id: "4", source: "b", sourceHandle: "y", target: "f" },
    ],
  };
}

const ctx = { flowId: "f1", flows: [{ id: "f1", name: "Accueil" }, { id: "f2", name: "Agneau" }], orderSlug: "mexico" };
const errors = (issues: Issue[]) => issues.filter((i) => i.level === "error");

describe("vérification du flux (lint)", () => {
  it("un flux correct n'a aucune erreur", () => {
    expect(errors(lintFlow(validGraph(), ctx))).toEqual([]);
  });

  it("bouton non relié : erreur sur le bloc", () => {
    const g = validGraph();
    g.edges = g.edges.filter((e) => e.id !== "4");
    const issues = errors(lintFlow(g, ctx));
    expect(issues).toContainEqual({ level: "error", message: "Bouton « Horaires » non relié.", nodeId: "b" });
    // Le bloc « Fin » n'est plus atteignable : il est orphelin.
    expect(issues).toContainEqual({ level: "error", message: "Bloc non relié au déclencheur.", nodeId: "f" });
  });

  it("limites WhatsApp : 3 boutons, 20 caractères", () => {
    const g = validGraph();
    const b = g.nodes.find((x) => x.id === "b") as Extract<FlowNode, { type: "buttons" }>;
    b.data.buttons = [
      { id: "x", title: "Un titre beaucoup trop long" },
      { id: "y", title: "B" },
      { id: "z", title: "C" },
      { id: "w", title: "D" },
    ];
    const messages = errors(lintFlow(g, ctx)).map((i) => i.message);
    expect(messages).toContain("WhatsApp limite à 3 boutons.");
    expect(messages).toContain("Bouton « Un titre beaucoup trop long » trop long (27 / 20).");
  });

  it("limites WhatsApp : liste de 10 choix, titres de 24 caractères", () => {
    const g: FlowGraph = {
      nodes: [
        n({ id: "t", type: "trigger", data: { keywords: ["carte"] } }),
        n({
          id: "l",
          type: "list",
          data: {
            text: "Notre carte",
            buttonLabel: "Voir la carte",
            items: Array.from({ length: 11 }, (_, i) => ({ id: `i${i}`, title: i === 0 ? "Un choix vraiment beaucoup trop long" : `Plat ${i}` })),
          },
        }),
      ],
      edges: [{ id: "1", source: "t", target: "l" }],
    };
    const messages = errors(lintFlow(g, ctx)).map((i) => i.message);
    expect(messages).toContain("WhatsApp limite à 10 choix.");
    expect(messages.some((m) => m.startsWith("Choix « Un choix vraiment beaucoup trop long » trop long"))).toBe(true);
  });

  it("pas de déclencheur, ou deux déclencheurs", () => {
    expect(errors(lintFlow({ nodes: [], edges: [] }, ctx))[0].message).toBe("Le flux n'a pas de déclencheur.");
    const g = validGraph();
    g.nodes.push(n({ id: "t2", type: "trigger", data: { keywords: [] } }));
    expect(errors(lintFlow(g, ctx))).toContainEqual({ level: "error", message: "Un flux ne peut avoir qu'un seul déclencheur.", nodeId: "t2" });
  });

  it("aller à un flux : destination obligatoire, absente ou soi-même", () => {
    const base = (flowId: string): FlowGraph => ({
      nodes: [n({ id: "t", type: "trigger", data: { keywords: ["aide"] } }), n({ id: "g", type: "goto_flow", data: { flowId } })],
      edges: [{ id: "1", source: "t", target: "g" }],
    });
    expect(lintFlow(base(""), ctx)[0].message).toBe("Choisissez le flux de destination.");
    expect(lintFlow(base("supprime"), ctx)[0].message).toBe("Le flux de destination n'existe plus.");
    expect(lintFlow(base("f1"), ctx)[0]).toMatchObject({ level: "warning" });
    expect(lintFlow(base("f2"), ctx)).toEqual([]);
  });

  it("variable inconnue : avertissement ; variable d'une question : connue", () => {
    const g = validGraph();
    (g.nodes[1] as Extract<FlowNode, { type: "message" }>).data.text = "Bonjour {{prenom}}, {{couverts}} {{inconnue}}";
    g.nodes.push(n({ id: "q", type: "question", data: { text: "Combien ?", variable: "couverts", validation: "nombre" } }));
    g.edges.push({ id: "5", source: "l", sourceHandle: "next", target: "q" });
    const warnings = lintFlow(g, ctx).filter((i) => i.level === "warning").map((i) => i.message);
    expect(warnings).toContain("Variable {{inconnue}} jamais définie : elle sera vide.");
    expect(warnings.some((w) => w.includes("couverts"))).toBe(false);
  });

  it("lien de commande sans slug : erreur", () => {
    expect(errors(lintFlow(validGraph(), { ...ctx, orderSlug: "" }))[0]).toMatchObject({ nodeId: "l" });
  });

  it("question : nom de variable invalide", () => {
    const g = validGraph();
    g.nodes.push(n({ id: "q", type: "question", data: { text: "Prénom ?", variable: "Mon prénom", validation: "texte" } }));
    g.edges.push({ id: "5", source: "l", sourceHandle: "next", target: "q" });
    expect(errors(lintFlow(g, ctx))[0].message).toContain("Nom de variable invalide");
  });

  it("regroupe les problèmes par bloc", () => {
    const g = validGraph();
    g.edges = [];
    const map = issuesByNode(lintFlow(g, ctx));
    expect(map.get("b")?.length).toBeGreaterThan(1);
  });
});

describe("flèches", () => {
  it("une sortie ne peut être reliée qu'à un seul bloc : la nouvelle flèche remplace l'ancienne", () => {
    const g = connect(validGraph(), "b", "x", "f");
    const fromX = g.edges.filter((e) => e.source === "b" && e.sourceHandle === "x");
    expect(fromX).toHaveLength(1);
    expect(fromX[0].target).toBe("f");
  });

  it("on ne peut pas relier un bloc vers le déclencheur, ni vers lui-même", () => {
    const g = validGraph();
    expect(connect(g, "m", "next", "t").edges.some((e) => e.target === "t")).toBe(false);
    expect(connect(g, "m", "next", "m")).toBe(g);
  });

  it("supprimer un bouton supprime sa flèche", () => {
    const g = validGraph();
    const b = g.nodes.find((x) => x.id === "b") as Extract<FlowNode, { type: "buttons" }>;
    b.data.buttons = b.data.buttons.filter((x) => x.id !== "y");
    expect(pruneEdges(g).edges.map((e) => e.id)).toEqual(["1", "2", "3"]);
  });

  it("chaque bloc expose les bonnes sorties", () => {
    expect(nodeOutputs(createNode("condition", at)).map((o) => o.id)).toEqual(["vrai", "faux"]);
    expect(nodeOutputs(createNode("question", at)).map((o) => o.id)).toEqual(["next", "echec"]);
    expect(nodeOutputs(createNode("end", at))).toEqual([]);
    expect(nodeOutputs(createNode("buttons", at))).toHaveLength(2);
  });
});

describe("annuler / rétablir", () => {
  it("annule et rétablit", () => {
    let h = createHistory(1);
    h = record(h, 2, undefined, 0);
    h = record(h, 3, undefined, 10);
    h = undo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present).toBe(2);
  });

  it("une nouvelle modification efface ce qu'on pouvait rétablir", () => {
    let h = record(createHistory("a"), "b");
    h = undo(h);
    h = record(h, "c");
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });

  it("la frappe dans un même champ ne forme qu'une étape", () => {
    let h = createHistory("");
    h = record(h, "B", "m:text", 0);
    h = record(h, "Bo", "m:text", 300);
    h = record(h, "Bon", "m:text", 600);
    expect(h.past).toEqual([""]);
    h = record(h, "Bonjour", "m:text", 5000); // pause > 1 s : nouvelle étape
    expect(h.past).toEqual(["", "Bon"]);
    expect(undo(undo(h)).present).toBe("");
  });

  it("garde au plus 100 étapes", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 150; i++) h = record(h, i);
    expect(h.past).toHaveLength(100);
  });
});

describe("copier / coller / dupliquer", () => {
  it("colle les blocs avec de nouveaux ids et garde les flèches entre eux", () => {
    const g = validGraph();
    const payload = copyBlocks(g, ["b", "l", "f"])!;
    expect(payload.edges.map((e) => e.id)).toEqual(["3", "4"]);
    let i = 0;
    const { graph, pastedIds, skippedTriggers } = pasteBlocks(g, payload, 40, () => `n${++i}`);
    expect(pastedIds).toEqual(["buttons-n1", "order_link-n2", "end-n3"]);
    expect(skippedTriggers).toBe(0);
    expect(graph.nodes).toHaveLength(8);
    const pastedButtons = graph.nodes.find((x) => x.id === "buttons-n1")!;
    expect(pastedButtons.position).toEqual({ x: 40, y: 40 });
    expect(graph.edges.filter((e) => e.source === "buttons-n1").map((e) => e.target)).toEqual(["order_link-n2", "end-n3"]);
  });

  it("ne duplique jamais le déclencheur", () => {
    const g = validGraph();
    const { pastedIds, skippedTriggers } = pasteBlocks(g, copyBlocks(g, ["t", "m"])!);
    expect(pastedIds).toHaveLength(1);
    expect(skippedTriggers).toBe(1);
  });

  it("le presse-papiers est validé avant collage", () => {
    const valid = JSON.stringify(copyBlocks(validGraph(), ["m"]));
    expect(parseClipboard(valid)?.nodes).toHaveLength(1);
    expect(parseClipboard("n'importe quoi")).toBeNull();
    expect(parseClipboard(JSON.stringify({ format: CLIPBOARD_FORMAT, nodes: [{ id: "x", type: "pirate" }], edges: [] }))).toBeNull();
  });
});

describe("variables", () => {
  it("liste les variables intégrées et celles des questions", () => {
    const names = flowVariables([n({ id: "q", type: "question", data: { text: "", variable: "couverts", validation: "nombre" } })]).map((v) => v.name);
    expect(names).toEqual(["prenom", "nom_resto", "lien_commande", "couverts"]);
  });

  it("insère une variable au curseur", () => {
    expect(insertVariable("Bonjour !", "prenom", 7)).toEqual({ text: "Bonjour {{prenom}} !", cursor: 18 });
    expect(insertVariable("", "prenom", 0)).toEqual({ text: "{{prenom}}", cursor: 10 });
    expect(insertVariable("Salut XX", "prenom", 6, 8).text).toBe("Salut {{prenom}}");
  });

  it("repère les variables utilisées", () => {
    expect(usedVariables("{{ prenom }} et {{nom_resto}}")).toEqual(["prenom", "nom_resto"]);
  });
});
