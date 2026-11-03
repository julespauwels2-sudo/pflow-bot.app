/**
 * Contenu de départ du modèle maître : la trame UChat de Jules (docs/reference/template-uchat.md),
 * écrite uniquement avec des variables — rien de propre à un client.
 */
import type { BubbleButton, FlowNode } from "@/engine";
import type { Repositories } from "./repositories";
import type { BotTemplate, FlowGraph } from "./types";

export const MASTER_TEMPLATE_NAME = "Modèle maître";
export const TEMPLATE_FOLDERS = ["Principales PFlow Order", "Fonctions IA", "Commande"] as const;

const at = (x: number, y: number) => ({ x, y });

function message(id: string, x: number, y: number, bubbles: { text: string; buttons?: BubbleButton[] }[]): FlowNode {
  return {
    id,
    type: "message",
    position: at(x, y),
    data: { bubbles: bubbles.map((b, i) => ({ id: `${id}-${i + 1}`, text: b.text, buttons: b.buttons ?? [] })) },
  };
}

const orderButton = (id: string, title: string) => ({ id, kind: "link" as const, title, orderLink: true });
const reply = (id: string, title: string) => ({ id, kind: "reply" as const, title });
const trigger = (keywords: string[], extra: { isDefault?: boolean } = {}): FlowNode => ({
  id: "t",
  type: "trigger",
  position: at(0, 80),
  data: { keywords, ...extra },
});
const goto = (id: string, x: number, y: number): FlowNode => ({ id, type: "goto_flow", position: at(x, y), data: { flowId: "" } });

/** Remplace les cibles des blocs « Aller à un flux » une fois les flux créés. */
function withTargets(graph: FlowGraph, targets: Record<string, string>): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.type === "goto_flow" && targets[n.id] ? { ...n, data: { flowId: targets[n.id] } } : n)),
  };
}

// --- Principales PFlow Order ---------------------------------------------------

const accueil: FlowGraph = {
  nodes: [
    trigger(["bonjour", "salut", "hello", "menu", "commander"], { isDefault: true }),
    message("m", 340, 40, [
      {
        text: "👋 Hello {{prenom}} ! Bienvenue chez {{nom_resto}} 🍔 Une petite faim ? Composez votre commande en quelques clics 👇",
        buttons: [orderButton("cmd", "Commander")],
      },
      {
        text: "✨ Besoin d'un petit coup de main ? Je peux aussi vous conseiller ou répondre à vos questions 👇",
        buttons: [reply("conseil", "⭐ Me conseiller"), reply("infos", "ℹ️ Infos pratiques")],
      },
    ]),
    goto("g_reco", 720, 20),
    goto("g_infos", 720, 220),
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", sourceHandle: "conseil", target: "g_reco" },
    { id: "e3", source: "m", sourceHandle: "infos", target: "g_infos" },
  ],
};

const infosPratiques: FlowGraph = {
  nodes: [
    trigger(["horaires", "adresse", "infos", "livraison", "paiement"]),
    message("m", 340, 80, [
      {
        text: "ℹ️ *Infos pratiques*\nQue souhaitez-vous savoir ?",
        buttons: [reply("horaires", "🕒 Horaires"), reply("livraison", "🛵 Livraison"), reply("paiement", "💳 Paiement")],
      },
    ]),
    message("h", 720, -60, [{ text: "🕒 *Nos horaires*\n{{horaires}}" }]),
    message("l", 720, 120, [{ text: "🛵 *Livraison*\n{{infos_livraison}}\n\n🏪 *Points de vente*\n{{points_de_vente}}" }]),
    message("p", 720, 320, [{ text: "💳 *Paiement*\n{{modes_paiement}}" }]),
    goto("g_cta", 1100, 140),
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", sourceHandle: "horaires", target: "h" },
    { id: "e3", source: "m", sourceHandle: "livraison", target: "l" },
    { id: "e4", source: "m", sourceHandle: "paiement", target: "p" },
    { id: "e5", source: "h", target: "g_cta" },
    { id: "e6", source: "l", target: "g_cta" },
    { id: "e7", source: "p", target: "g_cta" },
  ],
};

const ctaCommander: FlowGraph = {
  nodes: [
    trigger([]),
    message("m", 340, 60, [
      { text: "Ça vous tente ? 😋 Vous pouvez passer votre commande directement ici 👇", buttons: [orderButton("cmd", "😋 Je commande")] },
    ]),
  ],
  edges: [{ id: "e1", source: "t", target: "m" }],
};

