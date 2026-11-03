/**
 * Variables tirées de la fiche d'infos du client ({{horaires}}, {{infos_livraison}}…),
 * calculées dans le fuseau du client. Utilisées par le moteur et par l'aperçu de l'éditeur.
 */
import { WEEKDAY_LABELS, localTime, parseHhmm } from "./time";
import type { DeliveryRound, InfoSheet, IsoWeekday, TimeRange } from "./types";

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

export interface InfoVariables {
  horaires: string;
  horaires_du_jour: string;
  adresse: string;
  modes_service: string;
  zones_livraison: string;
  prochaines_livraisons: string;
  infos_livraison: string;
  points_de_vente: string;
  modes_paiement: string;
  infos_pratiques: string;
}

export function infoSheetVariables(sheet: InfoSheet, now: Date, timezone: string): InfoVariables {
  const horaires = formatWeeklyHours(sheet);
  const planning = sheet.livraison && sheet.livraisonMode === "planning";
  const rounds = planning ? upcomingRounds(sheet.tournees, now, timezone).slice(0, MAX_LISTED_ROUNDS) : [];
  const prochaines = planning ? (rounds.length ? rounds.map(formatRound).join("\n") : NO_ROUND_TEXT) : "";
  // En mode planning, un ancien texte de zones resté dans la fiche ne doit jamais ressortir.
  const zones = sheet.livraison && !planning ? (sheet.zonesLivraison?.trim() ?? "") : "";
  const infosLivraison = !sheet.livraison ? "" : planning ? prochaines : zones;
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
    prochaines_livraisons: prochaines,
    infos_livraison: infosLivraison,
    points_de_vente: pointsDeVente,
    modes_paiement: paiement,
    infos_pratiques: parts.join("\n\n"),
  };
}
