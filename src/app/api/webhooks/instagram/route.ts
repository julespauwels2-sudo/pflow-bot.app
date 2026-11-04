/**
 * Webhook Instagram (messagerie des comptes professionnels, Meta). Même principe que WhatsApp :
 * signature X-Hub-Signature-256, réponse immédiate, inactif (503) sans les variables Instagram.
 */
import { webhookGet, webhookPost } from "@/channels/core/webhook-route";
import { parseInstagramWebhook } from "@/channels/instagram/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => webhookGet("instagram", request);
export const POST = (request: Request) => webhookPost("instagram", request, parseInstagramWebhook);
