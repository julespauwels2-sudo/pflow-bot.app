/**
 * Bot PFlow de base du numéro PFlow : répond quand aucun mot-clé de démo n'a été écrit. Figé dans le
 * code (jamais modifié depuis l'app) : présentation de PFlow Order, comment obtenir sa démo, et la démo
 * permanente (Mint Burger, sur la vraie page de commande et le vrai Dashboard de démonstration du CRM).
 * Sans IA : aucun coût.
 */
import { DEFAULT_TIMEZONE, encodeReplyId, type ChoiceOption, type Flow, type FlowNode } from "@/engine";
import type { LoadedBot } from "@/channels/core/bot-loader";

export const PFLOW_BOT_ID = "pflow";

const at = (x: number, y: number) => ({ x, y });
const reply = (id: string, title: string) => ({ id, kind: "reply" as const, title });
const link = (id: string, title: string, url: string) => ({ id, kind: "link" as const, title, url });
type Button = ReturnType<typeof reply> | ReturnType<typeof link>;
const message = (id: string, bubbles: { text: string; buttons?: Button[] }[]): FlowNode => ({
  id,
  type: "message",
  position: at(340, 0),
  data: { bubbles: bubbles.map((b, i) => ({ id: `${id}-${i + 1}`, text: b.text, buttons: b.buttons ?? [] })) },
});

/**
 * Démo permanente (Mint Burger) : pages de démonstration du CRM, servies en mémoire (aucune commande réelle,
 * aucun paiement, aucun message). Le resto vit seulement dans le navigateur (repo/img/demo/mint-burger/ du CRM).
 */
export const DEMO_PERMANENTE = {
  nomResto: "Mint Burger",
  commandeUrl: "https://order.pflow.fr/demo/commande?r=pflow",
  dashboardUrl: "https://order.pflow.fr/demo?r=pflow",
};

export const PFLOW_TEXTS = {
  welcome:
    "👋 Bonjour {{prenom}} ! Ici *PFlow* 🚀\nOn aide les restaurants à prendre leurs commandes sur WhatsApp : vos clients commandent en quelques clics, vous suivez tout sur un tableau de bord.",
  askDemo: "On vous a préparé une démo ? Écrivez simplement son nom ici (souvent le nom de votre resto) 👇\nSinon, testez notre resto de démo :",
  /** Démo permanente, 3 messages à la suite. */
  tryOrder: `😋 Mettez-vous à la place d'un client de *${DEMO_PERMANENTE.nomResto}*, notre resto de démo. Choisissez votre burger et passez commande, comme sur une vraie page de commande. Rien n'est payé ni envoyé.`,
  tryDashboard: "📊 Côté resto, chaque commande arrive en direct sur le tableau de bord. Passez la vôtre, puis ouvrez-le pour la voir arriver.",
  tryYours: "✨ Et pour votre resto ? On adapte tout à votre carte et à votre façon de travailler. On en parle ?",
  /** « Je veux le mien » : transfert à Jules (alerte), comme « Obtenir ma démo ». */
  wantMine: "Super ! Jules, de PFlow, vous recontacte très vite 🙂 Dites-nous déjà le nom de votre resto.",
  discover:
    "🍔 *PFlow Order*, c'est :\n• une page de commande à votre nom, avec votre carte\n• un assistant WhatsApp qui répond à vos clients (horaires, livraison, questions) et les envoie vers la commande\n• un tableau de bord pour suivre les commandes en direct\n• le paiement en ligne par carte ou sur place",
  demoRequest:
    "🎁 Avec plaisir ! Jules, de PFlow, vous prépare une démo avec votre carte et vous recontacte très vite. Vous pouvez déjà nous écrire le nom de votre resto 🙂",
  /** Mot-clé d'une démo terminée (expirée ou supprimée). */
  demoEnded: (nom: string) =>
    `⏳ La démo de *${nom}* est terminée. Merci de l'avoir essayée ! Pour la prolonger ou passer à la vraie version, répondez « démo » et Jules vous recontacte 🙂`,
};

/** Flux du bot PFlow de base : un bouton qui y mène fait quitter la démo en cours (voir router.ts). */
export const PFLOW_FLOW_PREFIX = "pflow-";

/**
 * Boutons PFlow ajoutés aux réponses d'une démo sans carte : « Obtenir ma démo » (transfert à Jules) et
 * « Tester la démo » (le resto de démo PFlow). Leurs ids visent les flux du bot PFlow de base.
 */
export const PFLOW_DEMO_BUTTONS: ChoiceOption[] = [
  { id: encodeReplyId({ flowId: "pflow-demo", nodeId: "t", handle: "next" }), title: "🎁 Obtenir ma démo" },
  { id: encodeReplyId({ flowId: "pflow-tester", nodeId: "t", handle: "next" }), title: "😋 Tester la démo" },
];

