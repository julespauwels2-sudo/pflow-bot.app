/** Limites de l'API WhatsApp Cloud pour les messages interactifs. */
export const WA_LIMITS = {
  textBody: 4096,
  interactiveBody: 1024,
  buttonsMax: 3,
  buttonTitle: 20,
  listRowsMax: 10,
  listRowTitle: 24,
  listRowDescription: 72,
  listButtonLabel: 20,
  ctaButtonLabel: 20,
} as const;
