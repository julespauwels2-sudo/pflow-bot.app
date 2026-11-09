/**
 * Envoi par l'API Graph de Meta (WhatsApp Cloud API) : texte, boutons de réponse, liste, bouton lien
 * (CTA URL), accusé de lecture avec « en train d'écrire », téléchargement des messages vocaux. L'adresse de base est réglable pour les tests
 * (faux serveur Meta local).
 */
import type { OutgoingMessage } from "@/engine";
import { allowedMediaUrl, fetchMedia, MediaError } from "../core/media";
import type { MediaRef, SendOptions, TemplateMessage } from "../core/types";

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
    /** Modèle approuvé (hors fenêtre de 24 h) : corps à paramètres texte, dans l'ordre. */
    async sendTemplate(accountId: string, to: string, template: TemplateMessage, options: SendOptions = {}): Promise<string | undefined> {
      const payload: Record<string, unknown> = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language },
          ...(template.bodyParams.length ? { components: [{ type: "body", parameters: template.bodyParams.map((text) => ({ type: "text", text })) }] } : {}),
        },
      };
      const json = await post(accountId, options.messagingAccountId ? { ...payload, messaging_account_id: options.messagingAccountId } : payload);
      return (json.messages as { id?: string }[] | undefined)?.[0]?.id;
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
 * Numéro, compte WhatsApp (WABA), compte de messagerie (séparé du WABA : il doit lui aussi être attribué à
 * l'utilisateur système), numéros et apps abonnées (sur le compte qui répond).
 */
export async function checkWhatsAppAccess(config: GraphConfig, phoneNumberId: string, wabaId?: string, messagingAccountId?: string): Promise<AccessStep[]> {
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
  const steps: AccessStep[] = [
    await get("Numéro WhatsApp", `${id(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, (j) =>
      [j.display_phone_number, j.verified_name, j.quality_rating ? `qualité ${j.quality_rating}` : ""].filter(Boolean).join(" · ")),
  ];
  // Lecture simple de chaque compte, sans liste de champs : Meta refuse certains champs (« Invalid parameter »,
  // sous-code 2388339) sur les comptes du nouveau modèle.
  const describe = (j: Record<string, unknown>) => [j.name, j.id].filter(Boolean).join(" · ") || "accessible";
  steps.push(
    wabaId
      ? await get("Compte WhatsApp (WABA)", id(wabaId), describe)
      : { etape: "Compte WhatsApp (WABA)", ok: false, detail: "Aucun ID de compte WhatsApp (waba_id) sur ce canal." },
    messagingAccountId
      ? await get("Compte de messagerie", id(messagingAccountId), describe)
      : { etape: "Compte de messagerie", ok: false, detail: "Non renseigné sur ce canal (messaging_account_id) : Meta choisit lui-même à l'envoi." },
  );
  // Numéros et apps abonnées : selon le modèle de comptes, ces listes répondent sur le compte de messagerie
  // (ancien ID du WABA) ou sur le WABA. On essaie les deux et on dit lequel a répondu.
  const owners = [...new Set([messagingAccountId, wabaId].filter((v): v is string => Boolean(v)))];
  const label = (owner: string) => (owner === messagingAccountId ? "compte de messagerie" : "WABA");
  const firstOk = async (etape: string, edge: string, show: (json: Record<string, unknown>) => string): Promise<AccessStep> => {
    if (!owners.length) return { etape, ok: false, detail: "Aucun compte renseigné sur ce canal." };
    const errors: string[] = [];
    for (const owner of owners) {
      const step = await get(etape, `${id(owner)}/${edge}`, show);
      if (step.ok) return { ...step, detail: `${step.detail} (via le ${label(owner)})` };
      errors.push(`${label(owner)} : ${step.detail}`);
    }
    return { etape, ok: false, detail: errors.join(" | ") };
  };
  steps.push(
    await firstOk("Numéros du compte", "phone_numbers", (j) => {
      const list = (j.data as { id?: string; display_phone_number?: string }[] | undefined) ?? [];
      const here = list.some((n) => n.id === phoneNumberId);
      return `${list.map((n) => n.display_phone_number ?? n.id).join(", ") || "aucun"}${here ? "" : " ⚠️ le numéro du canal n'est pas dans ce compte"}`;
    }),
    await firstOk("Apps abonnées (webhook)", "subscribed_apps", (j) => {
      const list = (j.data as { whatsapp_business_api_data?: { name?: string; id?: string } }[] | undefined) ?? [];
      return list.map((a) => a.whatsapp_business_api_data?.name ?? a.whatsapp_business_api_data?.id ?? "?").join(", ") || "aucune";
    }),
  );
  return steps;
}

/**
 * Abonne (POST) ou désabonne (DELETE) l'app de ce token aux messages d'un compte WhatsApp (page État).
 * Avec le nouveau modèle de comptes de Meta, c'est l'ID du COMPTE DE MESSAGERIE qui répond (l'ID du
 * « compte WhatsApp » renvoie « Invalid WhatsApp account usage », sous-code 2388339).
 */
export async function setAppSubscription(config: GraphConfig, accountId: string, subscribe: boolean): Promise<{ ok: boolean; detail: string }> {
  const doFetch = config.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const url = `${config.base.replace(/\/$/, "")}/${config.version}/${encodeURIComponent(accountId)}/subscribed_apps`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
  try {
    const response = await doFetch(url, { method: subscribe ? "POST" : "DELETE", headers: { authorization: `Bearer ${config.token}` }, signal: controller.signal });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || json.success === false) return { ok: false, detail: `Refus de Meta (${response.status}) : ${graphErrorText(json)}` };
    return { ok: true, detail: subscribe ? "PFlow Bots est abonnée à ce compte." : "PFlow Bots est désabonnée de ce compte." };
  } catch (error) {
    return { ok: false, detail: `Meta injoignable : ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(timer);
  }
}
