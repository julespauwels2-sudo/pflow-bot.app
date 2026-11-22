/**
 * Pause intelligente (bots des restos) : tâche planifiée à la minute (Vercel Cron, vercel.json). Quand l'équipe a
 * répondu à la main, le bot se tait ; si le client réécrit et que personne ne lui répond dans le délai de la fiche
 * (10 min par défaut), le bot reprend ici (src/channels/core/processor.ts, processReprises). Vercel appelle avec
 * « Authorization: Bearer <CRON_SECRET> ».
 */
import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { getChannelsRuntime } from "@/channels/core/runtime";
import { messageText } from "@/channels/core/inbox";
import { processReprises } from "@/channels/core/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth === "not_configured") return NextResponse.json({ error: "CRON_SECRET non défini." }, { status: 503 });
  if (auth === "deny") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    const rt = await getChannelsRuntime();
    const report = await processReprises(rt.store, (p) => rt.deps(p), new Date(), messageText);
    if (report.reprises || report.erreurs.length) console.log("[reprise] pause intelligente :", JSON.stringify(report));
    return NextResponse.json(report);
  } catch (error) {
    console.error("[reprise] tâche :", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Échec" }, { status: 500 });
  }
}
