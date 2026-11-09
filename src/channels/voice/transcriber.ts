/**
 * Transcription des messages vocaux : une interface, plusieurs services interchangeables.
 * Inactive tant que TRANSCRIPTION_API_KEY n'est pas définie (le bot répond alors comme aujourd'hui :
 * « je ne peux lire que les messages écrits »).
 *
 * Réglages (variables d'environnement, jamais dans le code) :
 * - TRANSCRIPTION_API_KEY : clé du service (la seule variable obligatoire) ;
 * - TRANSCRIPTION_PROVIDER : groq (par défaut, retenu le 9 novembre 2026 : docs/etape-c/vocaux.md) | openai |
 *   mistral | deepgram ;
 * - TRANSCRIPTION_MODEL : facultatif (sinon le modèle indiqué ci-dessous) ;
 * - TRANSCRIPTION_BASE : facultatif, pour un faux serveur de test.
 * Formats d'appel à revérifier dans la documentation de chaque service au moment du choix.
 */

export interface Transcriber {
  readonly provider: TranscriptionProvider;
  /** Texte du message vocal, en français (le créole est envoyé tel quel, le service fait au mieux). */
  transcribe(audio: Uint8Array, mimeType: string): Promise<string>;
}

export type TranscriptionProvider = "groq" | "openai" | "mistral" | "deepgram";

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
  // Groq : API au format OpenAI, sous /openai/v1/audio/transcriptions.
  groq: { base: "https://api.groq.com/openai", model: "whisper-large-v3-turbo" },
  openai: { base: "https://api.openai.com", model: "gpt-4o-mini-transcribe" },
  mistral: { base: "https://api.mistral.ai", model: "voxtral-mini-latest" },
  deepgram: { base: "https://api.deepgram.com", model: "nova-3" },
};

/**
 * Indication de vocabulaire (modèles Whisper : Groq, OpenAI) : contexte guadeloupéen, mots de la commande. Elle aide
 * pour les noms de lieux et les phrases mêlées de créole ; elle ne traduit pas le créole.
 */
export const VOCABULARY_HINT = "Guadeloupe, Baie-Mahault, Pointe-à-Pitre, Le Gosier, Jarry. Commande, livraison, retrait, menu, burger, bokit, accras, colombo. Créole guadeloupéen possible.";

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
      // Groq, OpenAI et Mistral : même format (formulaire avec le fichier).
      const form = new FormData();
      form.append("file", new Blob([audio as unknown as BlobPart], { type: mimeType || "audio/ogg" }), `vocal.${extension(mimeType)}`);
      form.append("model", model);
      form.append("language", "fr");
      if (config.provider === "groq" || config.provider === "openai") {
        form.append("prompt", VOCABULARY_HINT);
        form.append("temperature", "0");
      }
      const json = await call(`${base}/v1/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${config.apiKey}` }, body: form });
      return (typeof json.text === "string" ? json.text : "").trim();
    },
  };
}

const env = (name: string) => process.env[name]?.trim() || "";
const PROVIDERS: TranscriptionProvider[] = ["groq", "openai", "mistral", "deepgram"];

/** État des réglages, pour la page « État du système » (jamais la clé elle-même). Groq par défaut. */
export function transcriptionStatus(): { active: boolean; provider?: TranscriptionProvider; missing: string[] } {
  const provider = (env("TRANSCRIPTION_PROVIDER").toLowerCase() || "groq") as TranscriptionProvider;
  const missing = [
    ...(PROVIDERS.includes(provider) ? [] : ["TRANSCRIPTION_PROVIDER (groq, openai, mistral ou deepgram)"]),
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

/** Limites des vocaux (variables facultatives). */
export interface VoiceLimits {
  /** Durée maximale transcrite ; au-delà, le bot demande d'écrire. */
  maxSeconds: number;
  /** Vocaux transcrits au plus par contact sur 24 h glissantes ; au-delà, le bot demande d'écrire. */
  maxPerDay: number;
}

export const DEFAULT_VOICE_LIMITS: VoiceLimits = { maxSeconds: 120, maxPerDay: 10 };

export function voiceLimitsFromEnv(): VoiceLimits {
  const num = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(env(name));
    return Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : fallback;
  };
  return {
    maxSeconds: num("TRANSCRIPTION_MAX_SECONDES", DEFAULT_VOICE_LIMITS.maxSeconds, 10, 600),
    maxPerDay: num("TRANSCRIPTION_MAX_PAR_JOUR", DEFAULT_VOICE_LIMITS.maxPerDay, 1, 100),
  };
}
