/** Horloge du simulateur, dans le fuseau du client. */
import { localTime } from "@/engine";

/** « 2026-11-03 » + « 12:00 » à l'heure du fuseau → instant UTC. */
export function zonedToUtc(date: string, time: string, timezone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  // Deux passes suffisent (le décalage peut changer à l'heure d'été).
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const t = localTime(new Date(guess), timezone);
    const [ly, lm, ld] = t.date.split("-").map(Number);
    const shown = Date.UTC(ly, lm - 1, ld, Math.floor(t.minutes / 60), t.minutes % 60);
    guess += wanted - shown;
  }
  return new Date(guess);
}

/** « mardi 3 novembre, 12:00 » */
export function formatLocal(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: timezone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(now);
}

/** « 12:00 » ou « mer. 4 nov., 12:00 » si ce n'est pas le même jour que `ref`. */
export function formatShort(at: Date, timezone: string, ref?: Date): string {
  const sameDay = ref && localTime(at, timezone).date === localTime(ref, timezone).date;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    ...(sameDay ? {} : { weekday: "short", day: "numeric", month: "short" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

export const ADVANCES: { label: string; minutes: number; hint?: string }[] = [
  { label: "+5 min", minutes: 5 },
  { label: "+31 min", minutes: 31, hint: "expiration de session" },
  { label: "+1 h", minutes: 60 },
  { label: "+13 h", minutes: 13 * 60, hint: "fin de pause du gérant" },
  { label: "+25 h", minutes: 25 * 60, hint: "fermeture de la fenêtre de 24 h" },
];
