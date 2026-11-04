/**
 * Variables tirées de la fiche d'infos du client ({{horaires}}, {{infos_livraison}}…),
 * calculées dans le fuseau du client. Utilisées par le moteur et par l'aperçu de l'éditeur.
 */
import { WEEKDAY_LABELS, localTime, parseHhmm } from "./time";
import type { DeliveryDays, DeliveryRound, InfoSheet, IsoWeekday, TimeRange } from "./types";

const DAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** « et » à la française : « lundi, samedi et dimanche ». */
export function joinFr(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

/** "08:00" → « 8h », "11:30" → « 11h30 ». */
export function formatHour(hhmm: string): string {
  const minutes = parseHhmm(hhmm);
  if (minutes === null) return hhmm;
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export const formatRange = (r: TimeRange) => `${formatHour(r.de)} – ${formatHour(r.a)}`;

function plagesOf(sheet: Pick<InfoSheet, "horaires">, jour: IsoWeekday): TimeRange[] {
  return sheet.horaires
    .filter((d) => d.jour === jour)
    .flatMap((d) => d.plages)
    .sort((x, y) => (parseHhmm(x.de) ?? 0) - (parseHhmm(y.de) ?? 0));
}

/**
 * Horaires de la semaine, jours identiques regroupés :
 * « Du mardi au vendredi : 8h – 12h » / « Fermé le lundi, le samedi et le dimanche ».
 */
export function formatWeeklyHours(sheet: Pick<InfoSheet, "horaires" | "horairesNote">): string {
  const keyOf = (jour: IsoWeekday) => plagesOf(sheet, jour).map(formatRange).join(" et ");
  const lines: string[] = [];
  const closed: string[] = [];
  let i = 0;
  while (i < DAYS.length) {
    const key = keyOf(DAYS[i]);
    if (!key) {
      closed.push(WEEKDAY_LABELS[DAYS[i]]);
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < DAYS.length && keyOf(DAYS[j + 1]) === key) j += 1;
    const first = WEEKDAY_LABELS[DAYS[i]];
    const last = WEEKDAY_LABELS[DAYS[j]];
    const days = i === j ? capitalize(first) : j === i + 1 ? `${capitalize(first)} et ${last}` : `Du ${first} au ${last}`;
    lines.push(`${days} : ${key}`);
    i = j + 1;
  }
  if (!lines.length) return sheet.horairesNote?.trim() ?? "";
  if (closed.length) lines.push(`Fermé ${joinFr(closed.map((d) => `le ${d}`))}`);
  if (sheet.horairesNote?.trim()) lines.push(sheet.horairesNote.trim());
  return lines.join("\n");
}

/** « Aujourd'hui (mardi) : 8h – 12h » ou « Aujourd'hui (lundi) : fermé ». */
export function formatTodayHours(sheet: Pick<InfoSheet, "horaires">, now: Date, timezone: string): string {
  const t = localTime(now, timezone);
  const plages = plagesOf(sheet, t.weekday);
  const label = WEEKDAY_LABELS[t.weekday];
  return `Aujourd'hui (${label}) : ${plages.length ? plages.map(formatRange).join(" et ") : "fermé"}`;
}

/** « mardi 10 novembre » à partir de "2026-11-10". */
export function formatDateFr(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
}

/**
 * Tournées à venir, triées. Une tournée du jour dont la plage horaire est terminée est passée ;
 * sans plage horaire, elle reste valable toute la journée.
 */
export function upcomingRounds(rounds: DeliveryRound[] | undefined, now: Date, timezone: string): DeliveryRound[] {
  const t = localTime(now, timezone);
  return (rounds ?? [])
    .filter((r) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return false;
      if (r.date > t.date) return true;
      if (r.date < t.date) return false;
      const end = r.a ? parseHhmm(r.a) : null;
      return end === null || end > t.minutes;
    })
    .sort((x, y) => (x.date + (x.de ?? "")).localeCompare(y.date + (y.de ?? "")));
}

export const MAX_LISTED_ROUNDS = 5;

/** « • *Mardi 10 novembre* (11h30 – 13h) : Jarry — Orange, EDF » */
export function formatRound(r: DeliveryRound): string {
  const when = r.de && r.a ? ` (${formatHour(r.de)} – ${formatHour(r.a)})` : r.de ? ` (à partir de ${formatHour(r.de)})` : "";
  return `• *${capitalize(formatDateFr(r.date))}*${when} : ${r.lieux.trim()}`;
}

export const NO_ROUND_TEXT = "Aucune tournée de livraison n'est prévue pour le moment.";

/** Fiche d'infos sans les tournées passées : c'est elle que reçoit l'IA. */
export function withUpcomingRounds(sheet: InfoSheet, now: Date, timezone: string): InfoSheet {
  if (!sheet.tournees?.length) return sheet;
  return { ...sheet, tournees: upcomingRounds(sheet.tournees, now, timezone) };
}

export function formatServiceModes(sheet: Pick<InfoSheet, "livraison" | "retrait">): string {
  if (sheet.livraison && sheet.retrait) return "Livraison et retrait sur place";
  if (sheet.livraison) return "Livraison uniquement";
  if (sheet.retrait) return "Retrait sur place uniquement";
  return "";
}

/** « mardi, mercredi et vendredi », « tous les jours », « du lundi au vendredi ». */
export function formatWeekdays(jours: IsoWeekday[]): string {
  const days = [...new Set(jours)].sort((a, b) => a - b);
  if (days.length === 7) return "tous les jours";
  const consecutive = days.length >= 3 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (consecutive) return `du ${WEEKDAY_LABELS[days[0]]} au ${WEEKDAY_LABELS[days[days.length - 1]]}`;
  return joinFr(days.map((d) => WEEKDAY_LABELS[d]));
}

/** Jours fixes réellement renseignés (zone nommée, au moins un jour). */
export function fixedDeliveryDays(sheet: Pick<InfoSheet, "livraison" | "joursLivraison">): DeliveryDays[] {
  if (!sheet.livraison) return [];
  return (sheet.joursLivraison ?? []).filter((d) => d.zone.trim() && d.jours.length);
}

const zoneKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Jours fixes par zone, complétés par les infos de la zone quand elle existe dans le texte des zones
 * (« • Jarry : livraison offerte ») : « • *Jarry* : mardi, mercredi et vendredi (livraison offerte) ».
 * Les zones sans jours fixes suivent, telles quelles.
 */
export function formatFixedDelivery(days: DeliveryDays[], zonesText = ""): string {
  const zoneLines = zonesText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^[•\-*]\s*([^:]+?)\s*:\s*(.+)$/.exec(line);
      return { line, key: m ? zoneKey(m[1].replace(/\*/g, "")) : null, details: m?.[2].trim() };
    });
  const used = new Set<string>();
  const lines = days.map((d) => {
    const key = zoneKey(d.zone);
    const zone = zoneLines.find((z) => z.key === key);
    if (zone) used.add(zone.line);
    const extra = [d.note?.trim(), zone?.details].filter(Boolean).join(", ");
    return `• *${d.zone.trim()}* : ${formatWeekdays(d.jours)}${extra ? ` (${extra})` : ""}`;
  });
  for (const z of zoneLines) if (!used.has(z.line)) lines.push(z.line);
  return lines.join("\n");
}

