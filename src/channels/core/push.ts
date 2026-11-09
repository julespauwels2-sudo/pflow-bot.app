/**
 * Notifications push de la boîte de réception (Web Push standard, clés VAPID ; aucun service payant).
 *
 * - Les clés VAPID sont dans les variables Vercel (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY ; VAPID_SUBJECT facultatif),
 *   jamais dans le code. Sans elles : « non_configure », l'alerte reste visible dans la boîte de réception et la page
 *   État affiche un bandeau rouge.
 * - Chaque appareil abonné (bot_push_abonnements) reçoit la notification ; le contenu est chiffré de bout en bout
 *   (seul le navigateur abonné peut le lire), le service push d'Apple / Google / Mozilla ne le voit pas.
 * - Un abonnement expiré ou révoqué (404 / 410 du service push) est supprimé.
 * - Toucher la notification ouvre /inbox?contact=… (public/sw.js).
 */
import webpush from "web-push";
import type { AlertPush, ChannelStore, PushSubscriptionRecord } from "./types";
import { DEFAULT_BOTS_URL } from "@/demos/demo-auto";

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** « mailto:… » ou adresse https (exigé par Apple). */
  subject: string;
  /** Envoi d'une notification (par défaut : web-push). Remplacé dans les tests. */
  send?: (subscription: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => Promise<{ statusCode: number }>;
}

export function pushConfigFromEnv(env: (name: string) => string): PushConfig | undefined {
  const publicKey = env("VAPID_PUBLIC_KEY");
  const privateKey = env("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return undefined;
  // VAPID_SUBJECT facultatif : par défaut, l'adresse publique de PFlow Bots (une adresse https est acceptée par Apple,
  // Google et Mozilla, comme un « mailto: »).
  return { publicKey, privateKey, subject: env("VAPID_SUBJECT") || env("PFLOW_BOTS_PUBLIC_URL") || DEFAULT_BOTS_URL };
}

/** Ce que reçoit le service worker (public/sw.js). Court : la limite d'Apple est de 4 Ko. */
export interface PushPayload {
  title: string;
  body: string;
  /** Page ouverte au toucher (même origine). */
  url: string;
  /** Les notifications de même étiquette se remplacent (une par conversation). */
  tag?: string;
}

export interface PushResult {
  statut: AlertPush;
  /** Appareils atteints. */
  envoyes: number;
  erreurs: string[];
}

/** Coupe sur une ligne, avec « … ». */
function oneLine(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** La notification d'une alerte : motif en titre, contact et extrait du message, ouverture de la conversation. */
export function alertPushPayload(input: { motif: string; contactName?: string; contactId: string; extrait?: string; conversationId?: string }): PushPayload {
  const nom = input.contactName?.trim() || `+${input.contactId}`;
  const extrait = input.extrait?.trim() ? ` : « ${oneLine(input.extrait, 140)} »` : " attend une réponse.";
  return {
    title: `🔔 ${oneLine(input.motif, 60)}`,
    body: `${oneLine(nom, 60)}${extrait}`,
    url: input.conversationId ? `/inbox?contact=${encodeURIComponent(input.conversationId)}` : "/inbox",
    tag: `conversation-${input.conversationId ?? input.contactId}`,
  };
}

const defaultSend: NonNullable<PushConfig["send"]> = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options);

const statusOf = (error: unknown) => (typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode: unknown }).statusCode) : 0);
const errorText = (error: unknown) => {
  const status = statusOf(error);
  const body = typeof error === "object" && error && "body" in error ? String((error as { body: unknown }).body ?? "").slice(0, 120) : "";
  const text = error instanceof Error ? error.message : String(error);
  return `${status ? `${status} ` : ""}${body || text}`.slice(0, 200);
};

/** Le service push du navigateur (pour les messages d'erreur : jamais l'adresse complète, qui identifie l'appareil). */
const pushService = (endpoint: string) => {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return "service inconnu";
  }
};

/**
 * Envoie la notification à tous les appareils abonnés (ceux d'un compte si userId est donné). Ne lève jamais d'erreur.
 * Les envois partent en parallèle ; « envoyee » dès qu'un appareil est atteint.
 */
export async function sendPushToAll(
  deps: { store: ChannelStore; config?: PushConfig; now: Date },
  payload: PushPayload,
  options: { userId?: string } = {},
): Promise<PushResult> {
  if (!deps.config) return { statut: "non_configure", envoyes: 0, erreurs: ["push : clés VAPID non définies (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)"] };
  let subscriptions: PushSubscriptionRecord[];
  try {
    subscriptions = await deps.store.listPushSubscriptions(options.userId);
  } catch (error) {
    return { statut: "echec", envoyes: 0, erreurs: [`push : abonnements illisibles (${errorText(error)})`] };
  }
  if (!subscriptions.length) return { statut: "aucun_abonnement", envoyes: 0, erreurs: ["push : aucun appareil abonné (bouton « Activer les notifications »)"] };

  const { publicKey, privateKey, subject } = deps.config;
  const send = deps.config.send ?? defaultSend;
  const body = JSON.stringify(payload);
  const at = deps.now.toISOString();
  const erreurs: string[] = [];
  const results = await Promise.all(
    subscriptions.map(async (s) => {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          vapidDetails: { subject, publicKey, privateKey },
          // Une alerte n'a plus de sens après une journée ; « high » : réveille l'iPhone tout de suite.
          TTL: 24 * 3600,
          urgency: "high",
          timeout: 8000,
        });
        await deps.store.savePushSubscription({ ...s, dernierEnvoiLe: at }).catch(() => undefined);
        return true;
      } catch (error) {
        const status = statusOf(error);
        if (status === 404 || status === 410) {
          // Abonnement expiré ou notifications désactivées sur l'appareil : on l'oublie.
          await deps.store.deletePushSubscription(s.endpoint).catch(() => undefined);
          erreurs.push(`push : abonnement expiré supprimé (${s.appareil || pushService(s.endpoint)})`);
        } else {
          const text = errorText(error);
          await deps.store.savePushSubscription({ ...s, dernierEchecLe: at, dernierEchec: text }).catch(() => undefined);
          erreurs.push(`push (${s.appareil || pushService(s.endpoint)}) : ${text}`);
        }
        return false;
      }
    }),
  );
  const envoyes = results.filter(Boolean).length;
  return { statut: envoyes > 0 ? "envoyee" : "echec", envoyes, erreurs };
}
