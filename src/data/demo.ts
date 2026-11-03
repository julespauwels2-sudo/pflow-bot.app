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
  horairesNote: "Ouvert les jours fériés sauf le 25 décembre.",
  adresse: "Exemple : 12 rue de la Plage, 97190 Le Gosier",
  livraison: true,
  retrait: true,
  zonesLivraison: "Le Gosier, Pointe-à-Pitre, Les Abymes (livraison offerte dès 25 €)",
  pointsDeVente: "Le restaurant, et notre food truck le samedi au marché du Gosier",
  resumeCarte: "Tacos, burritos, quesadillas, bowls. Menu enfant. Desserts maison.",
  modesPaiement: "Espèces ou carte bancaire, au comptoir ou à la livraison",
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

/** Infos pratiques (trame de Jules) : 3 boutons, réponses tirées de la fiche d'infos. */
const infosPratiques: FlowGraph = {
  nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 120 }, data: { keywords: ["horaires", "adresse", "infos", "livraison", "paiement"] } },
    {
      id: "m",
      type: "message",
      position: { x: 340, y: 80 },
      data: {
        bubbles: [
          {
            id: "b1",
            text: "ℹ️ *Infos pratiques*\nQue souhaitez-vous savoir ?",
            buttons: [
              { id: "horaires", kind: "reply", title: "🕒 Horaires" },
              { id: "livraison", kind: "reply", title: "🛵 Livraison" },
              { id: "paiement", kind: "reply", title: "💳 Paiement" },
            ],
          },
        ],
      },
    },
    say("h", "🕒 *Nos horaires*\n{{horaires}}", 720, -60),
    say("l", "🛵 *Livraison*\n{{infos_livraison}}\n\n🏪 *Points de vente*\n{{points_de_vente}}", 720, 120),
    say("p", "💳 *Paiement*\n{{modes_paiement}}", 720, 320),
    { id: "g", type: "goto_flow", position: { x: 1100, y: 140 }, data: { flowId: "" } },
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", sourceHandle: "horaires", target: "h" },
    { id: "e3", source: "m", sourceHandle: "livraison", target: "l" },
    { id: "e4", source: "m", sourceHandle: "paiement", target: "p" },
    { id: "e5", source: "h", target: "g" },
    { id: "e6", source: "l", target: "g" },
    { id: "e7", source: "p", target: "g" },
  ],
};

/** CTA - Commander (trame de Jules). */
const ctaCommander: FlowGraph = {
  nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 40 }, data: { keywords: [] } },
    {
      id: "m",
      type: "message",
      position: { x: 340, y: 20 },
      data: {
        bubbles: [
          {
            id: "b1",
            text: "Ça vous tente ? 😋 Vous pouvez passer votre commande directement ici 👇",
            buttons: [{ id: "cmd", kind: "link", title: "😋 Je commande", orderLink: true }],
          },
        ],
      },
    },
  ],
  edges: [{ id: "e1", source: "t", target: "m" }],
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
  const recoId = await create("IA - Recommandation", "Conseille un produit de la carte", recommandation);
  const ctaId = await create("CTA - Commander", "Invite à commander (bouton Je commande)", ctaCommander);
  const withGoto = (graph: FlowGraph, targets: Record<string, string>): FlowGraph => ({
    ...graph,
    nodes: graph.nodes.map((n) => (n.id in targets ? { ...n, data: { flowId: targets[n.id] } } : n)) as FlowGraph["nodes"],
  });
  const infosId = await create("Infos pratiques", "Horaires, livraison, points de vente, paiement", withGoto(infosPratiques, { g: ctaId }));
  const accueilId = await create("Accueil", "Accueil, lien de commande et aide", withGoto(accueil, { g1: recoId, g2: infosId }));
  for (const id of [recoId, ctaId, infosId, accueilId]) await repos.flows.publish(id);
  return client;
}
