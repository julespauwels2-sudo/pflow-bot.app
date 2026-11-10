/**
 * « ⭐ Me conseiller » avec des boutons, comme dans UChat : le bot propose des choix tirés de la carte (familles du
 * CRM, une par catégorie) ou de la liste personnalisée de la fiche du bot, plus « 🎲 Surprenez-moi ». Au clic, l'IA
 * recommande 2 ou 3 produits de ce choix, avec les prix, puis « 🛒 Commander » et « 🔄 Autre chose ».
 *
 * Règles de WhatsApp :
 * - jusqu'à 3 choix (Surprenez-moi compris) : boutons de réponse, titres de 20 caractères au plus ;
 * - au-delà : liste interactive, 10 lignes au plus, titres de 24 caractères au plus.
 */
import { normalize } from "./match";
import { localTime } from "./time";
import type { InfoSheet, IsoWeekday } from "./types";

export interface ConseilChoix {
  titre: string;
  /** Ce que recouvre le choix, pour l'IA (ex. « bowl, burrito et quesadillas à l'agneau »). */
  precision?: string;
  /** Jours où le choix est proposé (1 = lundi … 7 = dimanche). Absent : tous les jours. */
  jours?: IsoWeekday[];
}

export const CONSEIL_SURPRISE: ConseilChoix = { titre: "🎲 Surprenez-moi" };
export const CONSEIL_HANDLE_PREFIX = "conseil:";
export const CONSEIL_AUTRE_HANDLE = "conseil:autre";
export const MAX_BOUTONS = 3;
export const MAX_LIGNES_LISTE = 10;
export const MAX_TITRE_BOUTON = 20;
export const MAX_TITRE_LISTE = 24;

export const CONSEIL_TEXTS = {
  intro: "⭐ Je vous aide à choisir ! Qu'est-ce qui vous ferait plaisir ?",
  listeBouton: "Voir les choix",
  commander: "🛒 Commander",
  commanderTexte: "Ça vous tente ? Commandez ici 👇",
  autre: "🔄 Autre chose",
  autreTexte: "Envie d'autre chose ?",
} as const;

const JOURS: Record<string, IsoWeekday> = {
  lun: 1, lundi: 1, mar: 2, mardi: 2, mer: 3, mercredi: 3, jeu: 4, jeudi: 4, ven: 5, vendredi: 5, sam: 6, samedi: 6, dim: 7, dimanche: 7,
};
const JOURS_NOMS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** Coupe un titre trop long (WhatsApp refuse le message sinon). */
export function titreCourt(titre: string, max: number): string {
  const t = titre.trim();
  return [...t].length <= max ? t : `${[...t].slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * Liste personnalisée de la fiche du bot : un choix par ligne, « Titre | précision pour l'IA | jours ».
 * Jours facultatifs : « ven sam dim » ou « vendredi, samedi, dimanche ». Les lignes vides sont ignorées.
 */
export function parseConseilChoix(text: string | undefined): ConseilChoix[] {
  if (!text?.trim()) return [];
  const choix: ConseilChoix[] = [];
  for (const line of text.split("\n")) {
    const [titre, precision, jours] = line.split("|").map((s) => s.trim());
    if (!titre) continue;
    const days = (jours ?? "")
      .split(/[\s,;]+/)
      .map((w) => JOURS[normalize(w)])
      .filter((d): d is IsoWeekday => Boolean(d));
    choix.push({ titre, ...(precision ? { precision } : {}), ...(days.length ? { jours: [...new Set(days)].sort() as IsoWeekday[] } : {}) });
  }
  return choix;
}

/** Les choix du jour : liste personnalisée de la fiche, sinon familles de la carte ; seulement ceux servis aujourd'hui. */
export function conseilChoixDuJour(sheet: Pick<InfoSheet, "conseilChoix" | "familles">, now: Date, timezone: string): ConseilChoix[] {
  const perso = parseConseilChoix(sheet.conseilChoix);
  const source = perso.length ? perso : (sheet.familles ?? []);
  const jour = localTime(now, timezone).weekday;
  return source.filter((c) => !c.jours?.length || c.jours.includes(jour)).slice(0, MAX_LIGNES_LISTE - 1);
}

/** Le choix correspondant à un identifiant de bouton (« conseil:2 », « conseil:surprise »). */
export function choixDuHandle(choix: ConseilChoix[], handle: string): ConseilChoix | null {
  if (handle === `${CONSEIL_HANDLE_PREFIX}surprise`) return CONSEIL_SURPRISE;
  const i = Number(handle.slice(CONSEIL_HANDLE_PREFIX.length));
  return Number.isInteger(i) && choix[i] ? choix[i] : null;
}

/** Options affichées (identifiants « conseil:<n> » et « conseil:surprise »), titres coupés selon le format. */
export function optionsConseil(choix: ConseilChoix[]): { format: "boutons" | "liste"; options: { id: string; title: string }[] } {
  const all = [...choix.map((c, i) => ({ id: `${CONSEIL_HANDLE_PREFIX}${i}`, titre: c.titre })), { id: `${CONSEIL_HANDLE_PREFIX}surprise`, titre: CONSEIL_SURPRISE.titre }];
  const format = all.length <= MAX_BOUTONS ? "boutons" : "liste";
  const max = format === "boutons" ? MAX_TITRE_BOUTON : MAX_TITRE_LISTE;
  return { format, options: all.slice(0, MAX_LIGNES_LISTE).map((o) => ({ id: o.id, title: titreCourt(o.titre, max) })) };
}

/** Consigne de l'IA pour un choix : 2 ou 3 produits de la carte, avec les prix, disponibles aujourd'hui. */
export function consigneConseil(choix: ConseilChoix, now: Date, timezone: string): string {
  const jour = JOURS_NOMS[localTime(now, timezone).weekday];
  const cible =
    choix === CONSEIL_SURPRISE
      ? "Le client te laisse choisir : recommande 2 ou 3 produits variés et appétissants de la carte."
      : `Le client a choisi « ${choix.titre} »${choix.precision ? ` (${choix.precision})` : ""} : recommande 2 ou 3 produits de la carte qui correspondent à ce choix.`;
  return [
    cible,
    "Pour chaque produit : son nom en *gras* et son prix exact de la carte. Réponse courte et appétissante, une ligne par produit.",
    `Nous sommes ${jour} : ne propose jamais un produit indisponible aujourd'hui (jours de disponibilité indiqués dans la carte).`,
    "N'invente aucun produit ni aucun prix. N'écris pas de lien et ne pose pas de question : les boutons « Commander » et « Autre chose » suivent ta réponse.",
  ].join("\n");
}
