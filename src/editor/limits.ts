/**
 * Limites des messages interactifs, par plateforme. La vérification d'un flux
 * applique les limites de toutes les plateformes des canaux du client.
 */
export type Platform = "whatsapp" | "instagram";

export interface PlatformLimits {
  name: string;
  /** Texte d'un message simple. */
  textBody: number;
  /** Texte au-dessus de boutons ou d'une liste. */
  interactiveBody: number;
  replyButtonsMax: number;
  replyButtonTitle: number;
  /** Liste déroulante (WhatsApp uniquement). */
  supportsList: boolean;
  listRowsMax: number;
  listRowTitle: number;
  listRowDescription: number;
  listButtonLabel: number;
  ctaButtonLabel: number;
}

export const PLATFORM_LIMITS: Record<Platform, PlatformLimits> = {
  // API WhatsApp Cloud : boutons de réponse (3 max, 20 car.), liste (10 lignes, 24 car.),
  // bouton lien « cta_url » (20 car.). Un message ne mélange pas boutons de réponse et bouton lien.
  whatsapp: {
    name: "WhatsApp",
    textBody: 4096,
    interactiveBody: 1024,
    replyButtonsMax: 3,
    replyButtonTitle: 20,
    supportsList: true,
    listRowsMax: 10,
    listRowTitle: 24,
    listRowDescription: 72,
    listButtonLabel: 20,
    ctaButtonLabel: 20,
  },
  // Messagerie Instagram (à revérifier dans la doc Meta au branchement) : texte 1 000 car. ; boutons de
  // réponse → réponses rapides (13 max, 20 car.) ; bouton lien → modèle « button » (texte 640 car.,
  // titre 20 car.) ; pas de liste déroulante (convertie en réponses rapides à l'envoi).
  instagram: {
    name: "Instagram",
    textBody: 1000,
    interactiveBody: 640,
    replyButtonsMax: 13,
    replyButtonTitle: 20,
    supportsList: false,
    listRowsMax: 0,
    listRowTitle: 0,
    listRowDescription: 0,
    listButtonLabel: 0,
    ctaButtonLabel: 20,
  },
};

/** Limites WhatsApp (compteurs de l'éditeur). */
export const WA_LIMITS = {
  textBody: PLATFORM_LIMITS.whatsapp.textBody,
  interactiveBody: PLATFORM_LIMITS.whatsapp.interactiveBody,
  buttonsMax: PLATFORM_LIMITS.whatsapp.replyButtonsMax,
  buttonTitle: PLATFORM_LIMITS.whatsapp.replyButtonTitle,
  listRowsMax: PLATFORM_LIMITS.whatsapp.listRowsMax,
  listRowTitle: PLATFORM_LIMITS.whatsapp.listRowTitle,
  listRowDescription: PLATFORM_LIMITS.whatsapp.listRowDescription,
  listButtonLabel: PLATFORM_LIMITS.whatsapp.listButtonLabel,
  ctaButtonLabel: PLATFORM_LIMITS.whatsapp.ctaButtonLabel,
} as const;
