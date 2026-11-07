/**
 * Test de l'accès du token WhatsApp (page État), réservé aux administrateurs du bot : lectures seules
 * auprès de Meta pour chaque canal WhatsApp, aucun message envoyé. Le token n'est jamais renvoyé.
 */
import { NextResponse } from "next/server";
import { getChannelsRuntime, readWhatsAppConfig } from "@/channels/core/runtime";
import { checkWhatsAppAccess } from "@/channels/whatsapp/graph";
import { checkBotAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const config = readWhatsAppConfig();
  if (!config.ready) return NextResponse.json({ error: `WhatsApp non configuré (manque : ${config.missing.join(", ")}).` }, { status: 503 });
  try {
    const canaux = (await (await getChannelsRuntime()).store.listCanaux()).filter((c) => c.plateforme === "whatsapp");
    const resultats = [];
    for (const canal of canaux) {
      resultats.push({
        canal: canal.numeroAffiche ?? canal.accountId,
        etat: canal.etat,
        etapes: await checkWhatsAppAccess({ token: config.token, base: config.graphBase, version: config.graphVersion }, canal.accountId, canal.wabaId, canal.messagingAccountId),
      });
    }
    return NextResponse.json({ testeLe: new Date().toISOString(), version: config.graphVersion, resultats }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
