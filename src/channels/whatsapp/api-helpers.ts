/** Accès commun des routes de la boîte de réception : connexion vérifiée, canal configuré. */
import { NextResponse } from "next/server";
import { checkBotAdmin } from "@/lib/server-auth";
import { getWhatsAppRuntime, readWhatsAppConfig, type WhatsAppRuntime } from "./runtime";

export type InboxAccess = { ok: true; runtime: WhatsAppRuntime } | { ok: false; response: NextResponse };

export async function inboxAccess(request: Request): Promise<InboxAccess> {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return { ok: false, response: NextResponse.json({ error: caller.error }, { status: caller.status }) };
  const config = readWhatsAppConfig();
  if (!config.ready) {
    return { ok: false, response: NextResponse.json({ available: false, missing: config.missing }, { status: 200 }) };
  }
  try {
    return { ok: true, runtime: await getWhatsAppRuntime(config) };
  } catch (error) {
    return { ok: false, response: NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }) };
  }
}
