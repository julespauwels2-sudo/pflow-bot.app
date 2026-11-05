/**
 * Démos sur le numéro PFlow : mots-clés (normalisés, uniques), durée, adresse de la page de commande
 * de démonstration du CRM. Fonctions pures, partagées par le serveur, le navigateur et le simulateur.
 */

import { normalize } from "@/engine/match";

/** Durée d'une démo par défaut (jours), réglable démo par démo. */
export const DEFAULT_DEMO_DAYS = 5;
export const MAX_DEMO_DAYS = 60;

/**
 * Page de commande de DÉMONSTRATION du CRM (order.pflow.fr/demo/commande?d=<code>) : la vraie page de
 * commande, servie en mémoire avec la carte de la démo. Rien n'est écrit en base, aucun message ne part.
 */
export const DEMO_ORDER_BASE_URL = "https://order.pflow.fr/demo/commande";

export function demoOrderUrl(code: string | undefined): string | undefined {
  return code && /^[0-9a-f]{20}$/.test(code) ? `${DEMO_ORDER_BASE_URL}?d=${code}` : undefined;
}

/**
 * « Byron's Burger ! » → « byron s burger » : minuscules, sans accents ni ponctuation, espaces simples.
 * Même normalisation que les mots-clés du moteur.
 */
export function normalizeKeyword(text: string): string {
  return normalize(text);
}

/** Mot-clé libre (contrôles de forme) ; renvoie le texte nettoyé ou une erreur lisible. */
export function checkDemoKeyword(keyword: string): { ok: true; keyword: string } | { ok: false; error: string } {
  const clean = keyword.replace(/\s+/g, " ").trim();
  const normalized = normalizeKeyword(clean);
  if (!normalized) return { ok: false, error: "Mot-clé vide : écris par exemple le nom du resto." };
  if (normalized.length < 3) return { ok: false, error: "Mot-clé trop court (3 lettres au moins)." };
  if (clean.length > 40) return { ok: false, error: "Mot-clé trop long (40 caractères au plus)." };
  return { ok: true, keyword: clean };
}

/** Premier mot-clé libre : le nom, puis « nom 2 », « nom 3 »… */
export function uniqueKeyword(wanted: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(normalizeKeyword));
  const base = wanted.replace(/\s+/g, " ").trim().slice(0, 36) || "Démo";
  if (!used.has(normalizeKeyword(base))) return base;
  for (let i = 2; ; i++) if (!used.has(normalizeKeyword(`${base} ${i}`))) return `${base} ${i}`;
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}
