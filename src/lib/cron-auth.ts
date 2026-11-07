import { timingSafeEqual } from "node:crypto";

/** Vérifie l'en-tête envoyé par Vercel Cron (« Bearer <CRON_SECRET> »), en temps constant. */
export function cronAuthorized(header: string | null, secret: string | undefined): "allow" | "deny" | "not_configured" {
  const expected = secret?.trim();
  if (!expected) return "not_configured";
  const a = Buffer.from(header ?? "");
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b) ? "allow" : "deny";
}
