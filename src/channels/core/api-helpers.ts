/** Accès commun des routes de la boîte de réception : connexion vérifiée, au moins un canal configuré. */
import { NextResponse } from "next/server";
import { tooManyRequests } from "@/lib/request-limit";
import { checkBotAdmin } from "@/lib/server-auth";
import { getChannelsRuntime, readInstagramConfig, readWhatsAppConfig, type ChannelsRuntime } from "./runtime";

export type InboxAccess = { ok: true; runtime: ChannelsRuntime } | { ok: false; response: NextResponse };

export async function inboxAccess(request: Request): Promise<InboxAccess> {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return { ok: false, response: NextResponse.json({ error: caller.error }, { status: caller.status }) };
  // La page se rafraîchit toutes les 5 s (2 appels) : 120 par minute laisse de la marge.
  const limited = tooManyRequests("inbox", request, caller.userId, 120);
  if (limited) return { ok: false, response: limited };
  const wa = readWhatsAppConfig();
  const ig = readInstagramConfig();
  if (!wa.ready && !ig.ready) {
    const missing = [...new Set([...(wa.ready ? [] : wa.missing), ...(ig.ready ? [] : ig.missing)])];
    return { ok: false, response: NextResponse.json({ available: false, missing }, { status: 200 }) };
  }
  try {
    return { ok: true, runtime: await getChannelsRuntime() };
  } catch (error) {
    return { ok: false, response: NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }) };
  }
}
