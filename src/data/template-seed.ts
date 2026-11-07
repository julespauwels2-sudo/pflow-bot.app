/**
 * Contenu de départ du modèle maître : la trame UChat de Jules (docs/reference/template-uchat.md),
 * écrite uniquement avec des variables — rien de propre à un client.
 */
import type { BubbleButton, FlowNode, OrderEvent } from "@/engine";
import { defaultAgent, upgradeAgent } from "./agent";
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
const eventTrigger = (event: OrderEvent): FlowNode => ({ id: "t", type: "trigger", position: at(0, 80), data: { keywords: [], event } });
const ifVariable = (id: string, x: number, y: number, variable: string, value: string): FlowNode => ({
  id,
  type: "condition",
  position: at(x, y),
  data: { rules: [{ kind: "variable", variable, operator: "egal", value }], match: "toutes" },
});

// --- Principales PFlow Order ---------------------------------------------------

/** Version courte de l'Accueil (contact qui a déjà écrit dans les 12 dernières heures). */
export const SHORT_WELCOME_TEXT = "Que puis-je faire pour vous ? 👇";

const accueil: FlowGraph = {
  nodes: [
    // « commander » lance « CTA - Commander », plus l'Accueil. Flux par défaut : salutations et premier contact.
    trigger(["bonjour", "bonsoir", "salut", "hello", "coucou", "menu"], { isDefault: true }),
    // Accueil complet une fois par conversation (rien reçu du contact depuis 12 h), sinon version courte.
    ifVariable("c_nouv", 240, 80, "nouvelle_conversation", "oui"),
    message("m", 560, -40, [
      {
        text: "👋 Hello {{prenom}} ! Bienvenue chez {{nom_resto}} 🍔 Une petite faim ? Composez votre commande en quelques clics 👇",
        buttons: [orderButton("cmd", "Commander")],
      },
      {
        text: "✨ Besoin d'un petit coup de main ? Je peux aussi vous conseiller ou répondre à vos questions 👇",
        buttons: [reply("conseil", "⭐ Me conseiller"), reply("infos", "ℹ️ Infos pratiques")],
      },
    ]),
    message("m_court", 560, 260, [
      { text: SHORT_WELCOME_TEXT, buttons: [reply("commander", "🛒 Commander"), reply("conseil", "⭐ Me conseiller"), reply("infos", "ℹ️ Infos pratiques")] },
    ]),
    goto("g_reco", 940, 20),
    goto("g_infos", 940, 220),
    goto("g_cta", 940, 400),
  ],
  edges: [
    { id: "e1", source: "t", target: "c_nouv" },
    { id: "e1v", source: "c_nouv", sourceHandle: "vrai", target: "m" },
    { id: "e1f", source: "c_nouv", sourceHandle: "faux", target: "m_court" },
    { id: "e2", source: "m", sourceHandle: "conseil", target: "g_reco" },
    { id: "e3", source: "m", sourceHandle: "infos", target: "g_infos" },
    { id: "e4", source: "m_court", sourceHandle: "commander", target: "g_cta" },
    { id: "e5", source: "m_court", sourceHandle: "conseil", target: "g_reco" },
    { id: "e6", source: "m_court", sourceHandle: "infos", target: "g_infos" },
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
    // Intention de commander (message court) : bouton « Je commande ». Pas « commande » seul (« ma commande est où ? »).
    trigger(["commander", "je commande", "passer commande", "passer une commande"]),
    message("m", 340, 60, [
      { text: "Ça vous tente ? 😋 Vous pouvez passer votre commande directement ici 👇", buttons: [orderButton("cmd", "😋 Je commande")] },
    ]),
  ],
  edges: [{ id: "e1", source: "t", target: "m" }],
};


/** C5 : la réponse vient de PFlow Order (pont), le flux ne fait que l'envoyer. */
const suivreCommande: FlowGraph = {
  nodes: [trigger([]), { id: "c", type: "commande", position: at(340, 60), data: { action: "suivi" } }],
  edges: [{ id: "e1", source: "t", target: "c" }],
};

