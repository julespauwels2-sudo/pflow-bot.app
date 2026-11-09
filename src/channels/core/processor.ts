/**
 * Traitement d'une notification du webhook : pour chaque message reçu, le moteur décide, puis les
 * réponses partent par l'API Graph. Aucune dépendance à Next.js (testable seul, déplaçable).
 */
import { createHash } from "node:crypto";
import { runEngine, type AiPort, type OrderBridge, type AiRequest, type AiResult, type EngineResult } from "@/engine";
import { createContactToken } from "@/channels/pflow-order/contact-token";
import type { LoadedBot } from "./bot-loader";
import { parseWebhook } from "../whatsapp/parse";
import type { ChannelSender, ChannelStore, InboundEvent, StatusEvent } from "./types";
import { sendOptions } from "./send-options";
import { DEFAULT_VOICE_LIMITS, type Transcriber, type VoiceLimits } from "../voice/transcriber";
import { audioDurationSeconds } from "../voice/duration";
import { pflowBaseBot, PFLOW_BOT_ID, PFLOW_FLOWS, PFLOW_TEXTS } from "@/demos/pflow-bot";
import { answerDemoQuestion, DEFAULT_DEMO_KNOWLEDGE, forcedStatus, HANDOFF_REPLIES, type DemoAnswer, type DemoCompletion } from "@/demos/demo-knowledge";
import { nextContactDemo, routePflowMessage, type DemoDirectoryEntry } from "@/demos/router";
import { canAlertQuestion, guide, nextParcours } from "@/demos/parcours";
import { DEFAULT_BOTS_URL, demoLinks } from "@/demos/demo-auto";
import { alertDelivered, sendAlert, type AlertConfig, type AlertResult } from "./alerts";

/** Raison notée dans le journal pour un message ignoré parce que le canal est en test (page État). */
export const HORS_LISTE = "canal en test, numéro hors liste";

/** Plafond d'un « en train d'écrire » côté serveur (le webhook ne doit pas attendre trop longtemps). */
export const MAX_TYPING_MS = 3000;

export interface AiCallInfo {
  restaurantId: string;
  request: AiRequest;
  result?: AiResult;
  error?: string;
}

export interface ProcessorDeps {
  store: ChannelStore;
  /** Envoi vers la plateforme de ces événements (WhatsApp ou Instagram). */
  graph: ChannelSender;
  loadBot(restaurantId: string, options?: { demo?: boolean }): Promise<LoadedBot | null>;
  ai?: AiPort;
  /** Journal des appels IA (coût suivi par client). */
  onAiCall?(info: AiCallInfo): Promise<void>;
  now?(): Date;
  sleep?(ms: number): Promise<void>;
  maxTypingMs?: number;
  /** Secret partagé avec PFlow Order : jeton de pré-remplissage dans le lien « Commander ». */
  pflowBotsSecret?: string;
  /** Numéro PFlow Démo : réponses de l'IA à partir de la base de connaissances (absent : pas de clé d'IA). */
  demoAnswer?: DemoCompletion;
  /** Alertes au gérant : notification push (src/channels/core/alerts.ts). */
  alerts?: AlertConfig;
  /** Adresse publique de PFlow Bots (lien du dashboard de la démo permanente). Défaut : DEFAULT_BOTS_URL. */
  demoBotsUrl?: string;
  /** Numéro PFlow : démos (mot-clé, expiration) avec le nom du resto. */
  loadDemos?(): Promise<DemoDirectoryEntry[]>;
  /** Transcription des messages vocaux (absente : le bot demande d'écrire, comme avant). */
  transcriber?: Transcriber | null;
  /** Limites des vocaux : durée maximale, plafond par contact et par jour (défaut : 2 min, 10 par 24 h). */
  voiceLimits?: VoiceLimits;
  /** Pont PFlow Order (suivi, annulation : étape C5). Absent : le bloc Commande répond un texte de repli. */
  orderBridge?: OrderBridge;
}

