/**
 * Transcription des messages vocaux : une interface, plusieurs services interchangeables.
 * Inactive tant que TRANSCRIPTION_API_KEY n'est pas définie (le bot répond alors comme aujourd'hui :
 * « je ne peux lire que les messages écrits »).
 *
 * Réglages (variables d'environnement, jamais dans le code) :
 * - TRANSCRIPTION_PROVIDER : openai | mistral | deepgram (aucun choisi par défaut : voir docs/journal.md) ;
 * - TRANSCRIPTION_API_KEY : clé du service ;
 * - TRANSCRIPTION_MODEL : facultatif (sinon le modèle indiqué ci-dessous) ;
 * - TRANSCRIPTION_BASE : facultatif, pour un faux serveur de test.
 * Formats d'appel à revérifier dans la documentation de chaque service au moment du choix.
 */

export interface Transcriber {
  readonly provider: TranscriptionProvider;
  /** Texte du message vocal, en français (le créole est envoyé tel quel, le service fait au mieux). */
  transcribe(audio: Uint8Array, mimeType: string): Promise<string>;
}

export type TranscriptionProvider = "openai" | "mistral" | "deepgram";

export interface TranscriberConfig {
  provider: TranscriptionProvider;
  apiKey: string;
  model?: string;
  base?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class TranscriptionError extends Error {}

const DEFAULTS: Record<TranscriptionProvider, { base: string; model: string }> = {
  openai: { base: "https://api.openai.com", model: "gpt-4o-mini-transcribe" },
  mistral: { base: "https://api.mistral.ai", model: "voxtral-mini-latest" },
  deepgram: { base: "https://api.deepgram.com", model: "nova-3" },
};

/** Plafond d'un message vocal téléchargé (≈ 10 minutes en Opus). */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const extension = (mimeType: string) => {
  const t = mimeType.split(";")[0].trim().toLowerCase();
  return { "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr", "video/mp4": "mp4", "audio/wav": "wav", "audio/webm": "webm" }[t] ?? "ogg";
};

export function createTranscriber(config: TranscriberConfig): Transcriber {
  const doFetch = config.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const defaults = DEFAULTS[config.provider];
  const base = (config.base || defaults.base).replace(/\/$/, "");
  const model = config.model || defaults.model;

  async function call(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 20_000);
    try {
      const response = await doFetch(url, { ...init, signal: controller.signal });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new TranscriptionError(`Transcription refusée (${config.provider}, ${response.status})`);
      return json;
    } catch (error) {
      if (error instanceof TranscriptionError) throw error;
      throw new TranscriptionError(`Service de transcription injoignable (${config.provider}) : ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    provider: config.provider,
    async transcribe(audio, mimeType) {
      if (audio.byteLength > MAX_AUDIO_BYTES) throw new TranscriptionError("Message vocal trop long");
      if (config.provider === "deepgram") {
        const json = await call(`${base}/v1/listen?model=${encodeURIComponent(model)}&language=fr&smart_format=true`, {
          method: "POST",
          headers: { authorization: `Token ${config.apiKey}`, "content-type": mimeType || "audio/ogg" },
          body: audio as unknown as BodyInit,
        });
        const results = (json.results ?? {}) as { channels?: { alternatives?: { transcript?: string }[] }[] };
        return (results.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
      }
      // OpenAI et Mistral : même format (formulaire avec le fichier).
      const form = new FormData();
      form.append("file", new Blob([audio as unknown as BlobPart], { type: mimeType || "audio/ogg" }), `vocal.${extension(mimeType)}`);
      form.append("model", model);
      form.append("language", "fr");
      const json = await call(`${base}/v1/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${config.apiKey}` }, body: form });
      return (typeof json.text === "string" ? json.text : "").trim();
    },
  };
}

const env = (name: string) => process.env[name]?.trim() || "";
const PROVIDERS: TranscriptionProvider[] = ["openai", "mistral", "deepgram"];

/** État des réglages, pour la page « État du système » (jamais la clé elle-même). */
export function transcriptionStatus(): { active: boolean; provider?: TranscriptionProvider; missing: string[] } {
  const provider = env("TRANSCRIPTION_PROVIDER") as TranscriptionProvider;
  const missing = [
    ...(PROVIDERS.includes(provider) ? [] : ["TRANSCRIPTION_PROVIDER (openai, mistral ou deepgram)"]),
    ...(env("TRANSCRIPTION_API_KEY") ? [] : ["TRANSCRIPTION_API_KEY"]),
  ];
  return { active: missing.length === 0, ...(PROVIDERS.includes(provider) ? { provider } : {}), missing };
}

/** Service configuré par les variables d'environnement, ou null (transcription inactive). */
export function transcriberFromEnv(): Transcriber | null {
  const status = transcriptionStatus();
  if (!status.active || !status.provider) return null;
  return createTranscriber({
    provider: status.provider,
    apiKey: env("TRANSCRIPTION_API_KEY"),
    model: env("TRANSCRIPTION_MODEL") || undefined,
    base: env("TRANSCRIPTION_BASE") || undefined,
  });
}
