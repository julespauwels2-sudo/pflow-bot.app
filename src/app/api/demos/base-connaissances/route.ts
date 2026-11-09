/**
 * Base de connaissances du bot PFlow Démo (src/demos/demo-knowledge.ts), réservée aux administrateurs :
 * GET la base (celle par défaut tant qu'elle n'a pas été enregistrée), PUT pour l'enregistrer.
 * Rangée dans bot_fiches sous un identifiant fixe (hors CRM) : aucun SQL à jouer.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getChannelsRuntime } from "@/channels/core/runtime";
import { DEFAULT_DEMO_KNOWLEDGE } from "@/demos/demo-knowledge";
import { tooManyRequests } from "@/lib/request-limit";
import { checkBotAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ faq: z.string().max(8000), regles: z.string().max(4000) });

async function access(request: Request, max: number) {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return { error: NextResponse.json({ error: caller.error }, { status: caller.status }) };
  const limited = tooManyRequests("demo-base", request, caller.userId, max);
  if (limited) return { error: limited };
  try {
    return { store: (await getChannelsRuntime()).store };
  } catch (error) {
    return { error: NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }) };
  }
}

export async function GET(request: Request) {
  const a = await access(request, 60);
  if ("error" in a) return a.error;
  const saved = await a.store.getDemoKnowledge().catch(() => null);
  return NextResponse.json({ ...(saved ?? DEFAULT_DEMO_KNOWLEDGE), parDefaut: !saved, iaActive: Boolean(process.env.ANTHROPIC_API_KEY?.trim()) }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const a = await access(request, 20);
  if ("error" in a) return a.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Base invalide (texte trop long ?)." }, { status: 400 });
  await a.store.saveDemoKnowledge({ faq: parsed.data.faq.trim(), regles: parsed.data.regles.trim() });
  return NextResponse.json({ ok: true });
}
