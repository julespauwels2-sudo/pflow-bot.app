/**
 * Les 10 modèles WhatsApp de la livraison (contrat docs/livraison/INTERFACE-PFLOW-BOTS.md du CRM, §8 ; textes exacts :
 * docs/livraison/GUIDE-MODELES-WHATSAPP.md). Catégorie Utility, langue fr, bouton « Suivre ma livraison » vers
 * https://order.pflow.fr/suivi/{{1}}. Créés automatiquement sur le compte WhatsApp de chaque resto connecté par
 * l'Embedded Signup (POST /{waba-id}/message_templates). Les noms et l'ordre des variables ne doivent jamais changer.
 *
 * 11 novembre 2026 : textes de livreur_trouve, en_route, arrive_bientot, livreur_arrive et heure_maj réécrits après
 * leur refus par Meta sur le compte de PFlow (mêmes variables, même ordre). Le livreur ({{1}}) n'est plus collé à
 * « Votre livreur » : le CRM envoie « Votre livreur » quand le livreur n'a pas de nom affiché.
 */
export interface LivraisonTemplate {
  name: string;
  body: string;
  examples: string[];
}

export const SUIVI_URL = "https://order.pflow.fr/suivi/{{1}}";
export const SUIVI_EXEMPLE = "https://order.pflow.fr/suivi/0b6f2c1e-1111-4222-8333-444455556666";
export const SUIVI_BOUTON = "Suivre ma livraison";

export const LIVRAISON_TEMPLATES: LivraisonTemplate[] = [
  {
    name: "pflow_livraison_confirmee",
    body: "Chez {{1}}, votre commande n° {{2}} est confirmée. Nous cherchons un livreur PFlow. Votre code de livraison vous sera envoyé quand le livreur arrivera.",
    examples: ["Bokit An Nou", "1042"],
  },
  {
    name: "pflow_livraison_livreur_trouve",
    body: "Un livreur a accepté votre commande. {{1}} la récupérera au restaurant dès qu'elle sera prête. Nous vous préviendrons ici quand elle sera en route.",
    examples: ["Alice"],
  },
  {
    name: "pflow_livraison_en_route",
    body: "Votre commande a quitté le restaurant. {{1}} est en route vers chez vous, arrivée prévue : {{2}}. Suivez la livraison avec le bouton ci-dessous.",
    examples: ["Alice", "12h45"],
  },
  {
    name: "pflow_livraison_arrive_bientot",
    body: "Votre commande arrive dans environ 2 minutes. {{1}} vous demandera votre code de livraison, qui est le {{2}}. Gardez-le à portée de main pour la remise.",
    examples: ["Alice", "4821"],
  },
  {
    name: "pflow_livraison_livreur_arrive",
    body: "Votre commande est arrivée. {{1}} vous attend et vous demandera votre code de livraison, qui est le {{2}}. Donnez-le pour recevoir votre commande.",
    examples: ["Alice", "4821"],
  },
  {
    name: "pflow_livraison_paiement_refuse",
    body: "Votre carte a été refusée au moment de la remise de votre commande. Payez à nouveau avant {{1}} avec le bouton ci-dessous pour être livré. Sans paiement, la commande reste au restaurant.",
    examples: ["12h40"],
  },
  {
    name: "pflow_livraison_aucun_livreur",
    body: "Aucun livreur n'est disponible pour le moment pour votre commande chez {{1}}. Rien n'a été prélevé. Avec le bouton ci-dessous, choisissez : venir la chercher au restaurant (sans frais de livraison) ou annuler.",
    examples: ["Bokit An Nou"],
  },
  {
    name: "pflow_livraison_annulee",
    body: "Chez {{1}}, votre commande n° {{2}} a été annulée. Rien ne vous a été prélevé.",
    examples: ["Bokit An Nou", "1042"],
  },
  {
    name: "pflow_livraison_annulee_sans_livreur",
    body: "Chez {{1}}, aucun livreur n'a pu prendre votre commande n° {{2}}. Sans réponse de votre part, elle a été annulée. Rien ne vous a été prélevé.",
    examples: ["Bokit An Nou", "1042"],
  },
  {
    name: "pflow_livraison_heure_maj",
    body: "L'heure de livraison de votre commande a changé. {{1}} arrivera vers {{2}}. Suivez la livraison avec le bouton ci-dessous.",
    examples: ["Alice", "12h52"],
  },
];

/** Les composants (texte + bouton) d'un modèle de livraison. */
export function templateComponents(t: LivraisonTemplate): Record<string, unknown>[] {
  return [
    { type: "BODY", text: t.body, example: { body_text: [t.examples] } },
    { type: "BUTTONS", buttons: [{ type: "URL", text: SUIVI_BOUTON, url: SUIVI_URL, example: [SUIVI_EXEMPLE] }] },
  ];
}

/** Corps de POST /{waba-id}/message_templates pour un modèle de livraison. */
export function templatePayload(t: LivraisonTemplate): Record<string, unknown> {
  return { name: t.name, language: "fr", category: "UTILITY", components: templateComponents(t) };
}

/** Motifs de refus de Meta (champ rejected_reason), expliqués. */
export const MOTIFS_REFUS: Record<string, string> = {
  INVALID_FORMAT: "Format refusé : variable mal placée (début, fin, collée), trop de variables pour la longueur, ou exemple incohérent.",
  INCORRECT_CATEGORY: "Catégorie refusée : Meta estime que le texte n'est pas « Utilitaire » (publicité, ou code à usage unique qui relève d'« Authentification »).",
  TAG_CONTENT_MISMATCH: "Le texte ne correspond pas à la catégorie ou à la langue déclarée.",
  ABUSIVE_CONTENT: "Contenu jugé abusif ou contraire aux règles de WhatsApp.",
  SCAM: "Contenu jugé trompeur (arnaque possible).",
  PROMOTIONAL: "Contenu jugé promotionnel dans un modèle Utilitaire.",
};