/** C5 : jamais d'annulation sans confirmation du client (boutons Oui / Non). */
const annulerCommande: FlowGraph = {
  nodes: [
    trigger([]),
    message("m", 340, 60, [
      {
        text: "Vous voulez vraiment annuler votre dernière commande ?\n\nSi elle est payée en ligne et pas encore prête, vous êtes remboursé intégralement.",
        buttons: [reply("oui", "✅ Oui, annuler"), reply("non", "↩️ Non, la garder")],
      },
    ]),
    { id: "c", type: "commande", position: at(720, -20), data: { action: "annulation" } },
    message("garde", 720, 180, [{ text: "C'est noté, votre commande continue 😊" }]),
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", sourceHandle: "oui", target: "c" },
    { id: "e3", source: "m", sourceHandle: "non", target: "garde" },
  ],
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
          "Recommande 2 ou 3 produits de la carte qui correspondent à l'envie du client, en réponse courte et appétissante. Utilise proposer_commande avec ta recommandation dans « texte ». Si rien dans la carte ne correspond, dis-le et propose ce qui s'en rapproche le plus.",
      },
    },
  ],
  edges: [{ id: "e1", source: "t", target: "ia" }],
};

// --- Commande (événements PFlow Order ; branchement à l'étape C) ---------------

const recap = "🧾 *Commande #{{commande_numero}}* — {{commande_mode}}\n{{commande_recap}}\n\n💰 *Total : {{commande_total}}*";

const paiementValide: FlowGraph = {
  nodes: [
    eventTrigger("commande_validee"),
    ifVariable("c_paiement", 340, 60, "paiement_mode", "en_ligne"),
    message("paye", 700, -80, [
      { text: `✅ *Paiement validé !*\nMerci {{client_nom}} 🙏 Votre paiement est bien confirmé.\n\n${recap}\n\nOn vous prévient ici dès que votre commande avance 😊` },
    ]),
    message("enregistre", 700, 200, [
      {
        text: `✅ *Commande enregistrée !*\nMerci {{client_nom}} 🙏 Nous avons bien reçu votre commande.\n\n${recap}\n💳 Paiement : {{modes_paiement}}\n\nOn vous prévient ici dès que votre commande avance 😊`,
      },
    ]),
    // Si la commande a déjà avancé au moment de l'envoi, on enchaîne sur le bon statut.
    ifVariable("c_prep", 1080, 60, "commande_statut", "en_preparation"),
    goto("g_prep", 1440, -40),
    ifVariable("c_prete", 1440, 160, "commande_statut", "prete"),
    goto("g_prete", 1800, 120),
    { id: "fin", type: "end", position: at(1800, 320), data: {} },
  ],
  edges: [
    { id: "e1", source: "t", target: "c_paiement" },
    { id: "e2", source: "c_paiement", sourceHandle: "vrai", target: "paye" },
    { id: "e3", source: "c_paiement", sourceHandle: "faux", target: "enregistre" },
    { id: "e4", source: "paye", target: "c_prep" },
    { id: "e5", source: "enregistre", target: "c_prep" },
    { id: "e6", source: "c_prep", sourceHandle: "vrai", target: "g_prep" },
    { id: "e7", source: "c_prep", sourceHandle: "faux", target: "c_prete" },
    { id: "e8", source: "c_prete", sourceHandle: "vrai", target: "g_prete" },
    { id: "e9", source: "c_prete", sourceHandle: "faux", target: "fin" },
  ],
};

const enPreparation: FlowGraph = {
  nodes: [
    eventTrigger("commande_en_preparation"),
    message("m", 340, 60, [
      {
        text: "👨‍🍳 *Votre commande est en préparation*\n\nLa cuisine vient de commencer la préparation de votre commande #{{commande_numero}} 🔥\n\nOn vous prévient ici dès qu'elle est prête.",
      },
    ]),
  ],
  edges: [{ id: "e1", source: "t", target: "m" }],
};

