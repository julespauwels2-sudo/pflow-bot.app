/**
 * Route IA : reçoit une demande du moteur (simulateur aujourd'hui, webhook WhatsApp à l'étape C)
 * et interroge Claude. La clé ANTHROPIC_API_KEY reste côté serveur. Route réservée aux
 * administrateurs du bot (jeton Supabase), et au mot de passe provisoire s'il est défini (proxy).
 */
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { askClaude } from "@/ai/claude";
import { aiRequestSchema } from "@/ai/schemas";
import { allowedModel, serverModel } from "@/ai/server-port";
import { tooManyRequests } from "@/lib/request-limit";
import { checkBotAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** État de la configuration (jamais la clé elle-même). */
export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()), model: serverModel() });
}

export async function POST(request: Request) {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return fail(caller.error, caller.status);
  // Chaque appel coûte : 30 par minute et par compte suffisent largement au simulateur.
  const limited = tooManyRequests("ai", request, caller.userId, 30);
  if (limited) return limited;

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return fail("Clé API absente : ajoutez ANTHROPIC_API_KEY aux variables d'environnement (Vercel ou .env.local), puis redéployez.", 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Requête illisible", 400);
  }
  const parsed = aiRequestSchema.safeParse(body);
  if (!parsed.success) return fail(`Requête invalide : ${parsed.error.issues[0]?.message ?? "format"}`, 400);

  // Seuls les modèles proposés dans l'app (ou celui du serveur) sont acceptés.
  const req = parsed.data;
  const model = allowedModel(req.model);

  const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 1 });
  try {
    return NextResponse.json(await askClaude(client, { ...req, model }, serverModel()));
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return fail("Clé API refusée par Anthropic : vérifiez ANTHROPIC_API_KEY.", 502);
    if (error instanceof Anthropic.PermissionDeniedError) return fail("Cette clé API n'a pas accès à ce modèle.", 502);
    if (error instanceof Anthropic.NotFoundError) return fail(`Modèle inconnu chez Anthropic : ${model}.`, 502);
    if (error instanceof Anthropic.RateLimitError) return fail("Trop d'appels à l'IA en même temps : réessayez dans un instant.", 429);
    if (error instanceof Anthropic.APIConnectionTimeoutError) return fail("L'IA n'a pas répondu à temps.", 504);
    if (error instanceof Anthropic.APIError) return fail(`Erreur de l'API Claude (${error.status ?? "réseau"}) : ${error.message}`, 502);
    return fail(error instanceof Error ? error.message : String(error), 502);
  }
}
