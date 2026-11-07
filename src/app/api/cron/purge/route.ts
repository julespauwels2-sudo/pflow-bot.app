/**
 * Suppression automatique quotidienne (Vercel Cron, vercel.json) : conversations après 12 mois, journal
 * technique après 30 jours (src/channels/core/retention.ts). Hors mot de passe de l'app (src/proxy.ts) :
 * Vercel appelle avec « Authorization: Bearer <CRON_SECRET> ». Sans CRON_SECRET : refus (503).
 */
import { NextResponse } from "next/server";
import { getChannelsRuntime } from "@/channels/core/runtime";
import { runRetention } from "@/channels/core/retention";
import { cronAuthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth === "not_configured") return NextResponse.json({ error: "CRON_SECRET non défini." }, { status: 503 });
  if (auth === "deny") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    const { store } = await getChannelsRuntime();
    const report = await runRetention(store, new Date());
    console.log(`[purge] ${report.active ? "faite" : "suspendue (PURGE_ACTIVE=non)"} :`, JSON.stringify(report));
    return NextResponse.json(report);
  } catch (error) {
    console.error("[purge] échec :", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Échec de la suppression" }, { status: 500 });
  }
}
