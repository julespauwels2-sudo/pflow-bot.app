/**
 * Renouvellement quotidien des jetons Meta des clients (Vercel Cron, vercel.json) : src/channels/whatsapp/jetons-renouvellement.ts.
 * Hors mot de passe de l'app (src/proxy.ts) : Vercel appelle avec « Authorization: Bearer <CRON_SECRET> ».
 * Aucun jeton n'apparaît dans la réponse ni dans le journal.
 */
import { NextResponse } from "next/server";
import { getChannelsRuntime, metaAppConfig } from "@/channels/core/runtime";
import { renouvelerJetons } from "@/channels/whatsapp/jetons-renouvellement";
import { cronAuthorized } from "@/lib/cron-auth";
import { chiffrerJeton, dechiffrerJeton } from "@/lib/jetons-chiffres";
import { alertConfigFromEnv, sendAlert } from "@/channels/core/alerts";
import type { Canal } from "@/channels/core/types";

/** Canal factice de l'alerte technique (aucun envoi WhatsApp). */
const CANAL_TECHNIQUE: Canal = {
  id: "technique",
  role: "pflow",
  restaurantId: "",
  plateforme: "whatsapp",
  accountId: "technique",
  triggerMode: "toujours",
  coexistence: false,
  echoPauseHours: 0,
  handoffPauseHours: 0,
  sessionMinutes: 30,
  etat: "test",
  testNumeros: [],
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const auth = cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth === "not_configured") return NextResponse.json({ error: "CRON_SECRET non défini." }, { status: 503 });
  if (auth === "deny") return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const meta = metaAppConfig();
  if (!meta) return NextResponse.json({ ok: true, ignore: "Embedded Signup non configuré (META_APP_ID, META_ES_CONFIG_ID)" });
  try {
    const { connexions, store } = await getChannelsRuntime();
    const rapport = await renouvelerJetons({ meta, connexions, chiffrer: (t) => chiffrerJeton(t), dechiffrer: (s) => dechiffrerJeton(s) });
    console.log("[jetons]", JSON.stringify({ ...rapport, echecs: rapport.echecs.length }));
    // Alerte technique (appli PFlow + Web Push) : un ou plusieurs jetons n'ont pas pu être renouvelés. Une fois par jour.
    if (rapport.echecs.length) {
      const alerte = await sendAlert(
        { store, config: alertConfigFromEnv((name) => process.env[name]?.trim() || ""), now: new Date() },
        {
          canal: CANAL_TECHNIQUE,
          resto: "PFlow Bots",
          motif: "Alerte technique : jeton Meta",
          contactId: "",
          extrait: `${rapport.echecs.length} jeton(s) non renouvelé(s) : voir la page État (reconnexion du resto).`,
        },
      );
      console.log("[jetons] alerte technique :", alerte.voie);
    }
    return NextResponse.json(rapport);
  } catch (error) {
    console.error("[jetons] échec :", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Échec du renouvellement" }, { status: 500 });
  }
}
