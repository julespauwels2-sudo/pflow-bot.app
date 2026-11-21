/**
 * « Envoyer une alerte de test » (page État) : une alerte factice, par les deux voies (appli PFlow et Web Push), comme
 * une vraie alerte de transfert. Aucun client, aucun canal WhatsApp touché, rien d'enregistré. Administrateurs seulement.
 */
import { NextResponse } from "next/server";
import { alertConfigFromEnv, sendAlert } from "@/channels/core/alerts";
import { getChannelsRuntime } from "@/channels/core/runtime";
import type { Canal } from "@/channels/core/types";
import { tooManyRequests } from "@/lib/request-limit";
import { checkBotAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Canal factice : sert seulement au texte de l'alerte (aucun envoi WhatsApp). */
const CANAL_TEST: Canal = {
  id: "test-alerte",
  role: "pflow",
  restaurantId: "",
  plateforme: "whatsapp",
  accountId: "test",
  triggerMode: "toujours",
  coexistence: false,
  echoPauseHours: 0,
  handoffPauseHours: 0,
  sessionMinutes: 30,
  etat: "test",
  testNumeros: [],
};

export async function POST(request: Request) {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const limited = tooManyRequests("alerte-test", request, caller.userId, 6);
  if (limited) return limited;
  const rt = await getChannelsRuntime();
  const result = await sendAlert(
    { store: rt.store, config: alertConfigFromEnv((name) => process.env[name]?.trim() || ""), now: new Date() },
    { canal: CANAL_TEST, resto: "Test", motif: "Alerte de test", contactName: "PFlow Bots", contactId: "", extrait: "Les alertes de transfert arriveront comme ceci." },
  );
  return NextResponse.json(result, { status: result.voie === "aucune" ? 409 : 200, headers: { "cache-control": "no-store" } });
}
