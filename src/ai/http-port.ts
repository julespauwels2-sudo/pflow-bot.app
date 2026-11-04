/** Port IA côté navigateur (simulateur) : passe par la route serveur /api/ai. */
import type { AiPort, AiResult } from "@/engine";

export function httpAiPort(
  endpoint = "/api/ai",
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  /** Jeton de la session Supabase (étape B), envoyé à la route serveur. */
  getToken: () => Promise<string | null> = async () => null,
): AiPort {
  return async (request) => {
    const token = await getToken();
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(request),
    });
    const body = (await response.json().catch(() => null)) as (AiResult & { error?: string }) | null;
    if (!response.ok || !body) throw new Error(body?.error ?? `Erreur ${response.status}`);
    return body;
  };
}

export interface AiStatus {
  configured: boolean;
  model: string;
}

/** La clé API est-elle configurée sur le serveur ? (la clé n'est jamais renvoyée) */
export async function fetchAiStatus(endpoint = "/api/ai"): Promise<AiStatus | null> {
  try {
    const response = await fetch(endpoint);
    return response.ok ? ((await response.json()) as AiStatus) : null;
  } catch {
    return null;
  }
}