const prete: FlowGraph = {
  nodes: [
    eventTrigger("commande_prete"),
    ifVariable("c_mode", 340, 60, "commande_mode", "livraison"),
    message("livraison", 700, -40, [
      { text: "✅ *Votre commande est prête !*\n\nBonne nouvelle {{client_nom}} 🎉 Votre commande #{{commande_numero}} est prête et part en livraison 🛵" },
    ]),
    message("retrait", 700, 180, [
      { text: "✅ *Votre commande est prête !*\n\nBonne nouvelle {{client_nom}} 🎉 Votre commande #{{commande_numero}} est prête.\n\nVous pouvez venir la récupérer 😊" },
    ]),
  ],
  edges: [
    { id: "e1", source: "t", target: "c_mode" },
    { id: "e2", source: "c_mode", sourceHandle: "vrai", target: "livraison" },
    { id: "e3", source: "c_mode", sourceHandle: "faux", target: "retrait" },
  ],
};

/** Annulation : remboursée intégralement, en partie, ou sans paiement en ligne (textes repris du CRM). */
const annulee: FlowGraph = {
  nodes: [
    eventTrigger("commande_annulee"),
    ifVariable("c_total", 340, 60, "remboursement", "total"),
    message("total", 700, -80, [
      {
        text: "❌ *Commande annulée*\n\nVotre commande #{{commande_numero}} a été annulée et *remboursée intégralement* ({{montant_rembourse}}). Le remboursement apparaît sur votre compte sous 5 à 10 jours.\n\nUne question ? Écrivez-nous ici 🙏",
      },
    ]),
    ifVariable("c_partiel", 700, 160, "remboursement", "partiel"),
    message("partiel", 1060, 80, [
      {
        text: "❌ *Commande annulée*\n\nVotre commande #{{commande_numero}} a été annulée. Un remboursement de {{montant_rembourse}} a été fait : il apparaît sur votre compte sous 5 à 10 jours.\n\nUne question ? Écrivez-nous ici 🙏",
      },
    ]),
    message("simple", 1060, 300, [
      { text: "❌ *Commande annulée*\n\nVotre commande #{{commande_numero}} a été annulée.\n\nUne question ? Écrivez-nous ici, on vous répond 🙏" },
    ]),
  ],
  edges: [
    { id: "e1", source: "t", target: "c_total" },
    { id: "e2", source: "c_total", sourceHandle: "vrai", target: "total" },
    { id: "e3", source: "c_total", sourceHandle: "faux", target: "c_partiel" },
    { id: "e4", source: "c_partiel", sourceHandle: "vrai", target: "partiel" },
    { id: "e5", source: "c_partiel", sourceHandle: "faux", target: "simple" },
  ],
};

const remboursee: FlowGraph = {
  nodes: [
    eventTrigger("commande_remboursee"),
    message("m", 340, 60, [
      { text: "💸 *Remboursement effectué*\n\nVotre commande #{{commande_numero}} a été remboursée ({{montant_rembourse}}). Le remboursement apparaît sur votre compte sous 5 à 10 jours." },
    ]),
  ],
  edges: [{ id: "e1", source: "t", target: "m" }],
};

const annulationRefusee: FlowGraph = {
  nodes: [
    eventTrigger("annulation_refusee"),
    message("m", 340, 60, [
      {
        text: "🚫 *Annulation impossible*\n\nDésolé {{client_nom}}, votre commande #{{commande_numero}} est déjà en cours : le restaurant n'a pas pu l'annuler.\n\nÉcrivez-nous ici si besoin, on vous répond 🙏",
      },
    ]),
  ],
  edges: [{ id: "e1", source: "t", target: "m" }],
};

