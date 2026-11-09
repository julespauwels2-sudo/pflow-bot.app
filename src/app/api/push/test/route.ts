/**
 * « Envoyer une notification de test » (page État et boîte de réception) : vers les appareils du compte connecté
 * seulement. Aucun client, aucun canal WhatsApp touché.
 */
import { NextResponse } from "next/server";
import { pushConfigFromEnv, sendPushToAll } from "@/channels/core/push";
import { pushAccess } from "@/lib/push-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await pushAccess(request, "push-test", 6);
  if (!access.ok) return access.response;
  const config = pushConfigFromEnv((name) => process.env[name]?.trim() || "");
  const result = await sendPushToAll(
    { store: access.store, config, now: new Date() },
    { title: "🔔 Notification de test", body: "Les alertes de PFlow Bots arriveront comme ceci. Touchez pour ouvrir la boîte de réception.", url: "/inbox", tag: "test" },
    { userId: access.userId },
  );
  return NextResponse.json(result, { status: result.statut === "envoyee" ? 200 : result.statut === "echec" ? 502 : 409, headers: { "cache-control": "no-store" } });
}
