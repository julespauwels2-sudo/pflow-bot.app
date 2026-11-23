/**
 * Messages de suivi de livraison de PFlow Order (contrat docs/livraison/INTERFACE-PFLOW-BOTS.md du CRM, version 1).
 * Hors mot de passe de l'app (src/proxy.ts : /api/webhooks/) : chaque appel est signé exactement comme
 * /api/webhooks/pflow-order (X-PFlow-Signature, HMAC-SHA256 avec PFLOW_BOTS_SECRET, horodatage de moins de 5 min).
 * Toujours depuis le numéro du resto (livraison-events.ts) ; réponse HTTP 200 avec pris true / false (§9).
 */
import { NextResponse } from "next/server";
import { getChannelsRuntime, readWhatsAppConfig } from "@/channels/core/runtime";
import { rateLimit } from "@/channels/core/rate-limit";
import { handleLivraisonEvent, livraisonPayloadSchema } from "@/channels/pflow-order/livraison-events";
import { verifyOrderSignature } from "@/channels/pflow-order/order-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 32 * 1024;

export async function POST(request: Request) {
  const secret = process.env.PFLOW_BOTS_SECRET?.trim();
  if (!secret || !readWhatsAppConfig().ready) return NextResponse.json({ pris: false, raison: "non_configure" }, { status: 503 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "inconnue";
  if (!rateLimit(`pflow-livraison:${ip}`, 300, 60_000)) return NextResponse.json({ pris: false, raison: "trop_d_appels" }, { status: 429 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ pris: false, raison: "corps_trop_gros" }, { status: 413 });
  if (!verifyOrderSignature(raw, request.headers.get("x-pflow-horodatage"), request.headers.get("x-pflow-signature"), secret)) {
    console.warn("[pflow-livraison] appel refusé : signature ou horodatage invalide (vérifier PFLOW_BOTS_SECRET des deux côtés).");
    return NextResponse.json({ pris: false, raison: "signature_invalide" }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ pris: false, raison: "corps_illisible" }, { status: 400 });
  }
  // Version inconnue : réponse du contrat (200), avant la validation détaillée du corps.
  if (json && typeof json === "object" && (json as { type?: unknown }).type === "livraison" && (json as { version?: unknown }).version !== 1) {
    return NextResponse.json({ pris: false, raison: "version_inconnue" });
  }
  const parsed = livraisonPayloadSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ pris: false, raison: "corps_invalide" }, { status: 400 });
  try {
    const rt = await getChannelsRuntime();
    const deps = rt.deps("whatsapp");
    if (!deps) return NextResponse.json({ pris: false, raison: "non_configure" }, { status: 503 });
    const result = await handleLivraisonEvent(parsed.data, { store: rt.store, graph: deps.graph });
    // Une ligne par appel, sans numéro ni contenu (le texte n'est jamais journalisé).
    console.log(`[pflow-livraison] ${parsed.data.evenement} (${parsed.data.slug ?? parsed.data.restaurant_id}) : ${result.pris ? `envoyé (${result.via})` : `pas pris (${result.raison})`}`);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[pflow-livraison] erreur :", error instanceof Error ? error.message.replace(/\+?\d{6,}/g, "•••") : String(error));
    return NextResponse.json({ pris: false, raison: "erreur_pflow_bots" }, { status: 500 });
  }
}