export interface ProcessReport {
  handled: { wamid: string; outgoing: number }[];
  skipped: { wamid: string; reason: string }[];
  statuses: number;
  errors: string[];
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Notification du webhook WhatsApp. */
export async function processWebhookPayload(payload: unknown, deps: ProcessorDeps): Promise<ProcessReport> {
  return processEvents(parseWebhook(payload), deps);
}

/** Événements déjà lus (WhatsApp ou Instagram). */
export async function processEvents({ inbound, statuses }: { inbound: InboundEvent[]; statuses: StatusEvent[] }, deps: ProcessorDeps): Promise<ProcessReport> {
  const report: ProcessReport = { handled: [], skipped: [], statuses: 0, errors: [] };
  for (const status of statuses) {
    try {
      await deps.store.updateMessageStatus(status.wamid, status.statut, status.erreur);
      report.statuses += 1;
    } catch (error) {
      report.errors.push(`Statut ${status.wamid} : ${message(error)}`);
    }
  }
  for (const event of inbound) {
    try {
      await processInbound(event, deps, report);
    } catch (error) {
      report.errors.push(`Message ${event.wamid} : ${message(error)}`);
      await deps.store.finishEvent(event.plateforme, event.wamid, message(error)).catch(() => undefined);
    }
  }
  return report;
}

async function processInbound(event: InboundEvent, deps: ProcessorDeps, report: ProcessReport): Promise<void> {
  const { store, graph } = deps;
  const skip = async (reason: string) => {
    report.skipped.push({ wamid: event.wamid, reason });
    await store.finishEvent(event.plateforme, event.wamid, reason);
  };

  // Numéro sans canal (ex. un autre numéro du même compte WhatsApp, comme le numéro perso de Jules) :
  // ignoré SANS RIEN ENREGISTRER (ni le message, ni le numéro). Données personnelles : on ne garde que
  // ce qui concerne un canal de PFlow Bots.
  const canal = await store.canalByAccount(event.plateforme, event.accountId);
  if (!canal) {
    report.skipped.push({ wamid: event.wamid, reason: "numéro inconnu (aucun canal) : rien enregistré" });
    return;
  }
  // Canal coupé, ou canal en test et client hors de la liste de test (un vrai client, servi par UChat
  // pendant la bascule) : ignoré SANS RIEN ENREGISTRER (ni événement, ni contact, ni message). Il ne reste
  // que la ligne de journal du webhook, sans numéro (« ignorés : … »), qui sert de compteur.
  if (canal.etat === "coupe") {
    report.skipped.push({ wamid: event.wamid, reason: "canal coupé : rien enregistré" });
    return;
  }
  if (canal.etat === "test" && !canal.testNumeros.includes(event.waId)) {
    // Ni contact, ni message : seulement une trace avec les 4 derniers chiffres (page État, « hors liste de test »),
    // supprimée avec le journal des notifications (30 jours). La clé est une empreinte de l'identifiant du message
    // (le wamid de WhatsApp contient le numéro encodé : il n'est pas gardé).
    const fin = event.waId.slice(-4);
    report.skipped.push({ wamid: event.wamid, reason: `canal en test, numéro hors liste (…${fin}) : message non enregistré` });
    const key = `hors-liste:${createHash("sha256").update(event.wamid).digest("hex").slice(0, 24)}`;
    if (await store.claimEvent(event.plateforme, key, { horsListe: true, fin, canal: canal.id }).catch(() => false)) {
      await store.finishEvent(event.plateforme, key, `${HORS_LISTE} (…${fin})`).catch(() => undefined);
    }
    return;
  }
  // Idempotence : un message renvoyé par Meta n'est jamais retraité.
  if (!(await store.claimEvent(event.plateforme, event.wamid, event))) {
    report.skipped.push({ wamid: event.wamid, reason: "déjà reçu" });
    return;
  }

  const contact = await store.getOrCreateContact(canal.id, event.waId, event.profileName);
  event = await transcribeVoice(event, contact.id, deps, report);
  const echo = event.message.kind === "echo";
  await store.addMessage({
    canalId: canal.id,
    contactId: contact.id,
    sens: echo ? "echo" : "entrant",
    ...(echo ? { auteur: "humain" as const } : {}),
    wamid: event.wamid,
    type: event.type,
    contenu: event.contenu,
    statut: "recu",
  });
  if (event.ignored) return skip(`message ${event.type} : pas de réponse`);

  const now = deps.now ? deps.now() : new Date();
  let bot: LoadedBot | null;
  let resetSession = false;
  if (canal.role === "pflow") {
    // Numéro PFlow : un mot-clé de démo d'abord, puis la démo en cours, sinon le bot PFlow de base.
    const demos = deps.loadDemos ? await deps.loadDemos() : [];
    const route = routePflowMessage({ message: event.message, demos, current: contact.demo, now, sessionMinutes: canal.sessionMinutes });
    const previousBot = contact.demo?.clientId || PFLOW_BOT_ID;
    contact.demo = nextContactDemo(contact.demo, route, now);
    if (route.kind === "ended") {
      const text = PFLOW_TEXTS.demoEnded(route.nomResto);
      try {
        const wamid = await graph.send(canal.accountId, event.waId, { kind: "text", text }, sendOptions(canal));
        await store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "bot", wamid, type: "text", contenu: { kind: "text", text }, statut: "envoye" });
      } catch (error) {
        report.errors.push(`Envoi à ${event.waId} : ${message(error)}`);
      }
      await store.saveContact(contact);
      report.handled.push({ wamid: event.wamid, outgoing: 1 });
      await store.finishEvent(event.plateforme, event.wamid);
      return;
    }
    bot = route.kind === "demo" ? await deps.loadBot(route.clientId, { demo: true }) : pflowBaseBot();
    if (!bot) {
      // Démo sans bot (supprimé, aucun flux publié) : bot PFlow de base.
      contact.demo = nextContactDemo(contact.demo, { kind: "pflow" }, now);
      bot = pflowBaseBot();
    }
    // Autre bot que pour le message précédent (ou démo rouverte par son mot-clé) : on repart de zéro.
    resetSession = (route.kind === "demo" && route.entered) || previousBot !== bot.client.id;
  } else {
    bot = await deps.loadBot(canal.restaurantId);
  }
  if (!bot) return skip("pas de bot actif pour ce resto");

  const stored = resetSession ? null : await store.getSession(contact.id);
  const storedVersion = resetSession ? ((await store.getSession(contact.id))?.version ?? null) : (stored?.version ?? null);
  const ai: AiPort | undefined = deps.ai
    ? async (request) => {
        try {
          const result = await deps.ai!(request);
          await deps.onAiCall?.({ restaurantId: bot.client.id, request, result }).catch(() => undefined);
          return result;
        } catch (error) {
          await deps.onAiCall?.({ restaurantId: bot.client.id, request, error: message(error) }).catch(() => undefined);
          throw error;
        }
      }
    : undefined;

  // Bot PFlow de base : parcours guidé (un mot-clé lance son étape, tout autre message rappelle l'étape en cours).
  const guided = canal.role === "pflow" && bot.client.id === PFLOW_BOT_ID;
  // Liens de la démo permanente avec le jeton de ce contact (confirmation et étape 3 automatiques).
  if (guided) bot.client.vars = demoLinks(contact, canal.id, deps.pflowBotsSecret, deps.demoBotsUrl ?? DEFAULT_BOTS_URL, now);
  const guidance = guided ? guide(event.message, bot.flows, contact.demo?.parcours, now) : null;
  let engineMessage = guidance ? guidance.message : event.message;
  // Politesse, ou question confiée à l'IA (base de connaissances) : le texte de la réponse, et l'alerte à Jules
  // seulement quand l'IA ne sait pas (ou inscription, prix, livraison, demande de Jules).
  let demoAlert: { motif: string } | null = null;
  if (guidance && (guidance.courtesy || guidance.question)) {
    let reponse: string | undefined = guidance.courtesy;
    if (guidance.question && !isPaused(contact.state.pause, now)) {
      const answer = await demoQuestionAnswer(deps, guidance.question, report);
      if (answer?.statut === "repondu") {
        reponse = answer.reponse;
        if (guidance.step === undefined) engineMessage = { kind: "start_flow", flowId: PFLOW_FLOWS.reponseAvantDemo };
      } else if (answer) {
        reponse = HANDOFF_REPLIES[answer.statut].texte;
        demoAlert = { motif: HANDOFF_REPLIES[answer.statut].motif };
        if (guidance.step === undefined) engineMessage = { kind: "start_flow", flowId: `${PFLOW_FLOWS.question}0` };
      } else if (guidance.step !== undefined) {
        // Sans IA (pas de clé) : comme avant, « Bonne question ! » et Jules est prévenu.
        reponse = PFLOW_TEXTS.question;
        demoAlert = { motif: "Question pendant la démo (le bot continue)" };
      }
    }
    if (reponse) bot.client.vars = { ...bot.client.vars, reponse_demo: reponse };
  }

  const result: EngineResult = await runEngine(
    {
      now,
      client: bot.client,
      channel: {
        id: canal.id,
        clientId: bot.client.id,
        // Numéro PFlow : le bot répond toujours (démo ou bot PFlow de base).
        triggerMode: canal.role === "pflow" ? "toujours" : canal.triggerMode,
        echoPauseHours: canal.echoPauseHours,
        handoffPauseHours: canal.handoffPauseHours,
        sessionTimeoutMinutes: canal.sessionMinutes,
        aiDailyLimitPerContact: bot.aiDailyLimit,
      },
      flows: bot.flows,
      infoSheet: bot.infoSheet,
      // Autre bot qu'au message précédent (démo ouverte par son mot-clé…) : nouvelle conversation pour lui
      // (accueil complet), même si le contact vient d'écrire.
      contact: resetSession ? { ...contact.state, lastInboundAt: undefined } : contact.state,
      session: stored?.session ?? null,
      message: engineMessage,
      agent: bot.agent,
      // La page de commande sait que le client vient du bot, et pré-remplit prénom et téléphone.
      // Jamais pour une démo ni le numéro PFlow : page de démonstration, aucune commande réelle.
      ...(canal.role === "pflow" ? {} : { orderLinkQuery: orderLinkQuery(bot, event, deps.pflowBotsSecret) }),
    },
    // Numéro PFlow (démos) : jamais de vraie commande à suivre ou annuler.
    { ai, ...(canal.role === "pflow" ? {} : { orderBridge: deps.orderBridge }) },
  );

  // Accusé de lecture + « en train d'écrire », seulement si le bot répond : un message laissé au gérant
  // (pause, mots-clés uniquement sur son numéro perso) ne doit jamais apparaître « lu » au client.
  if (!echo && result.outgoing.length > 0) await graph.markRead(canal.accountId, event.wamid, true, event.waId).catch(() => undefined);

  let sent = 0;
  const sleep = deps.sleep ?? defaultSleep;
  for (const out of result.outgoing) {
    if (out.kind === "typing") {
      await sleep(Math.min(out.ms, deps.maxTypingMs ?? MAX_TYPING_MS));
      continue;
    }
    try {
      const wamid = await graph.send(canal.accountId, event.waId, out, sendOptions(canal));
      await store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "bot", wamid, type: out.kind, contenu: out, statut: "envoye" });
      sent += 1;
    } catch (error) {
      await store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "bot", type: out.kind, contenu: out, statut: "echec", erreur: message(error) });
      report.errors.push(`Envoi à ${event.waId} : ${message(error)}`);
    }
  }

  // Question en plein parcours : Jules est prévenu (sans pause du bot), une alerte au plus toutes les 30 min. Rien si le
  // bot n'a pas répondu (contact en pause : Jules a déjà la main).
  const question = demoAlert && guidance?.question && result.outgoing.length > 0 && canAlertQuestion(contact.demo?.parcours, now) ? guidance.question : null;
  if (guided) {
    const parcours = nextParcours(contact.demo?.parcours, result.events, now);
    if (parcours) {
      contact.demo = {
        ...(contact.demo ?? { clientId: "", lastAt: now.toISOString(), visited: [] }),
        parcours: question ? { ...parcours, alerteAt: now.toISOString() } : parcours,
      };
    }
  }
  await store.saveContact({ ...contact, state: result.contact });
  if (!(await store.saveSession(contact.id, result.session, storedVersion))) {
    report.errors.push(`Conversation de ${event.waId} modifiée en parallèle : état gardé tel quel`);
  }

  // Alertes au gérant (Jules pour PFlow Démo) : notification push seulement (src/channels/core/alerts.ts). Le
  // transfert ouvert garde l'alerte visible dans la boîte de réception, même si le push n'est pas parti.
  const alertDeps = { store, config: deps.alerts, now };
  const flowsStarted = result.events.flatMap((e) => (e.type === "flow_started" ? [e.flowId] : []));
  for (const e of result.events) {
    if (e.type !== "handoff") continue;
    const alert = await sendAlert(alertDeps, {
      canal,
      motif: handoffMotif(e.source, flowsStarted),
      contactName: event.profileName,
      contactId: event.waId,
      extrait: e.message,
      conversationId: contact.id,
    });
    await store.addTransfert({ canalId: canal.id, contactId: contact.id, source: e.source, dernierMessage: e.message, ...alertFields(alert) });
    if (!alertDelivered(alert)) report.errors.push(`Alerte non envoyée (${canal.id}) : ${alert.erreurs.join(" | ")}`);
  }

  if (question) {
    const alert = await sendAlert(alertDeps, {
      canal,
      motif: demoAlert?.motif ?? "Question pendant la démo (le bot continue)",
      contactName: event.profileName,
      contactId: event.waId,
      extrait: question,
      conversationId: contact.id,
    });
    // Source « bloc » : les sources possibles sont fixées en base (bot_transferts_source_check), sans migration.
    await store.addTransfert({ canalId: canal.id, contactId: contact.id, source: "bloc", dernierMessage: question.slice(0, 1000), ...alertFields(alert) });
    if (!alertDelivered(alert)) report.errors.push(`Alerte non envoyée (${canal.id}) : ${alert.erreurs.join(" | ")}`);
  }

  report.handled.push({ wamid: event.wamid, outgoing: sent });
  await store.finishEvent(event.plateforme, event.wamid);
}

