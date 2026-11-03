import type { OutgoingMessage } from "./types";

/** Bornes du délai (l'indicateur WhatsApp « en train d'écrire » dure au plus 25 s). */
export const DELAY_MIN_MS = 500;
export const DELAY_MAX_MS = 10_000;
export const DELAY_MAX_SECONDS = DELAY_MAX_MS / 1000;

/**
 * Délai intelligent : le temps qu'un humain mettrait à taper le message.
 * 0,8 s de base + 35 ms par caractère, entre 1 s et 5 s.
 */
export function smartDelayMs(text: string): number {
  const chars = [...text].length;
  return Math.round(Math.min(5000, Math.max(1000, 800 + chars * 35)));
}

export function fixedDelayMs(seconds: number | undefined): number {
  const ms = Math.round((seconds ?? 2) * 1000);
  return Math.min(DELAY_MAX_MS, Math.max(DELAY_MIN_MS, ms));
}

/** Texte du message qui suit, pour calculer un délai intelligent. */
export function textOf(message: OutgoingMessage | undefined): string {
  if (!message || message.kind === "typing") return "";
  return message.text;
}