// --- Fonctions IA (lancées par l'agent IA à l'étape A6) ------------------------

const lancerCommande: FlowGraph = {
  nodes: [
    trigger([]),
    message("m", 340, 60, [
      {
        text: "Vous pouvez composer votre commande directement depuis notre carte 👇\n\nChoisissez ce qui vous fait envie, personnalisez votre menu et validez en quelques clics.",
        buttons: [orderButton("cmd", "😋 Je commande")],
      },
    ]),
  ],
  edges: [{ id: "e1", source: "t", target: "m" }],
};

const proposerCommande: FlowGraph = {
  nodes: [
    trigger([]),
    message("m", 340, 60, [
      // Réponse de l'IA (A6). Vide tant que l'IA n'est pas branchée : la bulle n'est alors pas envoyée.
      { text: "{{ia_reponse}}" },
      { text: "Ça vous tente ? 😋 Vous pouvez passer votre commande directement ici 👇", buttons: [orderButton("cmd", "😋 Je commande")] },
    ]),
  ],
  edges: [{ id: "e1", source: "t", target: "m" }],
};

const parlerEquipe: FlowGraph = {
  nodes: [
    trigger([]),
    {
      id: "h",
      type: "handoff",
      position: at(340, 60),
      data: {
        text: "👩‍💼 Je vous mets en relation avec l'équipe.\nQuelqu'un pourra reprendre la conversation dès que possible.\n\nVous pouvez déjà expliquer votre demande ici 👇",
      },
    },
  ],
  edges: [{ id: "e1", source: "t", target: "h" }],
};

/**
 * Version générique : dans UChat, les boutons (Chocolat, Spéculoos…) sont propres à Cookies An Nou.
 * Ici, l'IA recommande à partir de la carte du client. Des boutons par client restent possibles
 * avec « Personnaliser ce flux » (M3d).
 */
const recommandation: FlowGraph = {
  nodes: [
    trigger([]),
    {
      id: "ia",
      type: "ai",
      position: at(340, 60),
      data: {
        intro: "⭐ Je vous aide à choisir ! Dites-moi ce qui vous fait envie aujourd'hui 😋",
        instructions:
          "Recommande 2 ou 3 produits de la carte qui correspondent à l'envie du client. Réponse courte et appétissante, puis propose de commander.",
      },
    },
  ],
  edges: [{ id: "e1", source: "t", target: "ia" }],
};

/** Crée le modèle maître avec sa trame, ses dossiers, et publie tous ses flux. */
export async function createMasterTemplate(repos: Repositories): Promise<BotTemplate> {
  const existing = (await repos.templates.list())[0];
  if (existing) return existing;

  const template = await repos.templates.create({ name: MASTER_TEMPLATE_NAME });
  const folders = [];
  for (const name of TEMPLATE_FOLDERS) folders.push(await repos.folders.create({ ownerId: template.id, name }));
  // « Commande » reste vide pour l'instant : ses flux arrivent avec les événements PFlow Order (M3c).
  const [principales, fonctionsIa] = folders;
  const create = async (name: string, description: string, draft: FlowGraph, folderId: string) =>
    (await repos.flows.create({ ownerKind: "template", ownerId: template.id, name, description, draft, folderId })).id;

  const recoId = await create("IA - Recommandation", "Conseille des produits de la carte selon l'envie du client", recommandation, fonctionsIa.id);
  await create("IA - Lancer commande", "Le client veut commander : bouton Je commande", lancerCommande, fonctionsIa.id);
  await create("IA - Proposer commande", "Réponse de l'IA puis proposition de commander", proposerCommande, fonctionsIa.id);
  await create("IA - Parler équipe", "Le client veut parler à une personne : transfert humain", parlerEquipe, fonctionsIa.id);
  const ctaId = await create("CTA - Commander", "Invite à commander (bouton Je commande)", ctaCommander, principales.id);
  const infosId = await create("Infos pratiques", "Horaires, livraison, points de vente, paiement", withTargets(infosPratiques, { g_cta: ctaId }), principales.id);
  await create("Accueil", "Accueil, lien de commande et aide", withTargets(accueil, { g_reco: recoId, g_infos: infosId }), principales.id);

  for (const flow of await repos.flows.listByOwner(template.id)) await repos.flows.publish(flow.id);
  return template;
}
