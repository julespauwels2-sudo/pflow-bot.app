/**
 * Parcours guidé du bot PFlow de base (fonctions pures, partagées par le serveur et le simulateur).
 *
 * L'étape du contact (0 = accueil vu, 1, 2, 3) est gardée avec lui (ContactDemo.parcours). Avant de passer le
 * message au moteur :
 * - un mot-clé du bot PFlow (« tester la démo », « J'ai passé ma commande ✅ », « je veux le mien »…) lance
 *   directement son flux, quelle que soit la longueur du message ;
 * - « c'est fait », « ok »… fait passer à l'étape suivante (étapes 1 et 2) ;
 * - une QUESTION en plein parcours (« ? », ou plus de 4 mots) : « Bonne question ! Jules vous répond très vite »,
 *   Jules est prévenu (WhatsApp + boîte de réception, avec la question ; une alerte au plus toutes les 30 min par
 *   contact), le bot n'est PAS mis en pause, puis l'étape en cours est rappelée ;
 * - tout autre message (salutation comprise) RAPPELLE l'étape en cours, avec son bouton : le prospect ne se
 *   perd jamais. Chaque rappel propose aussi [💬 Parler à Jules]. Sans parcours : l'accueil.
 * Aucune relance automatique : le bot ne parle que quand le prospect écrit.
 */
import { matchKeyword, normalize, type EngineEvent, type Flow, type IncomingMessage } from "@/engine";
import { PFLOW_FLOWS } from "./pflow-bot";

export type ParcoursEtape = 0 | 1 | 2 | 3;

export interface ParcoursState {
  etape: ParcoursEtape;
  /** Dernière activité dans le parcours. */
  at: string;
  /** Dernière alerte « question » envoyée à Jules pour ce contact (anti-doublon). */
  alerteAt?: string;
}

/** Une alerte « question » au plus par contact sur cette durée. */
export const QUESTION_ALERT_MINUTES = 30;

/** Au-delà, le parcours est oublié : le prospect qui revient repart de l'accueil. */
export const PARCOURS_DAYS = 7;

/** Flux lancé → étape atteinte. Les rappels ne changent pas l'étape. */
const STEP_OF_FLOW: Record<string, ParcoursEtape> = {
  [PFLOW_FLOWS.accueil]: 0,
  [PFLOW_FLOWS.etape1]: 1,
  [PFLOW_FLOWS.etape2]: 2,
  [PFLOW_FLOWS.etape3]: 3,
  [PFLOW_FLOWS.commentCaMarche]: 3,
  [PFLOW_FLOWS.mien]: 3,
};

const REMINDER_OF_STEP: Record<ParcoursEtape, string> = {
  0: PFLOW_FLOWS.accueil,
  1: PFLOW_FLOWS.rappel1,
  2: PFLOW_FLOWS.rappel2,
  3: PFLOW_FLOWS.rappel3,
};

const NEXT_OF_STEP: Partial<Record<ParcoursEtape, string>> = { 1: PFLOW_FLOWS.etape2, 2: PFLOW_FLOWS.etape3 };

/** « C'est fait » écrit à la main (sans toucher le bouton). */
const DONE_TEXTS = ["c est fait", "fait", "c est bon", "c bon", "ok", "okay", "ok c est fait", "ok c est bon", "voila", "termine", "j ai fini", "fini", "c fait"];

function activeStep(parcours: ParcoursState | undefined, now: Date): ParcoursEtape | undefined {
  if (!parcours) return undefined;
  return now.getTime() - Date.parse(parcours.at) < PARCOURS_DAYS * 86_400_000 ? parcours.etape : undefined;
}

/** Une question : un « ? », ou plus de 4 mots. */
export function looksLikeQuestion(text: string): boolean {
  return text.includes("?") || normalize(text).split(" ").filter(Boolean).length > 4;
}

export interface GuidedMessage {
  message: IncomingMessage;
  /** Question en plein parcours : son texte (le serveur prévient Jules, sans mettre le bot en pause). */
  question?: string;
}

/** Ce que le moteur doit jouer pour le bot PFlow de base, et s'il faut prévenir Jules. Boutons, médias… : inchangés. */
export function guide(message: IncomingMessage, flows: Flow[], parcours: ParcoursState | undefined, now: Date): GuidedMessage {
  if (message.kind !== "text") return { message };
  const step = activeStep(parcours, now);
  const text = normalize(message.text);
  const next = step === undefined ? undefined : NEXT_OF_STEP[step];
  if (next && DONE_TEXTS.includes(text)) return { message: { kind: "start_flow", flowId: next } };
  const match = matchKeyword(flows, message.text);
  if (match && match.flow.id !== PFLOW_FLOWS.accueil) return { message: { kind: "start_flow", flowId: match.flow.id } };
  if (step !== undefined && looksLikeQuestion(message.text)) {
    return { message: { kind: "start_flow", flowId: `${PFLOW_FLOWS.question}${step}` }, question: message.text.trim() };
  }
  return { message: { kind: "start_flow", flowId: REMINDER_OF_STEP[step ?? 0] } };
}

/** Le message à donner au moteur (voir guide). */
export function guideMessage(message: IncomingMessage, flows: Flow[], parcours: ParcoursState | undefined, now: Date): IncomingMessage {
  return guide(message, flows, parcours, now).message;
}

/** Peut-on prévenir Jules d'une question maintenant (une alerte au plus toutes les 30 min par contact) ? */
export function canAlertQuestion(parcours: ParcoursState | undefined, now: Date): boolean {
  return !parcours?.alerteAt || now.getTime() - Date.parse(parcours.alerteAt) >= QUESTION_ALERT_MINUTES * 60_000;
}

/** L'étape après le passage du moteur (d'après les flux lancés). */
export function nextParcours(parcours: ParcoursState | undefined, events: EngineEvent[], now: Date): ParcoursState | undefined {
  let etape = activeStep(parcours, now);
  let touched = false;
  for (const e of events) {
    if (e.type !== "flow_started" || !e.flowId.startsWith("pflow-")) continue;
    touched = true;
    const step = STEP_OF_FLOW[e.flowId];
    if (step !== undefined) etape = step;
  }
  if (etape === undefined) return undefined;
  return touched || !parcours ? { etape, at: now.toISOString(), ...(parcours?.alerteAt ? { alerteAt: parcours.alerteAt } : {}) } : parcours;
}
