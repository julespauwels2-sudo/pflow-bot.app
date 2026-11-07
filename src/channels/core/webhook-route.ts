/**
 * Webhook d'une plateforme de Meta (WhatsApp, Instagram) : vérification de l'adresse (GET), signature
 * X-Hub-Signature-256 sur le corps exact, réponse 200 immédiate puis traitement (after).
 * Inactif (503) tant que les variables de la plateforme ne sont pas définies.
 */
import { after, NextResponse } from "next/server";
import { maskId } from "./privacy";
import { processEvents } from "./processor";
import { getChannelsRuntime, readPlatformConfig } from "./runtime";
import { verifyChallenge, verifySignature } from "./signature";
import { rateLimit } from "./rate-limit";
import type { InboundEvent, Plateforme, StatusEvent } from "./types";

/** Corps refusé au-delà (une notification de Meta fait quelques Ko). */
export const MAX_WEBHOOK_BYTES = 512 * 1024;

const inactive = () => NextResponse.json({ error: "Canal non configuré." }, { status: 503 });

export function webhookGet(plateforme: Plateforme, request: Request) {
  const config = readPlatformConfig(plateforme);
  if (!config.ready) return inactive();
  const challenge = verifyChallenge(new URL(request.url).searchParams, config.verifyToken);
  if (challenge === null) return new NextResponse("Vérification refusée", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function webhookPost(
  plateforme: Plateforme,
  request: Request,
  parse: (payload: unknown) => { inbound: InboundEvent[]; statuses: StatusEvent[] },
) {
  const config = readPlatformConfig(plateforme);
  if (!config.ready) return inactive();
  // Limite de débit par adresse (protection simple, par instance du serveur).
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "inconnue";
  if (!rateLimit(`webhook:${plateforme}:${ip}`, 600, 60_000)) return NextResponse.json({ error: "Trop d'appels" }, { status: 429 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_WEBHOOK_BYTES) return NextResponse.json({ error: "Corps trop gros" }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BYTES) return NextResponse.json({ error: "Corps trop gros" }, { status: 413 });
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    // Visible dans les journaux Vercel : un mauvais secret d'app (WHATSAPP_APP_SECRET) se voit tout de suite.
    console.warn(`[${plateforme}] appel refusé : signature invalide (vérifier le secret de l'app Meta).`);
    return NextResponse.json({ error: "Signature invalide" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Corps illisible" }, { status: 400 });
  }
  after(async () => {
    try {
      const runtime = await getChannelsRuntime();
      const deps = runtime.deps(plateforme);
      if (!deps) return;
      const events = parse(payload);
      const report = await processEvents(events, deps);
      // Une ligne par appel de Meta (sans numéro ni texte) : on voit tout de suite si un message est arrivé.
      console.log(`[${plateforme}] ${summarize(events, report)}`);
      // Jamais de numéro ni de message en clair dans les journaux.
      if (report.errors.length) console.error(`[${plateforme}]`, report.errors.map(maskId).join(" | "));
    } catch (error) {
      console.error(`[${plateforme}] traitement impossible :`, maskId(error instanceof Error ? error.message : String(error)));
    }
  });
  return NextResponse.json({ ok: true });
}

/**
 * Résumé d'un appel pour les journaux : nombre de messages et de statuts, messages traités, ignorés
 * (avec la raison) et en erreur. L'exemple du bouton « Tester » de Meta est signalé comme tel.
 */
export function summarize(
  events: { inbound: InboundEvent[]; statuses: StatusEvent[] },
  report: { handled: unknown[]; skipped: { reason: string }[]; errors: string[] },
): string {
  const parts = [`reçu : ${events.inbound.length} message(s), ${events.statuses.length} statut(s)`];
  if (report.handled.length) parts.push(`traités : ${report.handled.length}`);
  if (report.skipped.length) parts.push(`ignorés : ${report.skipped.map((s) => s.reason).join(", ")}`);
  if (report.errors.length) parts.push(`erreurs : ${report.errors.length}`);
  if (events.inbound.some((e) => e.wamid === META_SAMPLE_ID)) parts.push("(exemple du bouton « Tester » de Meta, pas un vrai message)");
  return maskId(parts.join(" ; "));
}

/** Identifiant du message d'exemple envoyé par le bouton « Tester » du tableau de bord de Meta. */
export const META_SAMPLE_ID = "ABGGFlA5Fpa";
