/**
 * Démos du numéro PFlow : nombre de conversations par démo (contacts qui ont ouvert la démo par son
 * mot-clé). Réservé aux administrateurs ; vide tant que le canal n'est pas branché.
 */
import { NextResponse } from "next/server";
import { getChannelsRuntime, readWhatsAppConfig } from "@/channels/core/runtime";
import { tooManyRequests } from "@/lib/request-limit";
import { checkBotAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const limited = tooManyRequests("demos", request, caller.userId, 60);
  if (limited) return limited;
  if (!readWhatsAppConfig().ready) return NextResponse.json({ available: false, conversations: {} });
  try {
    const rt = await getChannelsRuntime();
    const conversations: Record<string, number> = {};
    for (const canal of (await rt.store.listCanaux()).filter((c) => c.role === "pflow")) {
      for (const contact of await rt.store.listContacts(canal.id)) {
        for (const id of contact.demo?.visited ?? []) conversations[id] = (conversations[id] ?? 0) + 1;
      }
    }
    return NextResponse.json({ available: true, mode: rt.mode, conversations }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
