/**
 * Les 10 modèles WhatsApp de la livraison (contrat docs/livraison/INTERFACE-PFLOW-BOTS.md du CRM, §8 ; textes exacts :
 * docs/livraison/GUIDE-MODELES-WHATSAPP.md). Catégorie Utility, langue fr, bouton « Suivre ma livraison » vers
 * https://order.pflow.fr/suivi/{{1}}. Créés automatiquement sur le compte WhatsApp de chaque resto connecté par
 * l'Embedded Signup (POST /{waba-id}/message_templates). Les noms et l'ordre des variables ne doivent jamais changer.
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
    body: "Bonne nouvelle : {{1}} va vous livrer. Le restaurant prépare votre commande. Gardez votre code de livraison pour son arrivée.",
    examples: ["Alice"],
  },
  {
    name: "pflow_livraison_en_route",
    body: "Votre livreur {{1}} a récupéré votre commande et arrive vers {{2}}. Préparez votre code de livraison.",
    examples: ["Alice", "12h45"],
  },
  {
    name: "pflow_livraison_arrive_bientot",
    body: "Votre livreur {{1}} arrive dans 2 minutes avec votre commande. Votre code de livraison : {{2}}. Donnez-le au livreur à son arrivée.",
    examples: ["Alice", "4821"],
  },
  {
    name: "pflow_livraison_livreur_arrive",
    body: "Votre livreur {{1}} est arrivé avec votre commande. Votre code de livraison : {{2}}. Donnez-le au livreur pour recevoir votre sac.",
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
    body: "Petit changement : {{1}} arrivera vers {{2}} avec votre commande. Votre code de livraison vous sera rappelé juste avant.",
    examples: ["Alice", "12h52"],
  },
];

/** Corps de POST /{waba-id}/message_templates pour un modèle de livraison. */
export function templatePayload(t: LivraisonTemplate): Record<string, unknown> {
  return {
    name: t.name,
    language: "fr",
    category: "UTILITY",
    components: [
      { type: "BODY", text: t.body, example: { body_text: [t.examples] } },
      { type: "BUTTONS", buttons: [{ type: "URL", text: SUIVI_BOUTON, url: SUIVI_URL, example: [SUIVI_EXEMPLE] }] },
    ],
  };
}