/** Réponses du bot quand un vocal n'est pas transcrit (service configuré). */
export const VOICE_TEXTS = {
  echec: "Je n'ai pas bien compris votre vocal, pouvez-vous l'écrire ?",
  tropLong: (minutes: string) => `Votre vocal est un peu long (plus de ${minutes}) : pouvez-vous l'écrire, ou envoyer un vocal plus court ?`,
  plafond: "J'ai bien reçu votre vocal, mais je ne peux plus en écouter aujourd'hui : pouvez-vous m'écrire votre message ?",
};

const minutesLabel = (seconds: number) => (seconds % 60 === 0 ? `${seconds / 60} minute${seconds / 60 > 1 ? "s" : ""}` : `${seconds} secondes`);

/** Le contact est-il en pause (Jules a la main) ? Pas d'appel à l'IA dans ce cas : le bot ne répondra pas. */
function isPaused(pause: { until: string | null } | null | undefined, now: Date): boolean {
  return Boolean(pause && (pause.until === null || Date.parse(pause.until) > now.getTime()));
}

/**
 * Réponse à une question sur le numéro PFlow Démo (src/demos/demo-knowledge.ts). Livraison, inscription,
 * négociation, demande de Jules : repérées même sans IA. Sans clé d'IA, pour une autre question : null (comme avant).
 */
