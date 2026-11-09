/**
 * Numéro PFlow Démo : réponses intelligentes en plein parcours.
 * - Politesse (« Salut, ça va ? », « merci », « ok ») : réponse courte et sympa, puis rappel de l'étape. Aucune alerte.
 * - Question sur PFlow : l'IA (Claude Haiku) répond À PARTIR DE LA BASE DE CONNAISSANCES SEULEMENT, puis la démo
 *   reprend (bouton de l'étape + [💬 Parler à Jules]). Pas d'alerte quand elle a su répondre.
 * - Alerte à Jules seulement si : réponse absente de la base, envie de s'inscrire / signer, négociation de prix,
 *   question sur la livraison (en préparation : aucun détail), demande à parler à Jules.
 * - Jamais de prix, de fonctionnalité ni de délai inventés : un montant absent de la base fait basculer en « inconnu ».
 * La base est modifiable sans code (page Démos → « Bot PFlow Démo : base de connaissances ») ; elle est rangée dans
 * bot_fiches sous un identifiant fixe (aucun resto du CRM ne l'a, la sauvegarde des fiches ne la touche jamais).
 */
import { normalize } from "@/engine";

/** Ligne de bot_fiches de la base de connaissances du bot PFlow Démo (identifiant fixe, hors CRM). */
export const DEMO_KNOWLEDGE_ID = "0f10e000-0000-4000-8000-000000000001";

export interface DemoKnowledge {
  /** Ce que PFlow propose (une information par ligne). */
  faq: string;
  /** Règles de réponse (ce que l'IA ne doit jamais faire, quand passer la main). */
  regles: string;
  majLe?: string;
}

export const DEFAULT_DEMO_KNOWLEDGE: DemoKnowledge = {
  faq: [
    "- Abonnement PFlow Order : 49 €/mois, sans engagement, sans commission sur les commandes.",
    "- Pas de frais de mise en place : seulement l'abonnement à 49 €/mois, sans engagement, sans commission.",
    "- Une page de commande au nom du resto, à ses couleurs, avec sa carte.",
    "- Un assistant WhatsApp qui répond aux clients et les envoie vers la commande.",
    "- Un tableau de bord où le resto suit ses commandes en direct et gère lui-même sa carte, ses prix, ses horaires, ses ruptures, le mode rush et les pauses.",
    "- Paiement en ligne inclus (SumUp ou Stripe) ou paiement sur place.",
    "- Le client est prévenu sur WhatsApp quand sa commande est prête.",
    "- Options payantes en plus : gestion du stock, relance des paniers, avis Google.",
    "- Livraison : en cours de développement, plusieurs formules à venir.",
  ].join("\n"),
  regles: [
    "- Ne jamais inventer un prix, une fonctionnalité ou un délai : si ce n'est pas écrit ci-dessus, dire que Jules répond.",
    "- Livraison : dire seulement que c'est en préparation, plusieurs formules à venir. Aucun détail (prix, zones, délais).",
    "- Prix des options payantes : pas dans la base, Jules répond.",
    "- Négociation (remise, réduction, geste commercial) : Jules répond.",
  ].join("\n"),
};

// ---------------------------------------------------------------------------
// Politesse
// ---------------------------------------------------------------------------

/** Mots de politesse : un message fait seulement de ces mots est une politesse, pas une question. */
const COURTESY_WORDS = new Set(
  "salut bonjour bonsoir coucou hello hey yo slt bjr cc re rebonjour ca va cava vas tu vous et toi bien tres trop oui ouais merci mercii beaucoup bcp ok okay oki dac daccord d accord super top parfait genial cool nickel impeccable bonne journee soiree soir nuit au revoir a plus bientot bye ciao ah oh ben bon alors aussi moi pas mal tranquille sava".split(" "),
);

export function courtesyReply(text: string): string | null {
  const words = normalize(text).split(" ").filter(Boolean);
  if (!words.length || words.length > 8 || !words.every((w) => COURTESY_WORDS.has(w))) return null;
  const has = (...list: string[]) => list.some((w) => words.includes(w));
  if (has("merci", "mercii")) return "Avec plaisir 😊";
  if (has("revoir", "bye", "ciao", "bientot") || (has("bonne") && has("journee", "soiree", "nuit"))) return "Merci à vous, à très vite 👋";
  if (has("va", "cava", "sava", "vas")) return "Ça va très bien, merci 😊 Et vous ?";
  if (has("salut", "bonjour", "bonsoir", "coucou", "hello", "hey", "yo", "slt", "bjr", "cc", "re", "rebonjour")) return "Bonjour 👋";
  return "Super 👍";
}

// ---------------------------------------------------------------------------
// Catégories qui passent toujours par Jules (repérées sans l'IA)
// ---------------------------------------------------------------------------

export type DemoAnswerStatus = "repondu" | "inconnu" | "inscription" | "prix" | "livraison" | "parler_jules";

export function forcedStatus(text: string): Exclude<DemoAnswerStatus, "repondu" | "inconnu"> | null {
  const t = ` ${normalize(text)} `;
  if (/ livr/.test(t)) return "livraison";
  if (/ (remise|reduction|rabais|geste commercial|moins cher|negoci|promo|ristourne|discount|faire un prix|baisser le prix)/.test(t)) return "prix";
  if (/ (m inscrire|inscrire|inscription|signer|souscrire|m abonner|abonner|je prends|je m engage|commencer avec|demarrer avec|je suis partant|on y va|je veux le mien)/.test(t)) return "inscription";
  if (/ (parler a jules|appeler jules|joindre jules|un humain|parler a quelqu un|parler a une personne|me rappeler|rappelez moi|appelez moi)/.test(t)) return "parler_jules";
  return null;
}

