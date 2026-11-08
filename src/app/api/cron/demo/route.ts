/**
 * Tâche planifiée à la minute (Vercel Cron, vercel.json) : envoie les étapes 3/3 de la démo permanente programmées à
 * l'ouverture du dashboard (src/demos/demo-auto.ts). Vercel appelle avec « Authorization: Bearer <CRON_SECRET> ».
 */
import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { runDemoDue } from "@/demos/demo-auto";
import { demoAutoDeps } from "@/demos/demo-auto-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth === "not_configured") return NextResponse.json({ error: "CRON_SECRET non défini." }, { status: 503 });
  if (auth === "deny") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const deps = await demoAutoDeps();
  if (!deps) return NextResponse.json({ envoyees: 0, ignorees: [], note: "WhatsApp non configuré" });
  try {
    const report = await runDemoDue(deps);
    if (report.envoyees || report.ignorees.length) console.log("[demo] étapes 3/3 :", JSON.stringify(report));
    return NextResponse.json(report);
  } catch (error) {
    console.error("[demo] tâche :", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Échec" }, { status: 500 });
  }
}