async function demoQuestionAnswer(deps: ProcessorDeps, question: string, report: ProcessReport): Promise<DemoAnswer | null> {
  const forced = forcedStatus(question);
  if (forced) return { statut: forced, reponse: "" };
  if (!deps.demoAnswer) return null;
  const kb = (await deps.store.getDemoKnowledge().catch(() => null)) ?? DEFAULT_DEMO_KNOWLEDGE;
  try {
    return await answerDemoQuestion(deps.demoAnswer, kb, question);
  } catch (error) {
    report.errors.push(`IA de la démo : ${message(error)}`);
    return { statut: "inconnu", reponse: "" };
  }
}

/**
 * Message vocal : téléchargé (en mémoire seulement, jamais stocké), transcrit, puis traité comme un texte (parcours,
 * mots-clés, IA). Limites : durée maximale, plafond de vocaux transcrits par contact sur 24 h.
 * Sans service configuré : comportement d'avant (« je ne peux lire que les messages écrits » si une question attend).
 * Service configuré mais vocal non transcrit (trop long, plafond, échec) : une réponse claire demande d'écrire.
 */
async function transcribeVoice(event: InboundEvent, contactId: string, deps: ProcessorDeps, report: ProcessReport): Promise<InboundEvent> {
  if (!event.media || event.message.kind !== "unsupported" || event.message.mediaType !== "audio") return event;
  const base = (event.contenu && typeof event.contenu === "object" ? event.contenu : {}) as Record<string, unknown>;
  if (!deps.transcriber || !deps.graph.downloadMedia) return event;
  const limits = deps.voiceLimits ?? DEFAULT_VOICE_LIMITS;
  const now = deps.now ? deps.now() : new Date();
  const refuse = (statut: string, reply: string, extra: Record<string, unknown> = {}): InboundEvent => ({
    ...event,
    message: { kind: "unsupported", mediaType: "audio", reply },
    contenu: { ...base, statut, ...extra },
  });

  // Plafond : vocaux déjà transcrits pour ce contact sur les dernières 24 h (lus dans les messages, sans compteur en base).
  const since = now.getTime() - 24 * 3600_000;
  const recent = await deps.store.listMessages(contactId, 200).catch(() => []);
  const transcribed = recent.filter((m) => m.sens === "entrant" && m.type === "audio" && Date.parse(m.at) >= since && typeof (m.contenu as { transcription?: unknown })?.transcription === "string").length;
  if (transcribed >= limits.maxPerDay) return refuse("plafond", VOICE_TEXTS.plafond, { erreur: `Plafond de ${limits.maxPerDay} vocaux par 24 h atteint` });

  try {
    const audio = await deps.graph.downloadMedia(event.media, event.accountId);
    const seconds = audioDurationSeconds(audio.data, audio.mimeType);
    // Durée inconnue (format autre qu'Ogg Opus) : estimée par la taille, à 32 Ko/s au plus (très large).
    const tooLong = seconds !== null ? seconds > limits.maxSeconds + 0.5 : audio.data.byteLength > limits.maxSeconds * 32_000;
    const duree = seconds !== null ? { duree: Math.round(seconds) } : {};
    if (tooLong) return refuse("trop_long", VOICE_TEXTS.tropLong(minutesLabel(limits.maxSeconds)), { ...duree, erreur: `Vocal trop long (plus de ${minutesLabel(limits.maxSeconds)})` });
    const text = (await deps.transcriber.transcribe(audio.data, audio.mimeType)).trim();
    if (!text) return refuse("echec", VOICE_TEXTS.echec, { ...duree, erreur: "Vocal inaudible" });
    return { ...event, message: { kind: "text", text }, contenu: { ...base, texte: `🎤 ${text}`, transcription: text, statut: "transcrit", ...duree } };
  } catch (error) {
    // Fichier trop lourd (plus de 10 Mo) : refusé au téléchargement, c'est un vocal trop long.
    if (/trop long/i.test(message(error))) return refuse("trop_long", VOICE_TEXTS.tropLong(minutesLabel(limits.maxSeconds)), { erreur: message(error) });
    report.errors.push(`Transcription ${event.wamid} : ${message(error)}`);
    return refuse("echec", VOICE_TEXTS.echec, { erreur: message(error) });
  }
}

