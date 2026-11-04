/**
 * Envoi par l'API de messagerie Instagram (Meta). Le moteur produit les mêmes messages que pour
 * WhatsApp ; ils sont adaptés aux formats d'Instagram :
 * - boutons de réponse et listes → réponses rapides (13 au plus, titres de 20 caractères) ;
 * - bouton lien → modèle « button » avec un bouton web_url ;
 * - « en train d'écrire » → sender_action typing_on (et mark_seen) ;
 * - mise en forme WhatsApp (*gras*…) retirée, Instagram ne l'affiche pas.
 * Formats et limites à revérifier dans la documentation de Meta au moment du branchement.
 */
import type { OutgoingMessage } from "@/engine";
import type { ChannelSender } from "../core/types";
import { GraphError } from "../whatsapp/graph";
import { allowedMediaUrl, fetchMedia, MediaError } from "../core/media";

export const INSTAGRAM_LIMITS = { text: 1000, quickReplies: 13, quickReplyTitle: 20, buttonTemplateText: 640, buttonTitle: 20 } as const;

const clip = (text: string, max: number) => (Array.from(text).length > max ? `${Array.from(text).slice(0, max - 1).join("")}…` : text);

/**
 * Instagram n'interprète pas la mise en forme de WhatsApp : *gras*, _italique_, ~barré~ et ```code```
 * s'afficheraient avec leurs symboles. On les retire (le texte reste identique).
 */
export function plainInstagramText(text: string): string {
  return text
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/(^|[\s(«"'])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s).,!?:;»"'])/gmu, "$1$2")
    .replace(/(^|[\s(«"'])_(?=\S)([^_\n]*?\S)_(?=$|[\s).,!?:;»"'])/gmu, "$1$2")
    .replace(/(^|[\s(«"'])~(?=\S)([^~\n]*?\S)~(?=$|[\s).,!?:;»"'])/gmu, "$1$2");
}

const cut = (text: string, max: number) => clip(plainInstagramText(text), max);

export function toInstagramPayload(to: string, message: OutgoingMessage): Record<string, unknown> | null {
  const recipient = { id: to };
  switch (message.kind) {
    case "typing":
      return null;
    case "text":
      return { recipient, message: { text: cut(message.text, INSTAGRAM_LIMITS.text) } };
    case "buttons":
      return {
        recipient,
        message: {
          text: cut(message.text, INSTAGRAM_LIMITS.text),
          quick_replies: message.buttons.slice(0, INSTAGRAM_LIMITS.quickReplies).map((b) => ({ content_type: "text", title: cut(b.title, INSTAGRAM_LIMITS.quickReplyTitle), payload: b.id })),
        },
      };
    case "list":
      return {
        recipient,
        message: {
          text: cut(message.text, INSTAGRAM_LIMITS.text),
          quick_replies: message.items.slice(0, INSTAGRAM_LIMITS.quickReplies).map((i) => ({ content_type: "text", title: cut(i.title, INSTAGRAM_LIMITS.quickReplyTitle), payload: i.id })),
        },
      };
    case "link":
      return {
        recipient,
        message: {
          attachment: {
            type: "template",
            payload: { template_type: "button", text: cut(message.text, INSTAGRAM_LIMITS.buttonTemplateText), buttons: [{ type: "web_url", url: message.url, title: cut(message.buttonLabel, INSTAGRAM_LIMITS.buttonTitle) }] },
          },
        },
      };
  }
}

export interface InstagramConfig {
  token: string;
  /** Ex. https://graph.instagram.com (ou un faux serveur local). */
  base: string;
  version: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createInstagramSender(config: InstagramConfig): ChannelSender {
  const doFetch = config.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const url = (accountId: string) => `${config.base.replace(/\/$/, "")}/${config.version}/${encodeURIComponent(accountId)}/messages`;

  async function post(accountId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
    try {
      const response = await doFetch(url(accountId), {
        method: "POST",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        const error = (json.error ?? {}) as { message?: string };
        throw new GraphError(`Instagram a refusé l'envoi (${response.status}) : ${error.message ?? "erreur inconnue"}`, response.status);
      }
      return json;
    } catch (error) {
      if (error instanceof GraphError) throw error;
      throw new GraphError(`Instagram injoignable : ${error instanceof Error ? error.message : String(error)}`, 0);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async send(accountId, to, message) {
      const payload = toInstagramPayload(to, message);
      if (!payload) return undefined;
      const json = await post(accountId, payload);
      return typeof json.message_id === "string" ? json.message_id : undefined;
    },
    async markRead(accountId, _messageId, typing, to) {
      if (!to) return;
      await post(accountId, { recipient: { id: to }, sender_action: "mark_seen" });
      if (typing) await post(accountId, { recipient: { id: to }, sender_action: "typing_on" });
    },
    /** Message vocal : l'adresse (temporaire) est dans la notification ; pas de token à envoyer. */
    async downloadMedia(media) {
      if (!media.url || !allowedMediaUrl(media.url, config.base.startsWith("https://") ? "" : config.base)) throw new MediaError("Adresse du média refusée");
      return fetchMedia(doFetch, media.url, {}, media.mimeType || "audio/mp4");
    },
  };
}
