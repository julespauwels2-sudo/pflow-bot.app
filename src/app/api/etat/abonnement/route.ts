/**
 * Abonner / désabonner l'app PFlow Bots aux messages du compte d'un canal WhatsApp (page État), avec le
 * token du serveur (WHATSAPP_TOKEN, jamais affiché). Réservé aux administrateurs. Vise le compte de
 * messagerie du canal (sinon son WABA). Réversible : « Désabonner » coupe la réception, rien d'autre.
 */
import { NextResponse } from "next/server";
import { getChannelsRuntime, readWhatsAppConfig } from "@/channels/core/runtime";
import { setAppSubscription } from "@/channels/whatsapp/graph";
import { checkBotAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const config = readWhatsAppConfig();
  if (!config.ready) return NextResponse.json({ error: "WhatsApp non configuré." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { id?: string; abonner?: boolean };
  const canal = (await (await getChannelsRuntime()).store.listCanaux()).find((c) => c.id === body.id && c.plateforme === "whatsapp");
  if (!canal) return NextResponse.json({ error: "Canal WhatsApp introuvable." }, { status: 404 });
  const account = canal.messagingAccountId || canal.wabaId;
  if (!account) return NextResponse.json({ error: "Ni compte de messagerie ni WABA sur ce canal." }, { status: 400 });
  const result = await setAppSubscription({ token: config.token, base: config.graphBase, version: config.graphVersion }, account, body.abonner !== false);
  console.log(`[abonnement] ${canal.numeroAffiche ?? canal.accountId} : ${body.abonner !== false ? "abonner" : "désabonner"} → ${result.ok ? "ok" : "refus"}`);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
