/**
 * Appel à Claude (côté serveur uniquement : la clé API ne quitte jamais le serveur).
 * Le client Anthropic est injecté pour pouvoir tester sans réseau.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { AiRequest, AiResult } from "@/engine";
import { costUsd, DEFAULT_AI_MODEL } from "./models";
import { buildPrompt, decisionJsonSchema } from "./prompt";
import { aiDecisionSchema } from "./schemas";

/** Une réponse WhatsApp tient largement dans cette limite. */
export const AI_MAX_OUTPUT_TOKENS = 1024;

type MessageParams = Anthropic.MessageCreateParamsNonStreaming;

/**
 * Pas de réflexion préalable : la décision est simple et le client attend sur WhatsApp.
 * Chaque modèle a sa façon de la couper ; pour un modèle inconnu, on laisse son réglage par défaut.
 */
function thinkingFor(model: string): MessageParams["thinking"] | undefined {
  if (model.startsWith("claude-haiku-5")) return { type: "disabled" };
  if (model.startsWith("claude-sonnet-5")) return { type: "between_tools" };
  return undefined;
}

export class AiRefusalError extends Error {}

export function buildClaudeParams(req: AiRequest, model: string): MessageParams {
  const prompt = buildPrompt(req);
  const thinking = thinkingFor(model);
  return {
    model,
    max_tokens: AI_MAX_OUTPUT_TOKENS,
    system: prompt.system.map((block) => ({
      type: "text" as const,
      text: block.text,
      ...(block.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
    })),
    messages: prompt.messages,
    output_config: { format: { type: "json_schema", schema: decisionJsonSchema(req.functions.map((f) => f.name)) } },
    ...(thinking ? { thinking } : {}),
  };
}

export async function askClaude(client: Pick<Anthropic, "messages">, req: AiRequest, defaultModel = DEFAULT_AI_MODEL): Promise<AiResult> {
  const model = req.model?.trim() || defaultModel;
  const response = await client.messages.create(buildClaudeParams(req, model));

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  };
  if (response.stop_reason === "refusal") throw new AiRefusalError("Claude a refusé de répondre à ce message");
  if (response.stop_reason === "max_tokens") throw new Error("Réponse de l'IA trop longue (coupée)");

  const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Réponse de l'IA illisible (JSON invalide)");
  }
  const parsed = aiDecisionSchema.safeParse(json);
  if (!parsed.success) throw new Error("Réponse de l'IA au mauvais format");

  const { action, fonction, texte } = parsed.data;
  return {
    decision: { action, ...(fonction ? { fonction } : {}), texte },
    usage,
    model: response.model || model,
    costUsd: costUsd(model, usage),
  };
}