function orderLinkQuery(bot: LoadedBot, event: InboundEvent, secret: string | undefined): string {
  // Instagram : pas de numéro de téléphone à transmettre (l'identifiant Instagram n'en est pas un).
  if (event.plateforme === "instagram") return "via=ig";
  if (!secret || !bot.client.orderSlug) return "via=wa";
  const prenom = event.profileName?.trim().split(/\s+/)[0];
  const token = createContactToken({ tel: event.waId, ...(prenom ? { prenom } : {}), slug: bot.client.orderSlug }, secret);
  return `via=wa&wa=${token}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Ce que le transfert garde de l'alerte (page État). */
function alertFields(alert: AlertResult) {
  return {
    gerantPrevenu: alertDelivered(alert),
    alertePush: alert.push,
    ...(alert.erreurs.length ? { alerteErreur: alert.erreurs.join(" | ") } : {}),
  };
}

/** Motif lisible d'un transfert, pour l'alerte. */
function handoffMotif(source: "bloc" | "ia" | "limite_ia" | "erreur_ia", flows: string[]): string {
  if (flows.includes("pflow-mien")) return "Je veux le mien";
  if (flows.includes("pflow-jules")) return "Parler à Jules";
  if (source === "ia") return "L'assistant passe la main";
  if (source === "limite_ia") return "Limite de l'assistant atteinte";
  if (source === "erreur_ia") return "Erreur de l'assistant";
  return "Le client demande une personne";
}