/** Envoyé par PFlow Order seulement si le rappel est réglé pour ce resto (délai dans PFlow Order). */
const rappelPrete: FlowGraph = {
  nodes: [
    eventTrigger("rappel_commande_prete"),
    message("m", 340, 60, [
      { text: "⏰ *Votre commande vous attend !*\n\n{{client_nom}}, votre commande #{{commande_numero}} est prête et vous attend au restaurant 😊" },
    ]),
  ],
  edges: [{ id: "e1", source: "t", target: "m" }],
};

/** Deux bulles : WhatsApp ne mélange pas bouton lien et bouton de réponse dans un même message. */
const panierAbandonne: FlowGraph = {
  nodes: [
    eventTrigger("panier_abandonne"),
    message("m", 340, 40, [
      {
        text: "🛒 *Votre panier vous attend…*\n\nVous avez commencé votre commande mais vous ne l'avez pas encore terminée 😊\n\n{{panier_recap}}\n💰 *Total : {{panier_total}}*\n\nVous pouvez reprendre exactement là où vous étiez 👇",
        buttons: [{ id: "reprendre", kind: "link", title: "🛒 Reprendre", url: "{{lien_panier}}" }],
      },
      { text: "Pas envie ?", buttons: [reply("abandon", "❌ Laisser tomber")] },
    ]),
    // Étape C : marquer aussi le panier comme abandonné dans PFlow Order.
    message("ok", 740, 120, [{ text: "Pas de souci 😊 À bientôt chez {{nom_resto}} !" }]),
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", sourceHandle: "abandon", target: "ok" },
  ],
};

// --- Liste des flux de la trame ------------------------------------------------

type FolderName = (typeof TEMPLATE_FOLDERS)[number];

interface SeedFlow {
  name: string;
  description: string;
  folder: FolderName;
  graph: FlowGraph;
  /** Cibles des blocs « Aller à un flux » : id du bloc → nom du flux visé. */
  gotos?: Record<string, string>;
}

export const SEED_FLOWS: SeedFlow[] = [
  { name: "Accueil", description: "Accueil, lien de commande et aide", folder: "Principales PFlow Order", graph: accueil, gotos: { g_reco: "IA - Recommandation", g_infos: "Infos pratiques", g_cta: "CTA - Commander" } },
  { name: "Infos pratiques", description: "Horaires, livraison, points de vente, paiement", folder: "Principales PFlow Order", graph: infosPratiques, gotos: { g_cta: "CTA - Commander" } },
  { name: "CTA - Commander", description: "Invite à commander (bouton Je commande)", folder: "Principales PFlow Order", graph: ctaCommander },
  { name: "IA - Lancer commande", description: "Le client veut commander : bouton Je commande", folder: "Fonctions IA", graph: lancerCommande },
  { name: "IA - Proposer commande", description: "Réponse de l'IA puis proposition de commander", folder: "Fonctions IA", graph: proposerCommande },
  { name: "IA - Parler équipe", description: "Le client veut parler à une personne : transfert humain", folder: "Fonctions IA", graph: parlerEquipe },
  { name: "IA - Suivre commande", description: "Où en est la commande du client (réponse de PFlow Order)", folder: "Fonctions IA", graph: suivreCommande },
  { name: "IA - Annuler commande", description: "Annulation de la dernière commande, après confirmation (PFlow Order)", folder: "Fonctions IA", graph: annulerCommande },
  { name: "IA - Recommandation", description: "Conseille des produits de la carte selon l'envie du client", folder: "Fonctions IA", graph: recommandation },
  { name: "Commande - Paiement validé", description: "Confirmation de commande (payée en ligne ou à régler)", folder: "Commande", graph: paiementValide, gotos: { g_prep: "Statut - En préparation", g_prete: "Statut - Prête" } },
  { name: "Statut - En préparation", description: "La commande passe en préparation", folder: "Commande", graph: enPreparation },
  { name: "Statut - Prête", description: "La commande est prête (retrait ou livraison)", folder: "Commande", graph: prete },
  { name: "Panier abandonné", description: "Relance 20 min après un panier non validé (envoyé par PFlow Order)", folder: "Commande", graph: panierAbandonne },
  { name: "Statut - Annulée", description: "La commande est annulée (remboursée ou non)", folder: "Commande", graph: annulee },
  { name: "Statut - Remboursée", description: "Remboursement d'une commande payée en ligne", folder: "Commande", graph: remboursee },
  { name: "Statut - Annulation refusée", description: "Le client a demandé l'annulation, la commande est déjà en cours", folder: "Commande", graph: annulationRefusee },
  { name: "Rappel - Commande prête", description: "Commande prête pas encore récupérée (si le rappel est réglé dans PFlow Order)", folder: "Commande", graph: rappelPrete },
];

