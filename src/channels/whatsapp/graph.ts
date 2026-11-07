/**
 * Envoi par l'API Graph de Meta (WhatsApp Cloud API) : texte, boutons de réponse, liste, bouton lien
 * (CTA URL), accusé de lecture avec « en train d'écrire », téléchargement des messages vocaux. L'adresse de base est réglable pour les tests
 * (faux serveur Meta local).
 */
import type { OutgoingMessage } from "@/engine";
import { allowedMediaUrl, fetchMedia, MediaError } from "../core/media";
import type { MediaRef, SendOptions } from "../core/types";

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

/** Texte d'une erreur de Meta : message, code, sous-code, détail et identifiant de trace (pour le support Meta). */
export function graphErrorText(json: Record<string, unknown>): string {
  const error = (json.error ?? {}) as { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string }; fbtrace_id?: string };
  const extra = [
    error.error_subcode ? `sous-code ${error.error_subcode}` : "",
    error.error_data?.details && error.error_data.details !== error.message ? error.error_data.details : "",
    error.fbtrace_id ? `trace ${error.fbtrace_id}` : "",
  ].filter(Boolean);
  return `${error.message ?? "erreur inconnue"}${extra.length ? ` [${extra.join(" ; ")}]` : ""}`;
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
        throw new GraphError(`Meta a refusé l'envoi (${response.status}) : ${graphErrorText(json)}`, response.status);
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
    async send(accountId: string, to: string, message: OutgoingMessage, options: SendOptions = {}): Promise<string | undefined> {
      const payload = toGraphPayload(to, message);
      if (!payload) return undefined;
      const json = await post(accountId, options.messagingAccountId ? { ...payload, messaging_account_id: options.messagingAccountId } : payload);
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

export interface AccessStep {
  etape: string;
  ok: boolean;
  /** Ce que Meta répond (sans le token), ou l'erreur exacte. */
  detail: string;
}

/**
 * Test de l'accès du token (page État) : lectures seules, aucun message envoyé.
 * Numéro, compte WhatsApp (avec son portefeuille propriétaire), numéros du compte, apps abonnées.
 */
export async function checkWhatsAppAccess(config: GraphConfig, phoneNumberId: string, wabaId?: string): Promise<AccessStep[]> {
  const doFetch = config.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = `${config.base.replace(/\/$/, "")}/${config.version}`;
  const get = async (etape: string, path: string, show: (json: Record<string, unknown>) => string): Promise<AccessStep> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
    try {
      const response = await doFetch(`${base}/${path}`, { headers: { authorization: `Bearer ${config.token}` }, signal: controller.signal });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) return { etape, ok: false, detail: `Refus de Meta (${response.status}) : ${graphErrorText(json)}` };
      return { etape, ok: true, detail: show(json) };
    } catch (error) {
      return { etape, ok: false, detail: `Meta injoignable : ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      clearTimeout(timer);
    }
  };
  const id = encodeURIComponent;
  const steps = [
    await get("Numéro WhatsApp", `${id(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, (j) =>
      [j.display_phone_number, j.verified_name, j.quality_rating ? `qualité ${j.quality_rating}` : ""].filter(Boolean).join(" · ")),
  ];
  if (!wabaId) return [...steps, { etape: "Compte WhatsApp", ok: false, detail: "Aucun ID de compte WhatsApp (waba_id) sur ce canal." }];
  steps.push(
    await get("Compte WhatsApp (WABA)", `${id(wabaId)}?fields=id,name,owner_business_info`, (j) => {
      const owner = j.owner_business_info as { id?: string; name?: string } | undefined;
      return `${j.name ?? j.id} · portefeuille propriétaire : ${owner ? `${owner.name ?? "?"} (${owner.id ?? "?"})` : "non communiqué"}`;
    }),
    await get("Numéros du compte", `${id(wabaId)}/phone_numbers?fields=id,display_phone_number`, (j) => {
      const list = (j.data as { id?: string; display_phone_number?: string }[] | undefined) ?? [];
      const here = list.some((n) => n.id === phoneNumberId);
      return `${list.map((n) => n.display_phone_number ?? n.id).join(", ") || "aucun"}${here ? "" : " ⚠️ le numéro du canal n'est pas dans ce compte"}`;
    }),
    await get("Apps abonnées au compte", `${id(wabaId)}/subscribed_apps`, (j) => {
      const list = (j.data as { whatsapp_business_api_data?: { name?: string; id?: string } }[] | undefined) ?? [];
      return list.map((a) => a.whatsapp_business_api_data?.name ?? a.whatsapp_business_api_data?.id ?? "?").join(", ") || "aucune";
    }),
  );
  return steps;
}
