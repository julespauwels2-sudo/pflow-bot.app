/**
 * Bot PFlow de base du numéro PFlow : répond quand aucun mot-clé de démo n'a été écrit. Figé dans le
 * code (jamais modifié depuis l'app) : présentation de PFlow Order et comment obtenir sa démo.
 */
import { DEFAULT_TIMEZONE, type Flow, type FlowNode } from "@/engine";
import type { LoadedBot } from "@/channels/core/bot-loader";

export const PFLOW_BOT_ID = "pflow";

const at = (x: number, y: number) => ({ x, y });
const reply = (id: string, title: string) => ({ id, kind: "reply" as const, title });
const message = (id: string, bubbles: { text: string; buttons?: ReturnType<typeof reply>[] }[]): FlowNode => ({
  id,
  type: "message",
  position: at(340, 0),
  data: { bubbles: bubbles.map((b, i) => ({ id: `${id}-${i + 1}`, text: b.text, buttons: b.buttons ?? [] })) },
});

export const PFLOW_TEXTS = {
  welcome:
    "👋 Bonjour {{prenom}} ! Ici *PFlow* 🚀\nOn aide les restaurants à prendre leurs commandes sur WhatsApp : vos clients commandent en quelques clics, vous suivez tout sur un tableau de bord.",
  askDemo: "On vous a préparé une démo ? Écrivez simplement son nom ici (souvent le nom de votre resto) 👇",
  discover:
    "🍔 *PFlow Order*, c'est :\n• une page de commande à votre nom, avec votre carte\n• un assistant WhatsApp qui répond à vos clients (horaires, livraison, questions) et les envoie vers la commande\n• un tableau de bord pour suivre les commandes en direct\n• le paiement en ligne par carte ou sur place",
  demoRequest:
    "🎁 Avec plaisir ! Jules, de PFlow, vous prépare une démo avec votre carte et vous recontacte très vite. Vous pouvez déjà nous écrire le nom de votre resto 🙂",
  /** Mot-clé d'une démo terminée (expirée ou supprimée). */
  demoEnded: (nom: string) =>
    `⏳ La démo de *${nom}* est terminée. Merci de l'avoir essayée ! Pour la prolonger ou passer à la vraie version, répondez « démo » et Jules vous recontacte 🙂`,
};

const welcome: Flow = {
  id: "pflow-accueil",
  name: "PFlow — accueil",
  nodes: [
    { id: "t", type: "trigger", position: at(0, 0), data: { keywords: ["bonjour", "salut", "hello", "pflow"], isDefault: true } },
    message("m", [
      { text: PFLOW_TEXTS.welcome },
      { text: PFLOW_TEXTS.askDemo, buttons: [reply("decouvrir", "🍔 Découvrir PFlow"), reply("demo", "🎁 Obtenir ma démo")] },
    ]),
    { id: "g_decouvrir", type: "goto_flow", position: at(720, 0), data: { flowId: "pflow-decouvrir" } },
    { id: "g_demo", type: "goto_flow", position: at(720, 200), data: { flowId: "pflow-demo" } },
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", sourceHandle: "decouvrir", target: "g_decouvrir" },
    { id: "e3", source: "m", sourceHandle: "demo", target: "g_demo" },
  ],
};

const discover: Flow = {
  id: "pflow-decouvrir",
  name: "PFlow — découvrir",
  nodes: [
    { id: "t", type: "trigger", position: at(0, 0), data: { keywords: ["pflow order", "decouvrir", "prix", "tarif"] } },
    message("m", [{ text: PFLOW_TEXTS.discover, buttons: [reply("demo", "🎁 Obtenir ma démo")] }]),
    { id: "g_demo", type: "goto_flow", position: at(720, 0), data: { flowId: "pflow-demo" } },
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
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

/** Le bot PFlow de base, prêt pour le moteur (sans IA : aucun coût). */
export function pflowBaseBot(): LoadedBot {
  return {
    client: { id: PFLOW_BOT_ID, nomResto: "PFlow", orderSlug: "", timezone: DEFAULT_TIMEZONE },
    flows: structuredClone([welcome, discover, demoRequest]),
    infoSheet: { horaires: [] },
    aiDailyLimit: 0,
  };
}
