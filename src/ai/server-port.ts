/** Port IA côté serveur (webhook WhatsApp) : Claude appelé directement, sans passer par /api/ai. */
import Anthropic from "@anthropic-ai/sdk";
import type { AiPort } from "@/engine";
import { askClaude } from "./claude";
import { AI_MODELS, DEFAULT_AI_MODEL } from "./models";

export function serverModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_AI_MODEL;
}

/** Modèles acceptés : ceux proposés dans l'app, ou celui du serveur. */
export function allowedModel(requested: string | undefined): string {
  const allowed = new Set([...AI_MODELS.map((m) => m.id), serverModel()]);
  return requested && allowed.has(requested) ? requested : serverModel();
}

/** Absent sans ANTHROPIC_API_KEY (le moteur passe alors la main à l'équipe dans les blocs IA). */
export function serverAiPort(): AiPort | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return undefined;
  const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 1 });
  return (request) => askClaude(client, { ...request, model: allowedModel(request.model) }, serverModel());
}
