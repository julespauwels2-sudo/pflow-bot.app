/**
 * Lien [Voir le dashboard] de la démo permanente : note l'ouverture, programme l'étape 3/3, puis redirige vers le
 * dashboard de démo du CRM avec la commande du prospect après le # (src/demos/demo-auto.ts).
 * L'étape 3/3 part ≈ 20 s plus tard (PFLOW_DEMO_ETAPE3_SECONDES) depuis CETTE fonction, après la réponse (`after`),
 * même si l'onglet est fermé. Filet de sécurité : la tâche à la minute (/api/cron/demo). Jamais deux fois (clé unique).
 * Public : le jeton chiffré du contact fait foi ; un jeton faux ou expiré mène quand même au dashboard.
 */
import { after, NextResponse } from "next/server";
import { DEMO_PERMANENTE } from "@/demos/pflow-bot";
import { handleDemoDashboard, sendEtape3WhenDue } from "@/demos/demo-auto";
import { demoAutoDeps } from "@/demos/demo-auto-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Assez pour attendre l'étape 3 (900 s au plus en réglage ; 20 s par défaut) puis l'envoyer. */
export const maxDuration = 300;

export async function GET(_request: Request, context: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await context.params;
  let target = DEMO_PERMANENTE.dashboardUrl;
  try {
    const deps = await demoAutoDeps();
    if (deps) {
      const result = await handleDemoDashboard(deps, jeton);
      target = result.redirect;
      const { contactId, due } = result;
      if (contactId && due) {
        after(async () => {
          try {
            const report = await sendEtape3WhenDue(deps, contactId, due, (ms) => new Promise((r) => setTimeout(r, ms)));
            if (report.envoyees || report.ignorees.length) console.log("[demo] étape 3/3 (dashboard) :", JSON.stringify(report));
          } catch (error) {
            // La tâche à la minute prendra le relais.
            console.error("[demo] étape 3/3 (dashboard) :", error instanceof Error ? error.message : String(error));
          }
        });
      }
    }
  } catch (error) {
    console.error("[demo] dashboard :", error instanceof Error ? error.message : String(error));
  }
  return NextResponse.redirect(target, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
