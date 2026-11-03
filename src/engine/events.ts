/**
 * Événements envoyés par PFlow Order (branchement à l'étape C). Chaque événement apporte
 * ses données, disponibles comme variables dans le flux déclenché.
 *
 * Règle : pas de templates Meta. Le bot n'envoie rien si la fenêtre de 24 h est fermée
 * (client arrivé directement sur le mini-site sans avoir écrit au bot).
 */
export type OrderEvent = "commande_validee" | "commande_en_preparation" | "commande_prete" | "panier_abandonne";

export interface EventVariable {
  name: string;
  label: string;
  /** Valeur d'exemple (simulateur, aperçu). */
  example: string;
}

export interface OrderEventInfo {
  label: string;
  description: string;
  icon: string;
  variables: EventVariable[];
}

const clientNom: EventVariable = { name: "client_nom", label: "Prénom / nom saisi dans la commande", example: "Léa" };
const numero: EventVariable = { name: "commande_numero", label: "Numéro de commande", example: "1042" };
const mode: EventVariable = { name: "commande_mode", label: "« livraison » ou « retrait »", example: "livraison" };

export const ORDER_EVENTS: Record<OrderEvent, OrderEventInfo> = {
  commande_validee: {
    label: "Commande validée",
    description: "Le client vient de valider sa commande (payée en ligne ou à régler sur place).",
    icon: "🧾",
    variables: [
      clientNom,
      numero,
      mode,
      { name: "commande_recap", label: "Récapitulatif des produits", example: "• 2 × Cookies Nutella\n• 1 × Box 6 Cookies" },
      { name: "commande_total", label: "Total affiché", example: "32 €" },
      { name: "paiement_mode", label: "« en_ligne » ou « sur_place »", example: "en_ligne" },
      { name: "commande_statut", label: "Statut au moment de l'envoi : « recue », « en_preparation » ou « prete »", example: "recue" },
    ],
  },
  commande_en_preparation: {
    label: "Commande en préparation",
    description: "La commande passe en préparation.",
    icon: "👨‍🍳",
    variables: [clientNom, numero, mode],
  },
  commande_prete: {
    label: "Commande prête",
    description: "La commande est prête (à récupérer ou en livraison).",
    icon: "✅",
    variables: [clientNom, numero, mode],
  },
  panier_abandonne: {
    label: "Panier abandonné",
    description: "PFlow Order l'envoie 20 minutes après un panier commencé et non validé.",
    icon: "🛒",
    variables: [
      clientNom,
      { name: "panier_recap", label: "Contenu du panier", example: "• 2 × Cookies Kinder" },
      { name: "panier_total", label: "Total du panier", example: "8 €" },
      { name: "lien_panier", label: "Lien pour reprendre le panier (lien de commande par défaut)", example: "https://order.pflow.fr/c/exemple?panier=abc" },
    ],
  },
};

export const ORDER_EVENT_TYPES = Object.keys(ORDER_EVENTS) as OrderEvent[];

export function isOrderEvent(value: unknown): value is OrderEvent {
  return typeof value === "string" && value in ORDER_EVENTS;
}

/** Données d'exemple d'un événement (simulateur). */
export function exampleEventData(event: OrderEvent): Record<string, string> {
  return Object.fromEntries(ORDER_EVENTS[event].variables.map((v) => [v.name, v.example]));
}
