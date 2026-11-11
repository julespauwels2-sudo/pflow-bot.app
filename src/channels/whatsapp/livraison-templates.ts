/**
 * Les 10 modèles WhatsApp de la livraison (contrat docs/livraison/INTERFACE-PFLOW-BOTS.md du CRM, §8 ; textes exacts :
 * docs/livraison/GUIDE-MODELES-WHATSAPP.md). Catégorie Utility, langue fr, bouton « Suivre ma livraison » vers
 * https://order.pflow.fr/suivi/{{1}}. Créés automatiquement sur le compte WhatsApp de chaque resto connecté par
 * l'Embedded Signup (POST /{waba-id}/message_templates). Les noms et l'ordre des variables ne doivent jamais changer.
 *
 * 11 novembre 2026 : les 6 modèles confirmee, livreur_trouve, en_route, arrive_bientot, livreur_arrive et heure_maj
 * ont été refusés par Meta (INCORRECT_CATEGORY : un code dans le message relève d'« Authentification »). Nouvelle
 * version validée par Jules : même structure que les 4 approuvés ({{1}} resto, {{2}} n° de commande, {{3}} heure),
 * plus de prénom du livreur, AUCUN code (ni le mot) : le code s'affiche seulement sur la page de suivi.
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
    body: "Chez {{1}}, votre commande n° {{2}} est confirmée. Un livreur va lui être attribué. Le suivi de la livraison est disponible avec le bouton ci-dessous.",
    examples: ["Bokit An Nou", "1042"],
  },
  {
    name: "pflow_livraison_livreur_trouve",
    body: "Chez {{1}}, un livreur a été attribué à votre commande n° {{2}}. Il la récupérera au restaurant dès qu'elle sera prête. Le suivi est disponible avec le bouton ci-dessous.",
    examples: ["Bokit An Nou", "1042"],
  },
  {
    name: "pflow_livraison_en_route",
    body: "Chez {{1}}, votre commande n° {{2}} a été remise au livreur. Heure d'arrivée estimée : {{3}}. Le suivi de la livraison est disponible avec le bouton ci-dessous.",
    examples: ["Bokit An Nou", "1042", "12h45"],
  },
  {
    name: "pflow_livraison_arrive_bientot",
    body: "Chez {{1}}, votre commande n° {{2}} arrive dans environ 2 minutes. Les informations de remise sont affichées sur la page de suivi, accessible avec le bouton ci-dessous.",
    examples: ["Bokit An Nou", "1042"],
  },
  {
    name: "pflow_livraison_livreur_arrive",
    body: "Chez {{1}}, le livreur de votre commande n° {{2}} est arrivé à votre adresse. Les informations de remise sont affichées sur la page de suivi, accessible avec le bouton ci-dessous.",
    examples: ["Bokit An Nou", "1042"],
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
    body: "Chez {{1}}, l'heure de livraison de votre commande n° {{2}} a été mise à jour. Nouvelle heure d'arrivée estimée : {{3}}. Le détail est disponible sur la page de suivi.",
    examples: ["Bokit An Nou", "1042", "12h52"],
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
