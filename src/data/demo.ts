/** Données d'exemple (resto fictif) pour tester rapidement l'éditeur et le simulateur. */
import type { InfoSheet } from "@/engine";
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

const accueil: FlowGraph = {
  nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { keywords: ["commander", "bonjour", "menu", "salut"] } },
    { id: "m", type: "message", position: { x: 0, y: 140 }, data: { text: "Bonjour {{prenom}} 👋 Bienvenue chez {{nom_resto}} !" } },
    {
      id: "b",
      type: "buttons",
      position: { x: 0, y: 280 },
      data: {
        text: "Que souhaitez-vous faire ?",
        buttons: [
          { id: "cmd", title: "Commander" },
          { id: "hor", title: "Nos horaires" },
          { id: "q", title: "Une question" },
        ],
      },
    },
    { id: "lien", type: "order_link", position: { x: -320, y: 460 }, data: {} },
    { id: "fin", type: "end", position: { x: -320, y: 600 }, data: { text: "Bon appétit ! 🌮" } },
    {
      id: "hor",
      type: "message",
      position: { x: 0, y: 460 },
      data: { text: "Nous sommes ouverts du mardi au dimanche, midi et soir le vendredi et le samedi." },
    },
    { id: "ia", type: "ai", position: { x: 320, y: 460 }, data: { intro: "Posez-moi votre question 🙂" } },
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", target: "b" },
    { id: "e3", source: "b", sourceHandle: "cmd", target: "lien" },
    { id: "e4", source: "lien", target: "fin" },
    { id: "e5", source: "b", sourceHandle: "hor", target: "hor" },
    { id: "e6", source: "b", sourceHandle: "q", target: "ia" },
  ],
};

const agneau: FlowGraph = {
  nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { keywords: ["agneau"] } },
    { id: "c", type: "condition", position: { x: 0, y: 140 }, data: { rules: [{ kind: "jour", jours: [6, 7] }] } },
    { id: "oui", type: "message", position: { x: -200, y: 300 }, data: { text: "Oui, l'agneau est disponible aujourd'hui ! 🐑" } },
    { id: "non", type: "message", position: { x: 200, y: 300 }, data: { text: "L'agneau n'est disponible que le week-end (samedi et dimanche)." } },
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

  const client = await repos.clients.create({ nomResto: "Resto Démo", orderSlug: "resto-demo", timezone: "America/Guadeloupe" });
  await repos.infoSheets.save(client.id, DEMO_INFO_SHEET);
  const f1 = await repos.flows.create({
    clientId: client.id,
    name: "Accueil",
    description: "Accueil, boutons et lien de commande",
    draft: accueil,
  });
  await repos.flows.publish(f1.id);
  const f2 = await repos.flows.create({
    clientId: client.id,
    name: "Agneau du week-end",
    description: "Disponibilité de l'agneau (samedi et dimanche)",
    draft: agneau,
  });
  await repos.flows.publish(f2.id);
  return client;
}