const welcome: Flow = {
  id: "pflow-accueil",
  name: "PFlow — accueil",
  nodes: [
    { id: "t", type: "trigger", position: at(0, 0), data: { keywords: ["bonjour", "salut", "hello", "pflow"], isDefault: true } },
    message("m", [
      { text: PFLOW_TEXTS.welcome },
      {
        text: PFLOW_TEXTS.askDemo,
        buttons: [reply("tester", "😋 Tester la démo"), reply("decouvrir", "🍔 Découvrir PFlow"), reply("demo", "🎁 Obtenir ma démo")],
      },
    ]),
    { id: "g_tester", type: "goto_flow", position: at(720, -200), data: { flowId: "pflow-tester" } },
    { id: "g_decouvrir", type: "goto_flow", position: at(720, 0), data: { flowId: "pflow-decouvrir" } },
    { id: "g_demo", type: "goto_flow", position: at(720, 200), data: { flowId: "pflow-demo" } },
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e4", source: "m", sourceHandle: "tester", target: "g_tester" },
    { id: "e2", source: "m", sourceHandle: "decouvrir", target: "g_decouvrir" },
    { id: "e3", source: "m", sourceHandle: "demo", target: "g_demo" },
  ],
};

const discover: Flow = {
  id: "pflow-decouvrir",
  name: "PFlow — découvrir",
  nodes: [
    { id: "t", type: "trigger", position: at(0, 0), data: { keywords: ["pflow order", "decouvrir", "prix", "tarif"] } },
    message("m", [{ text: PFLOW_TEXTS.discover, buttons: [reply("tester", "😋 Tester la démo"), reply("demo", "🎁 Obtenir ma démo")] }]),
    { id: "g_tester", type: "goto_flow", position: at(720, -200), data: { flowId: "pflow-tester" } },
    { id: "g_demo", type: "goto_flow", position: at(720, 0), data: { flowId: "pflow-demo" } },
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e3", source: "m", sourceHandle: "tester", target: "g_tester" },
    { id: "e2", source: "m", sourceHandle: "demo", target: "g_demo" },
  ],
};

const demoRequest: Flow = {
  id: "pflow-demo",
  name: "PFlow — obtenir sa démo",
  nodes: [
    { id: "t", type: "trigger", position: at(0, 0), data: { keywords: ["demo", "essai", "essayer"] } },
    { id: "h", type: "handoff", position: at(340, 0), data: { text: PFLOW_TEXTS.demoRequest } },
  ],
  edges: [{ id: "e1", source: "t", target: "h" }],
};

/**
 * Mots qui lancent la démo permanente : l'intention de commander ou de voir la carte (un court message ;
 * le plus long mot-clé gagne, donc « Bonjour je veux commander » va ici, pas à l'accueil).
 */
export const TRY_DEMO_KEYWORDS = [
  "tester la demo", "tester", "voir la demo", "commander", "je veux commander", "je commande", "passer commande",
  "la carte", "votre carte", "voir la carte", "voir le menu", "votre menu",
];

/** « Tester la démo » : la démo permanente, en 3 messages (« en train d'écrire » entre eux). */
const tryDemo: Flow = {
  id: "pflow-tester",
  name: "PFlow — tester la démo (Mint Burger)",
  nodes: [
    { id: "t", type: "trigger", position: at(0, 0), data: { keywords: TRY_DEMO_KEYWORDS } },
    message("m1", [{ text: PFLOW_TEXTS.tryOrder, buttons: [link("cmd", "Je commande", DEMO_PERMANENTE.commandeUrl)] }]),
    { id: "d1", type: "delay", position: at(340, 160), data: { mode: "intelligent" } },
    message("m2", [{ text: PFLOW_TEXTS.tryDashboard, buttons: [link("dash", "Voir le dashboard", DEMO_PERMANENTE.dashboardUrl)] }]),
    { id: "d2", type: "delay", position: at(340, 320), data: { mode: "intelligent" } },
    message("m3", [{ text: PFLOW_TEXTS.tryYours, buttons: [reply("mien", "🙋 Je veux le mien"), reply("decouvrir", "🍔 Découvrir PFlow")] }]),
    { id: "g_mien", type: "goto_flow", position: at(720, 320), data: { flowId: "pflow-mien" } },
    { id: "g_decouvrir", type: "goto_flow", position: at(720, 480), data: { flowId: "pflow-decouvrir" } },
  ],
  edges: [
    { id: "e1", source: "t", target: "m1" },
    { id: "e2", source: "m1", target: "d1" },
    { id: "e3", source: "d1", target: "m2" },
    { id: "e4", source: "m2", target: "d2" },
    { id: "e5", source: "d2", target: "m3" },
    { id: "e6", source: "m3", sourceHandle: "mien", target: "g_mien" },
    { id: "e7", source: "m3", sourceHandle: "decouvrir", target: "g_decouvrir" },
  ],
};

/** « Je veux le mien » : transfert à Jules, avec alerte (WhatsApp + boîte de réception), bot en pause pour ce contact. */
const wantMine: Flow = {
  id: "pflow-mien",
  name: "PFlow — je veux le mien",
  nodes: [
    { id: "t", type: "trigger", position: at(0, 0), data: { keywords: ["je veux le mien"] } },
    { id: "h", type: "handoff", position: at(340, 0), data: { text: PFLOW_TEXTS.wantMine } },
  ],
  edges: [{ id: "e1", source: "t", target: "h" }],
};

/** Le bot PFlow de base, prêt pour le moteur (sans IA : aucun coût). */
export function pflowBaseBot(): LoadedBot {
  return {
    client: { id: PFLOW_BOT_ID, nomResto: "PFlow", orderSlug: "", timezone: DEFAULT_TIMEZONE },
    flows: structuredClone([welcome, discover, demoRequest, tryDemo, wantMine]),
    infoSheet: { horaires: [] },
    aiDailyLimit: 0,
  };
}
