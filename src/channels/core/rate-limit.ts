/**
 * Limite de débit simple en mémoire (fenêtre glissante). Protège une instance du serveur contre un
 * déluge d'appels ; sur Vercel, chaque instance a son propre compteur (protection partielle, voir
 * docs/securite.md).
 */
const hits = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 10_000) hits.clear();
  return true;
}
