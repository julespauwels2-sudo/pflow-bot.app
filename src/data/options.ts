/**
 * Options payantes d'un client. Une option désactivée rend inactifs les flux qui en dépendent
 * (ici : les flux déclenchés par certains événements PFlow Order).
 * À l'étape B, l'état des options pourra venir du CRM (ce que le client paie).
 */
import type { OrderEvent } from "@/engine";

export type BotOption = "panier_abandonne";

export interface BotOptionInfo {
  label: string;
  description: string;
  /** Événements PFlow Order réservés à cette option. */
  events: OrderEvent[];
}

export const BOT_OPTIONS: Record<BotOption, BotOptionInfo> = {
  panier_abandonne: {
    label: "Relance panier abandonné",
    description: "Message automatique 20 minutes après un panier commencé et non validé.",
    events: ["panier_abandonne"],
  },
};

export const BOT_OPTION_KEYS = Object.keys(BOT_OPTIONS) as BotOption[];

/** Option qui conditionne cet événement (undefined = toujours disponible). */
export function optionForEvent(event: string | undefined): BotOption | undefined {
  if (!event) return undefined;
  return BOT_OPTION_KEYS.find((key) => (BOT_OPTIONS[key].events as string[]).includes(event));
}
