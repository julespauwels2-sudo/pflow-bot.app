/**
 * Alertes au gérant (ou à Jules pour le numéro PFlow Démo) : « un client attend une réponse ».
 *
 * Une seule voie, sans frais : la NOTIFICATION PUSH sur les appareils abonnés (iPhone avec l'app installée,
 * ordinateur ; src/channels/core/push.ts). Pas de message WhatsApp vers le numéro d'alerte (ni libre, ni modèle Meta),
 * pas d'e-mail.
 * Si aucun appareil n'est abonné ou si le push échoue, l'alerte n'est pas perdue :
 * - la conversation reste marquée « 🔔 Attend l'équipe » dans la boîte de réception (transfert ouvert) ;
 * - la page État affiche un bandeau rouge (alertes non reçues).
 * Le résultat (voie push, erreurs) est gardé avec le transfert.
 */
import type { AlertPush, Canal, ChannelStore } from "./types";
import { alertPushPayload, pushConfigFromEnv, sendPushToAll, type PushConfig } from "./push";
import { crmAlertConfigFromEnv, sendCrmAlert, type CrmAlertConfig } from "./crm-alert";

export interface AlertConfig {
  /** Notifications push (clés VAPID). Absent : « non_configure », l'alerte reste dans la boîte de réception. */
  push?: PushConfig;
  /** L'appli iPhone « PFlow » de Jules, via le CRM (src/channels/core/crm-alert.ts). Facultatif. */
  crm?: CrmAlertConfig;
}

export function alertConfigFromEnv(env: (name: string) => string): AlertConfig {
  const push = pushConfigFromEnv(env);
  const crm = crmAlertConfigFromEnv(env);
  return { ...(push ? { push } : {}), ...(crm ? { crm } : {}) };
}

export interface AlertInput {
  canal: Canal;
  /** Motif court : « Je veux le mien », « Parler à Jules », « Question pendant la démo »… */
  motif: string;
  /** Nom de profil et numéro du client. */
  contactName?: string;
  contactId: string;
  /** Dernier message du client (extrait). */
  extrait?: string;
  /** Identifiant de la conversation dans la boîte de réception (le toucher de la notification l'ouvre). */
  conversationId?: string;
}

export interface AlertResult {
  /** « push » si au moins un appareil a reçu la notification, sinon « aucune ». */
  voie: "push" | "aucune";
  push: AlertPush;
  erreurs: string[];
}

/** Quelqu'un a-t-il été prévenu ? */
export const alertDelivered = (result: AlertResult) => result.voie === "push";

/** Envoie l'alerte en notification push. Ne lève jamais d'erreur. */
export async function sendAlert(deps: { store: ChannelStore; config?: AlertConfig; now: Date }, input: AlertInput): Promise<AlertResult> {
  const [push] = await Promise.all([
    sendPushToAll({ store: deps.store, config: deps.config?.push, now: deps.now }, alertPushPayload(input)),
    // en plus, au mieux : l'appli iPhone de Jules (ne change pas le résultat ci-dessous)
    sendCrmAlert(deps.config?.crm, input),
  ]);
  return { voie: push.statut === "envoyee" ? "push" : "aucune", push: push.statut, erreurs: push.erreurs };
}