export const EXCEPTIONAL_ROUNDS_TITLE = "📅 *Livraisons exceptionnelles*";

export interface InfoVariables {
  horaires: string;
  horaires_du_jour: string;
  adresse: string;
  modes_service: string;
  zones_livraison: string;
  /** Jours fixes par zone (vide s'il n'y en a pas). */
  jours_livraison: string;
  prochaines_livraisons: string;
  infos_livraison: string;
  points_de_vente: string;
  modes_paiement: string;
  infos_pratiques: string;
}

/**
 * Livraison sur planning : mode choisi dans la fiche, ou passage automatique dès qu'il existe des
 * tournées à venir (elles priment alors sur les zones).
 */
export function isPlanningDelivery(sheet: Pick<InfoSheet, "livraison" | "livraisonMode">, upcomingCount: number): boolean {
  return Boolean(sheet.livraison) && (sheet.livraisonMode === "planning" || upcomingCount > 0);
}

export function infoSheetVariables(sheet: InfoSheet, now: Date, timezone: string): InfoVariables {
  const horaires = formatWeeklyHours(sheet);
  const upcoming = upcomingRounds(sheet.tournees, now, timezone);
  const fixed = fixedDeliveryDays(sheet);
  const zonesText = sheet.zonesLivraison?.trim() ?? "";
  let zones: string;
  let joursLivraison = "";
  let prochaines: string;
  let infosLivraison: string;
  let planning = false;
  if (fixed.length) {
    // Jours fixes : toujours annoncés (jamais « aucune tournée ») ; les tournées datées s'ajoutent.
    joursLivraison = formatFixedDelivery(fixed, zonesText);
    zones = zonesText;
    const rounds = upcoming.slice(0, MAX_LISTED_ROUNDS);
    prochaines = rounds.map(formatRound).join("\n");
    infosLivraison = prochaines ? `${joursLivraison}\n\n${EXCEPTIONAL_ROUNDS_TITLE}\n${prochaines}` : joursLivraison;
  } else {
    planning = isPlanningDelivery(sheet, upcoming.length);
    const rounds = planning ? upcoming.slice(0, MAX_LISTED_ROUNDS) : [];
    prochaines = planning ? (rounds.length ? rounds.map(formatRound).join("\n") : NO_ROUND_TEXT) : "";
    // En mode planning, un ancien texte de zones resté dans la fiche ne doit jamais ressortir.
    zones = sheet.livraison && !planning ? zonesText : "";
    infosLivraison = !sheet.livraison ? "" : planning ? prochaines : zones;
  }
  const adresse = sheet.adresse?.trim() ?? "";
  const pointsDeVente = sheet.pointsDeVente?.trim() ?? "";
  const paiement = sheet.modesPaiement?.trim() ?? "";

  const parts: string[] = [];
  if (horaires) parts.push(`🕒 *Horaires*\n${horaires}`);
  if (adresse) parts.push(`📍 *Adresse*\n${adresse}`);
  if (infosLivraison) parts.push(`${planning ? "🛵 *Prochaines livraisons*" : "🛵 *Livraison*"}\n${infosLivraison}`);
  if (pointsDeVente) parts.push(`🏪 *Points de vente*\n${pointsDeVente}`);
  if (paiement) parts.push(`💳 *Paiement*\n${paiement}`);

  return {
    horaires,
    horaires_du_jour: sheet.horaires.length ? formatTodayHours(sheet, now, timezone) : "",
    adresse,
    modes_service: formatServiceModes(sheet),
    zones_livraison: zones,
    jours_livraison: joursLivraison,
    prochaines_livraisons: prochaines,
    infos_livraison: infosLivraison,
    points_de_vente: pointsDeVente,
    modes_paiement: paiement,
    infos_pratiques: parts.join("\n\n"),
  };
}
