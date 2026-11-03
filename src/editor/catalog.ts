/** Catalogue des blocs : libellés, valeurs par défaut, sorties. */
import type { FlowNode, NodeDataMap, NodeType } from "@/engine";

export interface BlockInfo {
  label: string;
  description: string;
  /** Couleur d'accent (classe Tailwind de fond). */
  accent: string;
  /** Même couleur en hexadécimal (mini-carte). */
  hex: string;
  icon: string;
}

export const BLOCKS: Record<NodeType, BlockInfo> = {
  trigger: { label: "Déclencheur", description: "Mots-clés qui lancent le flux", accent: "bg-pink", hex: "#FF4FB5", icon: "⚡" },
  message: { label: "Message", description: "Une ou plusieurs bulles, avec boutons", accent: "bg-blue", hex: "#2A8BFF", icon: "💬" },
  list: { label: "Liste", description: "Jusqu'à 10 choix", accent: "bg-blue", hex: "#2A8BFF", icon: "📋" },
  question: { label: "Question", description: "Pose une question, garde la réponse", accent: "bg-cyan", hex: "#74DDFB", icon: "❓" },
  condition: { label: "Condition", description: "Selon une variable, l'heure ou le jour", accent: "bg-navy-2", hex: "#1B2A6B", icon: "🔀" },
  ai: { label: "IA", description: "L'IA répond avec la fiche d'infos", accent: "bg-pink-2", hex: "#FF7CCB", icon: "✨" },
  handoff: { label: "Transfert humain", description: "Met le bot en pause, prévient le gérant", accent: "bg-coral", hex: "#FF6B6B", icon: "🙋" },
  goto_flow: { label: "Aller à un flux", description: "Saute vers un autre flux", accent: "bg-navy", hex: "#101B4D", icon: "↪️" },
  end: { label: "Fin", description: "Termine la conversation", accent: "bg-muted", hex: "#5E6690", icon: "🏁" },
  delay: { label: "Délai", description: "Pause avec « en train d'écrire »", accent: "bg-cyan", hex: "#74DDFB", icon: "⏳" },
};

/** Ordre d'affichage dans la palette. */
export const PALETTE: NodeType[] = [
  "trigger",
  "message",
  "delay",
  "list",
  "question",
  "condition",
  "ai",
  "handoff",
  "goto_flow",
  "end",
];

/** Nombre maximum de bulles dans un bloc Message. */
export const MAX_BUBBLES = 10;

export function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function defaultData<T extends NodeType>(type: T): NodeDataMap[T] {
  const defaults: { [K in NodeType]: NodeDataMap[K] } = {
    trigger: { keywords: [] },
    message: { bubbles: [{ id: `bu${shortId()}`, text: "", buttons: [] }] },
    list: { text: "", buttonLabel: "Voir les choix", items: [{ id: `i${shortId()}`, title: "Choix 1" }] },
    question: { text: "", variable: "reponse", validation: "texte" },
    condition: { rules: [{ kind: "jour", jours: [6, 7] }], match: "toutes" },
    ai: { intro: "Posez-moi votre question 🙂" },
    handoff: {},
    goto_flow: { flowId: "" },
    end: {},
    delay: { mode: "intelligent" },
  };
  return structuredClone(defaults[type]);
}

export function createNode(type: NodeType, position: { x: number; y: number }): FlowNode {
  return { id: `${type}-${shortId()}`, type, position, data: defaultData(type) } as FlowNode;
}

export interface Output {
  id: string;
  label: string;
}

/** Sorties d'un bloc (une poignée par sortie dans l'éditeur). */
export function nodeOutputs(node: FlowNode): Output[] {
  switch (node.type) {
    case "message":
      return [
        ...node.data.bubbles.flatMap((bubble) => bubble.buttons.flatMap((b) => (b.kind === "reply" ? [{ id: b.id, label: b.title }] : []))),
        { id: "next", label: "Étape suivante" },
      ];
    case "trigger":
    case "delay":
      return [{ id: "next", label: "Suite" }];
    case "list":
      return node.data.items.map((i) => ({ id: i.id, label: i.title }));
    case "question":
      return [
        { id: "next", label: "Réponse valide" },
        { id: "echec", label: "Trop d'erreurs" },
      ];
    case "condition":
      return [
        { id: "vrai", label: "Vrai" },
        { id: "faux", label: "Faux" },
      ];
    case "ai":
    case "handoff":
    case "goto_flow":
    case "end":
      return [];
  }
}

/** Le bloc peut-il recevoir une flèche ? (le déclencheur est toujours le point de départ) */
export function hasInput(node: FlowNode): boolean {
  return node.type !== "trigger";
}
