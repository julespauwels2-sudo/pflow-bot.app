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
  message: { label: "Message", description: "Envoie un texte", accent: "bg-blue", hex: "#2A8BFF", icon: "💬" },
  buttons: { label: "Boutons", description: "Jusqu'à 3 boutons de réponse", accent: "bg-blue", hex: "#2A8BFF", icon: "🔘" },
  list: { label: "Liste", description: "Jusqu'à 10 choix", accent: "bg-blue", hex: "#2A8BFF", icon: "📋" },
  question: { label: "Question", description: "Pose une question, garde la réponse", accent: "bg-cyan", hex: "#74DDFB", icon: "❓" },
  condition: { label: "Condition", description: "Selon une variable, l'heure ou le jour", accent: "bg-navy-2", hex: "#1B2A6B", icon: "🔀" },
  order_link: { label: "Lien de commande", description: "Envoie le lien du mini-site", accent: "bg-wa", hex: "#22C55E", icon: "🛒" },
  ai: { label: "IA", description: "L'IA répond avec la fiche d'infos", accent: "bg-pink-2", hex: "#FF7CCB", icon: "✨" },
  handoff: { label: "Transfert humain", description: "Met le bot en pause, prévient le gérant", accent: "bg-coral", hex: "#FF6B6B", icon: "🙋" },
  goto_flow: { label: "Aller à un flux", description: "Saute vers un autre flux", accent: "bg-navy", hex: "#101B4D", icon: "↪️" },
  end: { label: "Fin", description: "Termine la conversation", accent: "bg-muted", hex: "#5E6690", icon: "🏁" },
};

/** Ordre d'affichage dans la palette. */
export const PALETTE: NodeType[] = [
  "trigger",
  "message",
  "buttons",
  "list",
  "question",
  "condition",
  "order_link",
  "ai",
  "handoff",
  "goto_flow",
  "end",
];

export function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function defaultData<T extends NodeType>(type: T): NodeDataMap[T] {
  const defaults: { [K in NodeType]: NodeDataMap[K] } = {
    trigger: { keywords: [] },
    message: { text: "" },
    buttons: {
      text: "",
      buttons: [
        { id: `b${shortId()}`, title: "Option 1" },
        { id: `b${shortId()}`, title: "Option 2" },
      ],
    },
    list: { text: "", buttonLabel: "Voir les choix", items: [{ id: `i${shortId()}`, title: "Choix 1" }] },
    question: { text: "", variable: "reponse", validation: "texte" },
    condition: { rules: [{ kind: "jour", jours: [6, 7] }], match: "toutes" },
    order_link: {},
    ai: { intro: "Posez-moi votre question 🙂" },
    handoff: {},
    goto_flow: { flowId: "" },
    end: {},
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
    case "trigger":
    case "message":
    case "order_link":
      return [{ id: "next", label: "Suite" }];
    case "buttons":
      return node.data.buttons.map((b) => ({ id: b.id, label: b.title }));
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
