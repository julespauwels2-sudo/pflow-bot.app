/**
 * Base de connaissances d'un client, générée depuis sa fiche d'infos : c'est exactement ce que
 * l'IA sait du resto (affiché tel quel sur la page client, « Ce que l'IA sait de ce resto »).
 * Étape B : horaires et carte lus dans le CRM et PFlow Order.
 */
import {
  fixedDeliveryDays,
  formatFixedDelivery,
  formatRound,
  formatWeeklyHours,
  isPlanningDelivery,
  NO_ROUND_TEXT,
  type InfoSheet,
} from "@/engine";

/** Nombre maximum de tournées données à l'IA (les plus proches). */
export const MAX_AI_ROUNDS = 12;

export interface KnowledgeInput {
  nomResto: string;
  /** Fiche d'infos sans les tournées passées (voir withUpcomingRounds). */
  infoSheet: InfoSheet;
  lienCommande: string;
}

function section(title: string, body: string | undefined): string | null {
  const text = body?.trim();
  return text ? `## ${title}\n${text}` : null;
}

export function buildKnowledgeBase({ nomResto, infoSheet: sheet, lienCommande }: KnowledgeInput): string {
  const parts: (string | null)[] = [];

  const hours = sheet.horaires.length ? formatWeeklyHours(sheet) : "";
  parts.push(section("Horaires d'ouverture", hours || (sheet.horairesNote?.trim() ? "" : "Non renseignés.")));
  if (sheet.horairesNote?.trim() && !hours.includes(sheet.horairesNote.trim())) parts.push(sheet.horairesNote.trim());

  parts.push(section("Adresse", sheet.adresse));

  const modes: string[] = [];
  if (sheet.livraison === true) modes.push("Livraison : oui.");
  if (sheet.livraison === false) modes.push("Livraison : non, le resto ne livre pas.");
  if (sheet.retrait === true) modes.push("Retrait sur place : oui.");
  if (sheet.retrait === false) modes.push("Retrait sur place : non.");
  parts.push(section("Modes de service", modes.join("\n")));

  const fixed = fixedDeliveryDays(sheet);
  if (sheet.livraison && fixed.length) {
    // Jours fixes chaque semaine ; les tournées datées à venir s'y ajoutent.
    parts.push(
      section(
        "Jours de livraison (chaque semaine)",
        [
          formatFixedDelivery(fixed, sheet.zonesLivraison),
          "Le resto livre ces zones uniquement ces jours-là. Ne promets jamais un autre jour ni une autre zone.",
        ].join("\n"),
      ),
    );
    const rounds = (sheet.tournees ?? []).slice(0, MAX_AI_ROUNDS);
    if (rounds.length) {
      parts.push(section("Livraisons exceptionnelles (dates à venir, en plus des jours fixes)", rounds.map(formatRound).join("\n")));
    }
  } else if (sheet.livraison) {
    // La fiche reçue ne contient que les tournées à venir.
    if (isPlanningDelivery(sheet, sheet.tournees?.length ?? 0)) {
      const rounds = (sheet.tournees ?? []).slice(0, MAX_AI_ROUNDS);
      parts.push(
        section(
          "Livraison sur planning (tournées à venir)",
          [
            rounds.length ? rounds.map(formatRound).join("\n") : NO_ROUND_TEXT,
            "Le resto livre uniquement à ces dates et à ces endroits. Ne propose jamais une autre date ou un autre lieu.",
          ].join("\n"),
        ),
      );
    } else {
      parts.push(
        section(
          "Zones de livraison",
          sheet.zonesLivraison?.trim()
            ? `${sheet.zonesLivraison.trim()}\nSi une adresse n'est dans aucune de ces zones, la livraison n'y est pas prévue.`
            : "Non renseignées : ne garantis aucune zone, propose de vérifier avec l'équipe.",
        ),
      );
    }
  }

  parts.push(section("Points de vente", sheet.pointsDeVente));
  parts.push(section("Moyens de paiement", sheet.modesPaiement));
  parts.push(section("Carte", sheet.resumeCarte));
  parts.push(section("Questions fréquentes", sheet.faq));
  parts.push(section("Règles spéciales du resto", sheet.reglesSpeciales));
  // Jamais l'adresse elle-même : l'IA ne doit pas l'écrire, le bouton « Commander » s'en charge.
  parts.push(
    section(
      "Commander",
      lienCommande
        ? "Commande en ligne sur la page de commande PFlow Order, ouverte par le bouton « Commander » (fonctions proposer_commande ou lancer_commande). N'écris jamais son adresse."
        : "Pas de page de commande en ligne pour l'instant.",
    ),
  );

  return [`# ${nomResto}`, ...parts.filter((p): p is string => Boolean(p))].join("\n\n");
}

/** Champs de la fiche utiles à l'IA et encore vides (aide à l'onboarding). */
export function missingKnowledge(sheet: InfoSheet): string[] {
  const missing: string[] = [];
  if (!sheet.horaires.length) missing.push("horaires");
  if (!sheet.resumeCarte?.trim()) missing.push("carte");
  if (!sheet.modesPaiement?.trim()) missing.push("moyens de paiement");
  if (sheet.livraison && !fixedDeliveryDays(sheet).length && !isPlanningDelivery(sheet, sheet.tournees?.length ?? 0) && !sheet.zonesLivraison?.trim()) {
    missing.push("zones de livraison");
  }
  if (sheet.livraison === undefined && sheet.retrait === undefined) missing.push("modes de service (livraison, retrait)");
  return missing;
}
