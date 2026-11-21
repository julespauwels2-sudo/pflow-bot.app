/**
 * Alertes au gérant (ou à Jules) : « un client attend une réponse », questions sans réponse, alertes techniques.
 *
 * Deux voies en parallèle, sans frais :
 * - l'APPLI iPhone « PFlow » (via le CRM, src/channels/core/crm-alert.ts) : la vraie appli de Jules depuis le 21/11 ;
 * - la NOTIFICATION WEB PUSH sur les appareils abonnés (src/channels/core/push.ts), gardée en plus.
 * L'alerte est « reçue » si au moins une des deux voies l'a prise. Sinon, elle n'est pas perdue :
 * - la conversation reste marquée « 🔔 Attend l'équipe » dans la boîte de réception (transfert ouvert) ;
 * - la page État affiche un bandeau rouge (alertes reçues par aucune des deux voies).
 * Le résultat (push, appli, erreurs) est gardé avec le transfert.
 */
import type { AlertPush, Canal, ChannelStore } from "./types";
import { alertPushPayload, pushConfigFromEnv, sendPushToAll, type PushConfig } from "./push";
import { crmAlertConfigFromEnv, sendCrmAlert, type AppAlertStatut, type CrmAlertConfig } from "./crm-alert";

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
  /** Resto du canal (« PFlow Démo » pour le numéro PFlow) : dans le titre de la notification de l'appli. */
  resto?: string;
  /** Nom de profil et numéro du client. */
  contactName?: string;
  contactId: string;
  /** Dernier message du client (extrait). */
  extrait?: string;
  /** Identifiant de la conversation dans la boîte de réception (le toucher de la notification l'ouvre). */
  conversationId?: string;
}

export interface AlertResult {
  /** Voies qui ont pris l'alerte : Web Push, appli, les deux, ou aucune. */
  voie: "push" | "appli" | "push+appli" | "aucune";
  push: AlertPush;
  appli: AppAlertStatut;
  erreurs: string[];
}

/** Quelqu'un a-t-il été prévenu (appli ou Web Push) ? */
export const alertDelivered = (result: AlertResult) => result.voie !== "aucune";

/** Envoie l'alerte sur l'appli et en Web Push, en parallèle. Ne lève jamais d'erreur. */
export async function sendAlert(deps: { store: ChannelStore; config?: AlertConfig; now: Date }, input: AlertInput): Promise<AlertResult> {
  const [push, appli] = await Promise.all([
    sendPushToAll({ store: deps.store, config: deps.config?.push, now: deps.now }, alertPushPayload(input)),
    sendCrmAlert(deps.config?.crm, input, deps.now),
  ]);
  const parPush = push.statut === "envoyee";
  const parAppli = appli.statut === "posee";
  const voie = parPush && parAppli ? "push+appli" : parPush ? "push" : parAppli ? "appli" : "aucune";
  return { voie, push: push.statut, appli: appli.statut, erreurs: [...push.erreurs, ...(appli.erreur ? [appli.erreur] : [])] };
}
