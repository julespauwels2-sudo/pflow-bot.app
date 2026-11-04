/**
 * Envoi par l'API Graph de Meta (WhatsApp Cloud API) : texte, boutons de réponse, liste, bouton lien
 * (CTA URL), accusé de lecture avec « en train d'écrire », téléchargement des messages vocaux. L'adresse de base est réglable pour les tests
 * (faux serveur Meta local).
 */
import type { OutgoingMessage } from "@/engine";
import { allowedMediaUrl, fetchMedia, MediaError } from "../core/media";
import type { MediaRef } from "../core/types";

export interface GraphConfig {
  token: string;
  /** Ex. https://graph.facebook.com (ou un faux serveur local). */
  base: string;
  /** Ex. v24.0 (à fixer au moment de C1). */
  version: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Corps de l'appel Graph pour un message du moteur (null pour « en train d'écrire »). */
export function toGraphPayload(to: string, message: OutgoingMessage): Record<string, unknown> | null {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  switch (message.kind) {
    case "typing":
      return null;
    case "text":
      return { ...base, type: "text", text: { body: message.text, preview_url: false } };
    case "buttons":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: message.text },
          action: { buttons: message.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
        },
      };
    case "list":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: message.text },
          action: {
            button: message.buttonLabel,
            sections: [{ rows: message.items.map((i) => ({ id: i.id, title: i.title, ...(i.description ? { description: i.description } : {}) })) }],
          },
        },
      };
    case "link":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: message.text },
          action: { name: "cta_url", parameters: { display_text: message.buttonLabel, url: message.url } },
        },
      };
  }
}

export function createGraphClient(config: GraphConfig) {
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
        throw new GraphError(`Meta a refusé l'envoi (${response.status}) : ${error.message ?? "erreur inconnue"}`, response.status);
      }
      return json;
    } catch (error) {
      if (error instanceof GraphError) throw error;
      throw new GraphError(`Meta injoignable : ${error instanceof Error ? error.message : String(error)}`, 0);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /** Envoie un message et renvoie son identifiant WhatsApp (wamid). */
    async send(accountId: string, to: string, message: OutgoingMessage): Promise<string | undefined> {
      const payload = toGraphPayload(to, message);
      if (!payload) return undefined;
      const json = await post(accountId, payload);
      const first = (json.messages as { id?: string }[] | undefined)?.[0];
      return first?.id;
    },
    /** Accusé de lecture du message reçu, avec l'indicateur « en train d'écrire ». */
    async markRead(accountId: string, wamid: string, typing: boolean): Promise<void> {
      await post(accountId, {
        messaging_product: "whatsapp",
        status: "read",
        message_id: wamid,
        ...(typing ? { typing_indicator: { type: "text" } } : {}),
      });
    },
    /** Message vocal : adresse temporaire demandée à Meta, puis téléchargement avec le token. */
    async downloadMedia(media: MediaRef): Promise<{ data: Uint8Array; mimeType: string }> {
      if (!media.id) throw new MediaError("Média sans identifiant");
      const auth = { authorization: `Bearer ${config.token}` };
      const infoUrl = `${config.base.replace(/\/$/, "")}/${config.version}/${encodeURIComponent(media.id)}`;
      const info = await fetchMedia(doFetch, infoUrl, auth, "application/json");
      const json = JSON.parse(new TextDecoder().decode(info.data)) as { url?: string; mime_type?: string };
      if (!json.url || !allowedMediaUrl(json.url, config.base.startsWith("https://") ? "" : config.base)) throw new MediaError("Adresse du média refusée");
      return fetchMedia(doFetch, json.url, auth, json.mime_type || media.mimeType || "audio/ogg");
    },
  };
}

export type GraphClient = ReturnType<typeof createGraphClient>;
