/**
 * Webhook WhatsApp Cloud (Meta). Hors mot de passe de l'app (voir src/proxy.ts) : chaque appel est
 * vérifié par la signature X-Hub-Signature-256. Inactif (503) sans les variables WhatsApp.
 */
import { webhookGet, webhookPost } from "@/channels/core/webhook-route";
import { parseWebhook } from "@/channels/whatsapp/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => webhookGet("whatsapp", request);
export const POST = (request: Request) => webhookPost("whatsapp", request, parseWebhook);
