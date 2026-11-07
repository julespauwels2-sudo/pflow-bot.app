import { ORDER_EVENTS, type FlowNode } from "@/engine";

export interface VariableInfo {
  name: string;
  label: string;
}

export const BUILTIN_VARIABLES: VariableInfo[] = [
  { name: "prenom", label: "Prénom du client (profil WhatsApp d'un seul mot, sinon vide : « Hello ! »)" },
  { name: "nom_resto", label: "Nom du resto" },
  { name: "lien_commande", label: "Lien de commande" },
  { name: "nouvelle_conversation", label: "« oui » si le contact n'avait pas écrit depuis 12 h (ou jamais), sinon « non »" },
  // Fiche d'infos (calculées au fuseau du client)
  { name: "horaires", label: "Horaires de la semaine (jours regroupés)" },
  { name: "horaires_du_jour", label: "Horaires d'aujourd'hui" },
  { name: "adresse", label: "Adresse" },
  { name: "modes_service", label: "Livraison et / ou retrait" },
  { name: "infos_livraison", label: "Livraison : jours fixes par zone (+ livraisons exceptionnelles), ou zones, ou prochaines tournées" },
  { name: "zones_livraison", label: "Zones de livraison (mode zones)" },
  { name: "jours_livraison", label: "Jours de livraison fixes, par zone" },
  { name: "prochaines_livraisons", label: "Prochaines tournées (mode planning)" },
  { name: "points_de_vente", label: "Points de vente" },
  { name: "modes_paiement", label: "Moyens de paiement" },
  { name: "infos_pratiques", label: "Tout en un : horaires, adresse, livraison, points de vente, paiement" },
  { name: "ia_reponse", label: "Réponse de l'IA (fonction proposer_commande, étape A6)" },
];

/** Variables disponibles dans un flux : intégrées + réponses aux questions. */
export function flowVariables(nodes: FlowNode[]): VariableInfo[] {
  // Flux déclenché par un événement PFlow Order : ses données sont des variables.
  const trigger = nodes.find((n): n is Extract<FlowNode, { type: "trigger" }> => n.type === "trigger");
  const event = trigger?.data.event ? ORDER_EVENTS[trigger.data.event] : undefined;
  const fromEvent = (event?.variables ?? []).map((v) => ({ name: v.name, label: `${v.label} (${event!.label})` }));
  const fromQuestions = nodes
    .filter((n): n is Extract<FlowNode, { type: "question" }> => n.type === "question")
    .map((n) => n.data.variable.trim())
    .filter(Boolean);
  const taken = new Set([...BUILTIN_VARIABLES, ...fromEvent].map((v) => v.name));
  const unique = [...new Set(fromQuestions)].filter((v) => !taken.has(v));
  return [...BUILTIN_VARIABLES, ...fromEvent, ...unique.map((name) => ({ name, label: "Réponse à une question" }))];
}

/** Variables {{...}} utilisées dans un texte. */
export function usedVariables(text: string | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
}

export const VARIABLE_NAME = /^[a-z_][a-z0-9_]*$/;

/** Insère « {{nom}} » à la position du curseur. Renvoie le nouveau texte et la position du curseur. */
export function insertVariable(text: string, name: string, start: number, end = start): { text: string; cursor: number } {
  const token = `{{${name}}}`;
  const before = text.slice(0, start);
  const after = text.slice(end);
  const spaceBefore = before && !/\s$/.test(before) ? " " : "";
  const next = `${before}${spaceBefore}${token}${after}`;
  return { text: next, cursor: before.length + spaceBefore.length + token.length };
}