/** Flux de la trame absents du modèle (comparaison par nom). */
export function missingSeedFlows(existingNames: string[]): SeedFlow[] {
  const names = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return SEED_FLOWS.filter((f) => !names.has(f.name.toLowerCase()));
}

/**
 * Ajoute au modèle les dossiers et flux de la trame qui manquent, et les publie.
 * Ne modifie jamais un flux existant. Renvoie les noms des flux ajoutés.
 */
export async function completeMasterTemplate(repos: Repositories, templateId: string): Promise<string[]> {
  const folders = await repos.folders.listByOwner(templateId);
  const folderIds = new Map(folders.map((f) => [f.name, f.id]));
  for (const name of TEMPLATE_FOLDERS) {
    if (!folderIds.has(name)) folderIds.set(name, (await repos.folders.create({ ownerId: templateId, name })).id);
  }

  const existing = await repos.flows.listByOwner(templateId);
  const toAdd = missingSeedFlows(existing.map((f) => f.name));
  const created: { seed: SeedFlow; id: string }[] = [];
  for (const seed of toAdd) {
    const flow = await repos.flows.create({
      ownerKind: "template",
      ownerId: templateId,
      name: seed.name,
      description: seed.description,
      draft: seed.graph,
      folderId: folderIds.get(seed.folder),
    });
    created.push({ seed, id: flow.id });
  }

  // Cibles des « Aller à un flux », résolues par nom parmi tous les flux du modèle.
  const all = await repos.flows.listByOwner(templateId);
  const idByName = new Map(all.map((f) => [f.name.toLowerCase(), f.id]));
  for (const { seed, id } of created) {
    if (seed.gotos) {
      const draft: FlowGraph = {
        ...seed.graph,
        nodes: seed.graph.nodes.map((n): FlowNode => {
          if (n.type !== "goto_flow" || !seed.gotos![n.id]) return n;
          return { ...n, data: { flowId: idByName.get(seed.gotos![n.id].toLowerCase()) ?? "" } };
        }),
      };
      await repos.flows.update(id, { draft });
    }
    await repos.flows.publish(id);
  }
  // Agent IA : fonctions par défaut manquantes (ex. suivre_commande) et textes par défaut à jour.
  const template = (await repos.templates.list()).find((t) => t.id === templateId);
  const upgrade = template?.agent ? upgradeAgent(template.agent, await repos.flows.listByOwner(templateId)) : null;
  if (upgrade) await repos.templates.updateAgent(templateId, upgrade.agent);
  return [...created.map((c) => c.seed.name), ...(upgrade?.changes ?? []).map((c) => `Agent IA : ${c}`)];
}

/** Crée le modèle maître avec toute la trame (dossiers et flux publiés). */
export async function createMasterTemplate(repos: Repositories): Promise<BotTemplate> {
  const existing = (await repos.templates.list())[0];
  if (existing) return existing;
  const template = await repos.templates.create({ name: MASTER_TEMPLATE_NAME });
  await completeMasterTemplate(repos, template.id);
  // Agent IA par défaut : consigne PFlow et fonctions reliées au dossier « Fonctions IA ».
  return repos.templates.updateAgent(template.id, defaultAgent(await repos.flows.listByOwner(template.id)));
}
