/** Données d'exemple (resto fictif) pour tester rapidement l'éditeur et le simulateur. */
import type { FlowNode, InfoSheet } from "@/engine";
import type { Repositories } from "./repositories";
import type { BotClient, FlowGraph } from "./types";

export const DEMO_INFO_SHEET: InfoSheet = {
  horaires: [
    { jour: 2, plages: [{ de: "11:30", a: "14:30" }] },
    { jour: 3, plages: [{ de: "11:30", a: "14:30" }] },
    { jour: 4, plages: [{ de: "11:30", a: "14:30" }] },
    { jour: 5, plages: [{ de: "11:30", a: "14:30" }, { de: "18:30", a: "23:00" }] },
    { jour: 6, plages: [{ de: "11:30", a: "15:00" }, { de: "18:30", a: "23:00" }] },
    { jour: 7, plages: [{ de: "11:30", a: "15:00" }] },
  ],
  horairesNote: "Fermé le lundi. Ouvert les jours fériés sauf le 25 décembre.",
  adresse: "Exemple : 12 rue de la Plage, 97190 Le Gosier",
  livraison: true,
  retrait: true,
  zonesLivraison: "Le Gosier, Pointe-à-Pitre, Les Abymes (livraison offerte dès 25 €)",
  pointsDeVente: "Un seul restaurant",
  resumeCarte: "Tacos, burritos, quesadillas, bowls. Menu enfant. Desserts maison.",
  reglesSpeciales: "L'agneau n'est disponible que le week-end. Pas de réservation par message.",
};

const say = (id: string, text: string, x: number, y: number): FlowNode => ({
  id,
  type: "message",
  position: { x, y },
  data: { bubbles: [{ id: `${id}-1`, text, buttons: [] }] },
});

/** Trame d'accueil de Jules (flux par défaut + mots-clés). */
const accueil: FlowGraph = {
  nodes: [
    {
      id: "t",
      type: "trigger",
      position: { x: 0, y: 80 },
      data: { keywords: ["bonjour", "salut", "menu", "commander"], isDefault: true },
    },
    {
      id: "m",
      type: "message",
      position: { x: 340, y: 40 },
      data: {
        bubbles: [
          {
            id: "b1",
            text: "👋 Hello {{prenom}} ! Bienvenue chez {{nom_resto}} 🍔 Une petite faim ? Composez votre commande en quelques clics 👇",
            buttons: [{ id: "cmd", kind: "link", title: "Commander", orderLink: true }],
          },
          {
            id: "b2",
            text: "✨ Besoin d'un petit coup de main ? Je peux aussi vous conseiller ou répondre à vos questions 👇",
            buttons: [
              { id: "conseil", kind: "reply", title: "⭐ Me conseiller" },
              { id: "infos", kind: "reply", title: "ℹ️ Infos pratiques" },
            ],
          },
        ],
      },
    },
    { id: "g1", type: "goto_flow", position: { x: 720, y: 20 }, data: { flowId: "" } },
    { id: "g2", type: "goto_flow", position: { x: 720, y: 200 }, data: { flowId: "" } },
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", sourceHandle: "conseil", target: "g1" },
    { id: "e3", source: "m", sourceHandle: "infos", target: "g2" },
  ],
};

/** Provisoire : sera remplacé par la trame de Jules (captures) dans le modèle maître. */
const recommandation: FlowGraph = {
  nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 60 }, data: { keywords: [] } },
    {
      id: "ia",
      type: "ai",
      position: { x: 340, y: 40 },
      data: {
        intro: "⭐ Avec plaisir ! Dites-moi ce qui vous fait envie (viande, poisson, végétarien…) et je vous conseille 😋",
        instructions: "Recommande uniquement des plats présents dans le résumé de la carte. Jamais de prix. Termine en proposant de commander.",
      },
    },
  ],
  edges: [{ id: "e1", source: "t", target: "ia" }],
};

/** Provisoire : sera remplacé par la trame de Jules (captures) dans le modèle maître. */
const infosPratiques: FlowGraph = {
  nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 60 }, data: { keywords: ["horaires", "adresse", "infos"] } },
    say("m", "ℹ️ Nous sommes ouverts du mardi au dimanche, midi et soir le vendredi et le samedi. 📍 12 rue de la Plage, Le Gosier.", 340, 40),
  ],
  edges: [{ id: "e1", source: "t", target: "m" }],
};

const agneau: FlowGraph = {
  nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 60 }, data: { keywords: ["agneau"] } },
    { id: "c", type: "condition", position: { x: 340, y: 40 }, data: { rules: [{ kind: "jour", jours: [6, 7] }] } },
    say("oui", "Oui, l'agneau est disponible aujourd'hui ! 🐑", 700, -40),
    say("non", "L'agneau n'est disponible que le week-end (samedi et dimanche).", 700, 160),
  ],
  edges: [
    { id: "e1", source: "t", target: "c" },
    { id: "e2", source: "c", sourceHandle: "vrai", target: "oui" },
    { id: "e3", source: "c", sourceHandle: "faux", target: "non" },
  ],
};

/** Crée le resto d'exemple avec sa fiche d'infos et deux flux publiés. */
export async function loadDemo(repos: Repositories): Promise<BotClient> {
  const existing = (await repos.clients.list()).find((c) => c.orderSlug === "resto-demo");
  if (existing) return existing;

  const client = await repos.clients.create({
    nomResto: "Resto Démo",
    orderSlug: "resto-demo",
    timezone: "America/Guadeloupe",
    triggerMode: "toujours",
  });
  await repos.infoSheets.save(client.id, DEMO_INFO_SHEET);
  const create = async (name: string, description: string, draft: FlowGraph) => {
    const flow = await repos.flows.create({ clientId: client.id, name, description, draft });
    return flow.id;
  };
  const recoId = await create("IA - Recommandation", "Conseille un plat de la carte", recommandation);
  const infosId = await create("Infos pratiques", "Horaires, adresse, livraison", infosPratiques);
  // Les boutons de l'accueil mènent aux deux sous-flux.
  const withTargets: FlowGraph = {
    ...accueil,
    nodes: accueil.nodes.map((n) =>
      n.id === "g1" ? { ...n, data: { flowId: recoId } } : n.id === "g2" ? { ...n, data: { flowId: infosId } } : n,
    ) as FlowGraph["nodes"],
  };
  const accueilId = await create("Accueil", "Accueil, lien de commande et aide", withTargets);
  const agneauId = await create("Agneau du week-end", "Disponibilité de l'agneau (samedi et dimanche)", agneau);
  for (const id of [recoId, infosId, accueilId, agneauId]) await repos.flows.publish(id);
  return client;
}
