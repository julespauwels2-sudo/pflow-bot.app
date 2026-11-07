/**
 * Événements de commande de PFlow Order (patches 01 et 02 du dépôt Pflow-Crm). Hors mot de passe de l'app
 * (src/proxy.ts : /api/webhooks/) : chaque appel est signé (X-PFlow-Signature, HMAC-SHA256 avec
 * PFLOW_BOTS_SECRET, horodatage de moins de 5 min). Répond pris: true / false (voir order-events.ts).
 * Inactif (503) sans PFLOW_BOTS_SECRET ni WhatsApp configuré : PFlow Order passe alors par UChat.
 */
import { NextResponse } from "next/server";
import { getChannelsRuntime, readWhatsAppConfig } from "@/channels/core/runtime";
import { rateLimit } from "@/channels/core/rate-limit";
import { handleOrderEvent, orderPayloadSchema, verifyOrderSignature } from "@/channels/pflow-order/order-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const secret = process.env.PFLOW_BOTS_SECRET?.trim();
  if (!secret || !readWhatsAppConfig().ready) return NextResponse.json({ pris: false, raison: "PFlow Bots non configuré" }, { status: 503 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "inconnue";
  if (!rateLimit(`pflow-order:${ip}`, 300, 60_000)) return NextResponse.json({ pris: false, raison: "trop d'appels" }, { status: 429 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ pris: false, raison: "corps trop gros" }, { status: 413 });
  if (!verifyOrderSignature(raw, request.headers.get("x-pflow-horodatage"), request.headers.get("x-pflow-signature"), secret)) {
    console.warn("[pflow-order] appel refusé : signature ou horodatage invalide (vérifier PFLOW_BOTS_SECRET des deux côtés).");
    return NextResponse.json({ pris: false, raison: "signature invalide" }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ pris: false, raison: "corps illisible" }, { status: 400 });
  }
  const parsed = orderPayloadSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ pris: false, raison: "corps invalide" }, { status: 400 });
  try {
    const rt = await getChannelsRuntime();
    const deps = rt.deps("whatsapp");
    if (!deps) return NextResponse.json({ pris: false, raison: "WhatsApp non configuré" }, { status: 503 });
    const result = await handleOrderEvent(parsed.data, { store: rt.store, graph: deps.graph, ai: deps.ai, loadBot: (id) => deps.loadBot(id) });
    // Une ligne par appel, sans numéro ni contenu.
    console.log(`[pflow-order] ${parsed.data.type === "option" ? "relance" : parsed.data.evenements.map((e) => e.pflow_order).join("+")} : ${result.pris ? `pris (${Object.entries(result.envois).map(([k, v]) => `${k}=${v.etat}`).join(", ")})` : `pas pris (${result.raison})`}`);
    return NextResponse.json(result);
  } catch (error) {
    // Erreur : pris false, PFlow Order se rabat sur UChat (comme s'il était injoignable).
    console.error("[pflow-order] erreur :", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ pris: false, raison: "erreur PFlow Bots" }, { status: 500 });
  }
}
