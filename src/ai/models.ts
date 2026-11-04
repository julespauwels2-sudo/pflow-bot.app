/**
 * Modèles Claude proposés pour l'agent IA, et leur tarif (dollars par million de tokens).
 * Tarifs de novembre 2026 pour des prompts de 100 000 tokens ou moins (toujours notre cas).
 * Écriture en cache (durée 5 min) = 1,25 × l'entrée ; lecture du cache ≈ 0,1 × l'entrée.
 * À revérifier sur la page des tarifs d'Anthropic si un prix change.
 */
import type { AiUsage } from "@/engine";

export interface AiModelInfo {
  id: string;
  label: string;
  hint: string;
  /** $ / million de tokens. */
  price: { input: number; output: number; cacheWrite: number; cacheRead: number };
}

export const AI_MODELS: AiModelInfo[] = [
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5 (recommandé)",
    hint: "Rapide et très peu cher : environ 0,05 centime par réponse.",
    price: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    hint: "Plus fin pour les cas difficiles, environ 20 fois plus cher que Haiku.",
    price: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  },
];

export const DEFAULT_AI_MODEL = "claude-haiku-5-5";

export function modelInfo(id: string | undefined): AiModelInfo | undefined {
  return AI_MODELS.find((m) => m.id === id);
}

export function modelLabel(id: string | undefined): string {
  return modelInfo(id)?.label.replace(" (recommandé)", "") ?? id ?? "?";
}

/** Coût d'un appel en dollars, ou null si le tarif du modèle est inconnu. */
export function costUsd(model: string, usage: AiUsage): number | null {
  const info = modelInfo(model);
  if (!info) return null;
  const { input, output, cacheWrite, cacheRead } = info.price;
  return (
    (usage.inputTokens * input +
      usage.outputTokens * output +
      (usage.cacheWriteTokens ?? 0) * cacheWrite +
      (usage.cacheReadTokens ?? 0) * cacheRead) /
    1_000_000
  );
}

/** « 0,0004 $ » : assez de décimales pour voir un appel isolé. */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "coût inconnu";
  const digits = value === 0 ? 2 : value < 0.01 ? 4 : value < 1 ? 3 : 2;
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} $`;
}
