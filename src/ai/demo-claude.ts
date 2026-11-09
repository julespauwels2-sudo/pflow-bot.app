/**
 * Claude pour les réponses du numéro PFlow Démo (src/demos/demo-knowledge.ts) : une réponse JSON
 * { statut, reponse } contrainte par un schéma, à partir de la base de connaissances seulement.
 * Côté serveur uniquement : la clé API ne quitte jamais le serveur. Client injecté pour les tests.
 */
import Anthropic from "@anthropic-ai/sdk";
import { DEMO_ANSWER_SCHEMA, type DemoCompletion } from "@/demos/demo-knowledge";
import { serverModel } from "./server-port";

type MessageParams = Anthropic.MessageCreateParamsNonStreaming;

export function demoAnswerParams(model: string, input: { system: string; question: string }): MessageParams {
  return {
    model,
    max_tokens: 400,
    // La base change rarement : mise en cache du prompt système (moins cher, plus rapide).
    system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: input.question }],
    output_config: { format: { type: "json_schema", schema: DEMO_ANSWER_SCHEMA as unknown as Record<string, unknown> } },
    ...(model.startsWith("claude-haiku-5") ? { thinking: { type: "disabled" as const } } : {}),
  };
}

export function createDemoCompletion(client: Pick<Anthropic, "messages">, model = serverModel()): DemoCompletion {
  return async (input) => {
    const response = await client.messages.create(demoAnswerParams(model, input));
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return JSON.stringify({ statut: "inconnu", reponse: "" });
    return response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  };
}

/** Absent sans ANTHROPIC_API_KEY : le bot passe alors la main à Jules pour toute question (comme avant). */
export function demoCompletionFromEnv(): DemoCompletion | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return undefined;
  return createDemoCompletion(new Anthropic({ apiKey, timeout: 15_000, maxRetries: 1 }));
}
