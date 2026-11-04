/**
 * Durée de conservation des données personnelles (plan.md, décision 6 ; docs/securite.md).
 * PRÉPARÉ, NON ACTIVÉ : rien n'appelle runRetention. Pour l'activer plus tard (décision de Jules) :
 * une tâche planifiée (Vercel Cron) qui appelle runRetention avec PURGE_ACTIVE=oui.
 */
import type { ChannelStore } from "./types";

/** Messages des conversations : 12 mois. */
export const MESSAGES_RETENTION_MONTHS = 12;

export function retentionCutoff(now: Date, months = MESSAGES_RETENTION_MONTHS): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

export interface RetentionReport {
  active: boolean;
  cutoff: string;
  messagesSupprimes: number;
}

/** Sans PURGE_ACTIVE=oui, ne supprime rien et indique seulement la date limite. */
export async function runRetention(store: ChannelStore, now: Date, active = process.env.PURGE_ACTIVE?.trim() === "oui"): Promise<RetentionReport> {
  const cutoff = retentionCutoff(now);
  if (!active) return { active: false, cutoff: cutoff.toISOString(), messagesSupprimes: 0 };
  return { active: true, cutoff: cutoff.toISOString(), messagesSupprimes: await store.purgeMessagesBefore(cutoff) };
}
