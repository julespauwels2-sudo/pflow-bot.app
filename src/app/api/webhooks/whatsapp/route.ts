/**
 * Webhook WhatsApp Cloud (Meta). Hors mot de passe de l'app (voir src/proxy.ts) : chaque appel est
 * vérifié par la signature X-Hub-Signature-256. Réponse 200 immédiate, traitement juste après.
 * Inactif (503) tant que les variables Meta ne sont pas définies.
 */
import { after, NextResponse } from "next/server";
import { processWebhookPayload } from "@/channels/whatsapp/processor";
import { getWhatsAppRuntime, readWhatsAppConfig } from "@/channels/whatsapp/runtime";
import { verifyChallenge, verifySignature } from "@/channels/whatsapp/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inactive = () => NextResponse.json({ error: "Canal WhatsApp non configuré." }, { status: 503 });

/** Vérification de l'adresse par Meta (au branchement du webhook). */
export async function GET(request: Request) {
  const config = readWhatsAppConfig();
  if (!config.ready) return inactive();
  const challenge = verifyChallenge(new URL(request.url).searchParams, config.verifyToken);
  if (challenge === null) return new NextResponse("Vérification refusée", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request) {
  const config = readWhatsAppConfig();
  if (!config.ready) return inactive();
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return NextResponse.json({ error: "Signature invalide" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Corps illisible" }, { status: 400 });
  }
  // Meta attend une réponse rapide : le traitement continue après la réponse.
  after(async () => {
    try {
      const runtime = await getWhatsAppRuntime(config);
      const report = await processWebhookPayload(payload, runtime.deps);
      if (report.errors.length) console.error("[whatsapp]", report.errors.join(" | "));
    } catch (error) {
      console.error("[whatsapp] traitement impossible", error);
    }
  });
  return NextResponse.json({ ok: true });
}
