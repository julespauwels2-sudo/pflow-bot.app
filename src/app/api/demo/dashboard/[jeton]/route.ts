/**
 * Lien [Voir le dashboard] de la démo permanente : note l'ouverture, programme l'étape 3/3 (envoyée par la tâche à la
 * minute, /api/cron/demo, même si l'onglet est fermé), puis redirige vers le dashboard de démo du CRM avec la commande
 * du prospect après le # (src/demos/demo-auto.ts). Public : le jeton chiffré du contact fait foi ; un jeton faux ou
 * expiré mène quand même au dashboard (sans rien programmer).
 */
import { NextResponse } from "next/server";
import { DEMO_PERMANENTE } from "@/demos/pflow-bot";
import { handleDemoDashboard } from "@/demos/demo-auto";
import { demoAutoDeps } from "@/demos/demo-auto-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await context.params;
  let target = DEMO_PERMANENTE.dashboardUrl;
  try {
    const deps = await demoAutoDeps();
    if (deps) target = (await handleDemoDashboard(deps, jeton)).redirect;
  } catch (error) {
    console.error("[demo] dashboard :", error instanceof Error ? error.message : String(error));
  }
  return NextResponse.redirect(target, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
