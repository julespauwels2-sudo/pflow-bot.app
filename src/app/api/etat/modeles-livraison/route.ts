/**
 * Les 10 modèles WhatsApp de la livraison sur un compte WhatsApp Business déjà relié à PFlow Bots (par défaut : le
 * compte commun de Jules, celui de ses numéros). Administrateurs du bot seulement ; jeton général de PFlow
 * (WHATSAPP_TOKEN, jamais renvoyé).
 * - GET ?waba=<id> : statut de chacun chez Meta (APPROVED, PENDING, REJECTED…, ou absent) ;
 * - POST { wabaId } : crée les manquants et les soumet à l'examen de Meta. Un modèle existant n'est jamais modifié.
 * Seuls les comptes des canaux connus sont acceptés.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getChannelsRuntime, readWhatsAppConfig } from "@/channels/core/runtime";
import { modelesLivraison } from "@/channels/whatsapp/embedded-signup";
import { tooManyRequests } from "@/lib/request-limit";
import { checkBotAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function preparer(request: Request, max: number) {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return { error: NextResponse.json({ error: caller.error }, { status: caller.status }) };
  const limited = tooManyRequests("modeles-livraison", request, caller.userId, max);
  if (limited) return { error: limited };
  const wa = readWhatsAppConfig();
  if (!wa.ready) return { error: NextResponse.json({ error: `WhatsApp non configuré : ${wa.missing.join(", ")}` }, { status: 503 }) };
  const rt = await getChannelsRuntime();
  const comptes = [...new Set((await rt.store.listCanaux()).filter((c) => c.plateforme === "whatsapp" && c.wabaId).map((c) => c.wabaId!))];
  return { wa, comptes };
}

const corps = z.object({ wabaId: z.string().regex(/^\d{5,30}$/) });

export async function GET(request: Request) {
  const p = await preparer(request, 30);
  if ("error" in p && p.error) return p.error;
  const { wa, comptes } = p as Exclude<typeof p, { error: NextResponse }>;
  const waba = new URL(request.url).searchParams.get("waba") || comptes[0];
  if (!waba || !comptes.includes(waba)) return NextResponse.json({ comptes, etat: [] });
  try {
    const r = await modelesLivraison({ base: wa.graphBase, version: wa.graphVersion }, waba, wa.token, false);
    return NextResponse.json({ comptes, wabaId: waba, ...r }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ comptes, wabaId: waba, error: `Lecture chez Meta impossible : ${(error as Error).message}` }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const p = await preparer(request, 5);
  if ("error" in p && p.error) return p.error;
  const { wa, comptes } = p as Exclude<typeof p, { error: NextResponse }>;
  const parsed = corps.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !comptes.includes(parsed.data.wabaId)) return NextResponse.json({ error: "Compte WhatsApp inconnu de PFlow Bots" }, { status: 400 });
  try {
    const r = await modelesLivraison({ base: wa.graphBase, version: wa.graphVersion }, parsed.data.wabaId, wa.token, true);
    return NextResponse.json({ comptes, wabaId: parsed.data.wabaId, ...r });
  } catch (error) {
    return NextResponse.json({ error: `Meta a refusé : ${(error as Error).message}` }, { status: 502 });
  }
}
