import type { IsoWeekday, OpeningDay } from "./types";

export interface LocalTime {
  /** "YYYY-MM-DD" dans le fuseau donné. */
  date: string;
  weekday: IsoWeekday;
  /** Minutes depuis minuit. */
  minutes: number;
  /** "HH:MM" */
  hhmm: string;
}

const WEEKDAYS: Record<string, IsoWeekday> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export const WEEKDAY_LABELS: Record<IsoWeekday, string> = {
  1: "lundi",
  2: "mardi",
  3: "mercredi",
  4: "jeudi",
  5: "vendredi",
  6: "samedi",
  7: "dimanche",
};

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Date, jour et heure locaux pour un instant donné dans un fuseau IANA. */
export function localTime(now: Date, timezone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: WEEKDAYS[get("weekday")],
    minutes: hour * 60 + minute,
    hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

/** "HH:MM" → minutes depuis minuit, ou null si le format est invalide. */
export function parseHhmm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** Vrai si `minutes` est dans [de, a[. Une plage où a < de passe minuit. */
export function inRange(minutes: number, de: string, a: string): boolean {
  const start = parseHhmm(de);
  const end = parseHhmm(a);
  if (start === null || end === null) return false;
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

function previousDay(day: IsoWeekday): IsoWeekday {
  return (day === 1 ? 7 : day - 1) as IsoWeekday;
}

/** Ouvert à cet instant d'après les horaires (plages passant minuit comprises). */
export function isOpenAt(horaires: OpeningDay[], now: Date, timezone: string): boolean {
  const t = localTime(now, timezone);
  for (const day of horaires) {
    for (const plage of day.plages) {
      const start = parseHhmm(plage.de);
      const end = parseHhmm(plage.a);
      if (start === null || end === null || start === end) continue;
      if (start < end) {
        if (day.jour === t.weekday && t.minutes >= start && t.minutes < end) return true;
      } else {
        // Plage de nuit, ex. vendredi 18:00 → 02:00.
        if (day.jour === t.weekday && t.minutes >= start) return true;
        if (day.jour === previousDay(t.weekday) && t.minutes < end) return true;
      }
    }
  }
  return false;
}

/** Horaires en texte lisible, pour l'IA (« lundi : fermé », « samedi : 11:00-14:00, 18:00-22:00 »). */
export function formatOpeningHours(horaires: OpeningDay[]): string {
  return ([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[])
    .map((jour) => {
      const plages = horaires.filter((d) => d.jour === jour).flatMap((d) => d.plages);
      const label = WEEKDAY_LABELS[jour];
      if (plages.length === 0) return `${label} : fermé`;
      return `${label} : ${plages.map((p) => `${p.de}-${p.a}`).join(", ")}`;
    })
    .join("\n");
}