/** Ce que le bot dit quand Jules est prévenu, selon la raison ; et le motif de l'alerte. */
export const HANDOFF_REPLIES: Record<Exclude<DemoAnswerStatus, "repondu">, { texte: string; motif: string }> = {
  inconnu: { texte: "Bonne question ! Jules vous répond très vite 🙂", motif: "Question sans réponse dans la base" },
  inscription: { texte: "Super ! Jules vous recontacte très vite pour la mise en place 🙂", motif: "Veut s'inscrire" },
  prix: { texte: "Jules vous répond très vite sur ce point 🙂", motif: "Question de prix / négociation" },
  livraison: { texte: "La livraison est en préparation : plusieurs formules arrivent bientôt. Jules vous en dit plus très vite 🙂", motif: "Question sur la livraison" },
  parler_jules: { texte: "Pas de souci, Jules vous répond très vite 🙂", motif: "Demande à parler à Jules" },
};

// ---------------------------------------------------------------------------
// Réponse de l'IA, à partir de la base seulement
// ---------------------------------------------------------------------------

export interface DemoAnswer {
  statut: DemoAnswerStatus;
  reponse: string;
}

/** Appel du modèle : renvoie le texte JSON produit (injecté : Claude en production, faux modèle dans les tests). */
export type DemoCompletion = (input: { system: string; question: string }) => Promise<string>;

export function demoSystemPrompt(kb: DemoKnowledge): string {
  return [
    "Tu es l'assistant WhatsApp de PFlow, en Guadeloupe. PFlow vend PFlow Order aux restaurants. Tu parles à un restaurateur",
    "qui teste la démo. Tu réponds en français, en vouvoyant, en 1 à 3 phrases courtes, ton chaleureux, sans lien ni liste.",
    "",
    "Tu ne réponds QU'AVEC les informations de la BASE ci-dessous. Si la réponse n'y est pas écrite clairement, statut « inconnu ».",
    "Tu n'inventes JAMAIS un prix, un montant, une fonctionnalité, une durée ou un délai.",
    "",
    "Statuts :",
    "- repondu : la base contient la réponse ; « reponse » = ta réponse.",
    "- inconnu : la réponse n'est pas dans la base (ou tu as un doute).",
    "- inscription : le restaurateur veut s'inscrire, signer, commencer, s'abonner.",
    "- prix : il négocie (remise, réduction) ou demande un prix qui n'est pas dans la base.",
    "- livraison : toute question sur la livraison.",
    "- parler_jules : il veut parler à Jules ou à une personne.",
    "Pour tout statut autre que « repondu », « reponse » est vide.",
    "",
    "BASE (ce que PFlow propose) :",
    kb.faq.trim() || "(vide)",
    "",
    "RÈGLES :",
    kb.regles.trim() || "(aucune)",
  ].join("\n");
}

export const DEMO_ANSWER_SCHEMA = {
  type: "object",
  properties: {
    statut: { type: "string", enum: ["repondu", "inconnu", "inscription", "prix", "livraison", "parler_jules"] },
    reponse: { type: "string" },
  },
  required: ["statut", "reponse"],
  additionalProperties: false,
} as const;

/** Montants cités (« 49 € », « 49 euros », « 49€/mois ») : chacun doit être écrit dans la base. */
function amounts(text: string): string[] {
  return [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:€|euros?\b|eur\b)/gi)].map((m) => m[1].replace(",", "."));
}

/**
 * Réponse à une question, à partir de la base seulement. Garde-fous en plus de la consigne :
 * - livraison, inscription, négociation, demande de Jules : repérées sans l'IA (toujours Jules) ;
 * - un montant qui n'est pas dans la base, ou une réponse vide : « inconnu » (Jules répond, rien d'inventé).
 */
export async function answerDemoQuestion(complete: DemoCompletion, kb: DemoKnowledge, question: string): Promise<DemoAnswer> {
  const forced = forcedStatus(question);
  if (forced) return { statut: forced, reponse: "" };
  const raw = await complete({ system: demoSystemPrompt(kb), question: question.slice(0, 1000) });
  let parsed: Partial<DemoAnswer>;
  try {
    parsed = JSON.parse(raw) as Partial<DemoAnswer>;
  } catch {
    return { statut: "inconnu", reponse: "" };
  }
  const statut = parsed.statut;
  const reponse = typeof parsed.reponse === "string" ? parsed.reponse.trim().slice(0, 700) : "";
  if (statut !== "repondu") {
    return { statut: statut && statut in HANDOFF_REPLIES ? statut : "inconnu", reponse: "" };
  }
  if (!reponse) return { statut: "inconnu", reponse: "" };
  // Garde-fous : rien de la livraison, aucun montant absent de la base.
  if (forcedStatus(reponse) === "livraison") return { statut: "livraison", reponse: "" };
  const known = new Set(amounts(`${kb.faq}\n${kb.regles}`));
  if (amounts(reponse).some((a) => !known.has(a))) return { statut: "inconnu", reponse: "" };
  return { statut: "repondu", reponse };
}
