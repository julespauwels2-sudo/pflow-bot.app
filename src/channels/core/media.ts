/** Téléchargement borné d'un média (message vocal) depuis Meta. */
import { MAX_AUDIO_BYTES } from "../voice/transcriber";

export class MediaError extends Error {}

/**
 * Adresse acceptée : https uniquement (ou l'adresse du faux serveur de test), jamais une adresse
 * locale arbitraire glissée dans une notification.
 */
export function allowedMediaUrl(url: string, testBase: string): boolean {
  if (testBase && url.startsWith(testBase.replace(/\/$/, "") + "/")) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/.test(u.hostname);
  } catch {
    return false;
  }
}

export async function fetchMedia(
  doFetch: typeof fetch,
  url: string,
  headers: Record<string, string>,
  fallbackType: string,
  timeoutMs = 15_000,
): Promise<{ data: Uint8Array; mimeType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new MediaError(`Média introuvable (${response.status})`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_AUDIO_BYTES) throw new MediaError("Message vocal trop long");
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > MAX_AUDIO_BYTES) throw new MediaError("Message vocal trop long");
    return { data, mimeType: response.headers.get("content-type")?.split(";")[0].trim() || fallbackType };
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError(`Téléchargement du média impossible : ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}
