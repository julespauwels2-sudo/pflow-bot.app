/** Historique annuler / rétablir, générique et sans dépendance. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Pour regrouper les frappes successives dans un même champ en une seule étape. */
  lastKey?: string;
  lastAt?: number;
}

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1000;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/**
 * Enregistre un nouvel état. Deux modifications avec la même `key` à moins
 * d'une seconde d'intervalle (ex. frappe dans un champ) ne forment qu'une étape.
 */
export function record<T>(h: History<T>, next: T, key?: string, now = Date.now()): History<T> {
  const coalesce = key !== undefined && key === h.lastKey && h.lastAt !== undefined && now - h.lastAt < COALESCE_MS;
  if (coalesce) return { ...h, present: next, future: [], lastAt: now };
  const past = [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  const previous = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  const [next, ...future] = h.future;
  return { past: [...h.past, h.present], present: next, future };
}
