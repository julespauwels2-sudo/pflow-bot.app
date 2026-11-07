/**
 * Durées de conservation promises par la politique de confidentialité (pflow.fr/confidentialite, § 10) :
 * - conversations avec les assistants (messages, transcriptions, transferts, historique IA des sessions)
 *   et messages transmis à l'IA (bot_appels_ia) : 12 mois, puis suppression ;
 * - journal technique des notifications reçues (bot_webhook_evenements) : 30 jours.
 * Lancée chaque jour par Vercel Cron (route /api/cron/purge, vercel.json). Uniquement des tables bot_.
 * Interrupteur d'urgence : PURGE_ACTIVE=non dans Vercel suspend la suppression (la page État le signale).
 */
import type { ChannelStore, PurgeCounts } from "./types";

/** Conversations et appels à l'IA : 12 mois. */
export const MESSAGES_RETENTION_MONTHS = 12;
/** Journal technique des notifications reçues : 30 jours. */
export const EVENTS_RETENTION_DAYS = 30;

export function retentionCutoff(now: Date, months = MESSAGES_RETENTION_MONTHS): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

export function eventsCutoff(now: Date, days = EVENTS_RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/** Active sauf si PURGE_ACTIVE=non (interrupteur d'urgence). */
export const purgeEnabled = () => process.env.PURGE_ACTIVE?.trim().toLowerCase() !== "non";

export interface RetentionReport {
  active: boolean;
  /** Date limite des conversations (12 mois). */
  cutoff: string;
  /** Date limite du journal technique (30 jours). */
  eventsCutoff: string;
  supprimes: PurgeCounts;
}

const NONE: PurgeCounts = { messages: 0, transferts: 0, sessions: 0, appelsIa: 0, evenements: 0 };

export async function runRetention(store: ChannelStore, now: Date, active = purgeEnabled()): Promise<RetentionReport> {
  const cutoffs = { conversations: retentionCutoff(now), evenements: eventsCutoff(now) };
  const base = { active, cutoff: cutoffs.conversations.toISOString(), eventsCutoff: cutoffs.evenements.toISOString() };
  if (!active) return { ...base, supprimes: NONE };
  return { ...base, supprimes: await store.purgeOlderThan(cutoffs) };
}
