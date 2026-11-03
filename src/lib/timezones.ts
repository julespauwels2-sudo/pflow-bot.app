import { DEFAULT_TIMEZONE, WEEKDAY_LABELS, localTime } from "@/engine";

export const TIMEZONES = [
  { value: DEFAULT_TIMEZONE, label: "Guadeloupe" },
  { value: "America/Martinique", label: "Martinique" },
  { value: "America/Cayenne", label: "Guyane" },
  { value: "America/Marigot", label: "Saint-Martin" },
  { value: "America/St_Barthelemy", label: "Saint-Barthélemy" },
  { value: "Indian/Reunion", label: "La Réunion" },
  { value: "Indian/Mayotte", label: "Mayotte" },
  { value: "Europe/Paris", label: "France métropolitaine" },
] as const;

export function timezoneLabel(timezone: string): string {
  return TIMEZONES.find((t) => t.value === timezone)?.label ?? timezone;
}

/** « mardi 12:03 » dans le fuseau donné. */
export function localClock(timezone: string, now = new Date()): string {
  const t = localTime(now, timezone);
  return `${WEEKDAY_LABELS[t.weekday]} ${t.hhmm}`;
}

/** « Chez Paul » → « chez-paul » */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
