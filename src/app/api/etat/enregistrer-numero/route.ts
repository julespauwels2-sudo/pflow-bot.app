/**
 * Enregistrer un numéro dédié sur l'API Cloud (page État), avec le token du serveur (WHATSAPP_TOKEN, jamais
 * affiché). Réservé aux administrateurs. Pour un numéro ajouté à la main dans WhatsApp Manager (ex. le fixe d'un
 * resto, sans appli WhatsApp Business). Ne crée pas de canal : le diagnostic donne ensuite le SQL du canal en test.
 */
import { NextResponse } from "next/server";
import { readWhatsAppConfig } from "@/channels/core/runtime";
import { registerPhoneNumber } from "@/channels/whatsapp/graph";
import { checkBotAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const config = readWhatsAppConfig();
  if (!config.ready) return NextResponse.json({ error: "WhatsApp non configuré." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { phoneNumberId?: string; pin?: string };
  const phoneNumberId = String(body.phoneNumberId ?? "").replace(/\s/g, "");
  const pin = String(body.pin ?? "").replace(/\s/g, "");
  const result = await registerPhoneNumber({ token: config.token, base: config.graphBase, version: config.graphVersion }, phoneNumberId, pin);
  console.log(`[enregistrer-numero] ${phoneNumberId} → ${result.ok ? "ok" : "refus"}`);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
