/**
 * Événement de commande SIMULÉ (page État), réservé aux administrateurs : aucune commande n'est créée.
 * L'appel passe par la vraie route /api/webhooks/pflow-order, signé avec PFLOW_BOTS_SECRET comme le fait
 * PFlow Order, avec simulation: true. Il ne vise QUE le canal WhatsApp en test et le premier numéro de sa
 * liste de test (jamais un vrai client).
 */
import { NextResponse } from "next/server";
import { exampleEventData, isOrderEvent } from "@/engine";
import { getChannelsRuntime } from "@/channels/core/runtime";
import { signOrderPayload, type OrderPayload } from "@/channels/pflow-order/order-events";
import { maskId } from "@/channels/core/privacy";
import { checkBotAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TO_PFLOW_ORDER = { commande_validee: "commande", commande_en_preparation: "en_preparation", commande_prete: "prete" } as const;

export async function POST(request: Request) {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const secret = process.env.PFLOW_BOTS_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "PFLOW_BOTS_SECRET n'est pas défini dans Vercel." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { event?: string; mode?: string; paiement?: string };
  if (!isOrderEvent(body.event)) return NextResponse.json({ error: "Événement inconnu." }, { status: 400 });

  const canaux = (await (await getChannelsRuntime()).store.listCanaux()).filter((c) => c.plateforme === "whatsapp" && c.etat === "test" && (c.role ?? "resto") === "resto");
  const canal = canaux.find((c) => c.testNumeros.length && c.restaurantId);
  if (!canal) return NextResponse.json({ error: "Aucun canal WhatsApp en test avec un numéro de test." }, { status: 404 });
  const tel = canal.testNumeros[0];

  const data = exampleEventData(body.event);
  const payload: OrderPayload =
    body.event === "panier_abandonne"
      ? { type: "option", option: "relance", restaurant_id: canal.restaurantId, client_tel: tel, client_nom: data.client_nom, panier: { recap: data.panier_recap, total: data.panier_total }, simulation: true }
      : {
          type: "commande",
          restaurant_id: canal.restaurantId,
          client_tel: tel,
          commande_id: `simulation-${Date.now()}`,
          evenements: [{ pflow_order: TO_PFLOW_ORDER[body.event], pflow_bots: body.event }],
          variables: {
            ...data,
            commande_mode: body.mode === "livraison" ? "livraison" : "retrait",
            paiement_mode: body.paiement === "en_ligne" ? "en_ligne" : "sur_place",
            commande_statut: body.event === "commande_prete" ? "prete" : body.event === "commande_en_preparation" ? "en_preparation" : "recue",
          },
          simulation: true,
        };

  // Même chemin que PFlow Order : appel HTTP signé de la route publique (vérifie aussi le secret).
  const raw = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const response = await fetch(new URL("/api/webhooks/pflow-order", request.url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-pflow-horodatage": ts, "x-pflow-signature": signOrderPayload(raw, secret, ts) },
    body: raw,
  }).catch((error: unknown) => ({ ok: false, status: 0, json: async () => ({ raison: String(error) }) }) as const);
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json(
    { canal: canal.numeroAffiche ?? canal.accountId, destinataire: maskId(tel), http: response.status, resultat: result },
    { status: response.ok ? 200 : 502, headers: { "cache-control": "no-store" } },
  );
}
