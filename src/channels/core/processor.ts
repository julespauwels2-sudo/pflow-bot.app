/**
 * Traitement d'une notification du webhook : pour chaque message reçu, le moteur décide, puis les
 * réponses partent par l'API Graph. Aucune dépendance à Next.js (testable seul, déplaçable).
 */
import { runEngine, type AiPort, type OrderBridge, type AiRequest, type AiResult, type EngineResult } from "@/engine";
import { createContactToken } from "@/channels/pflow-order/contact-token";
import type { LoadedBot } from "./bot-loader";
import { parseWebhook } from "../whatsapp/parse";
import type { ChannelSender, ChannelStore, InboundEvent, StatusEvent } from "./types";
import { sendOptions } from "./send-options";
import type { Transcriber } from "../voice/transcriber";
import { pflowBaseBot, PFLOW_BOT_ID, PFLOW_TEXTS } from "@/demos/pflow-bot";
import { nextContactDemo, routePflowMessage, type DemoDirectoryEntry } from "@/demos/router";
import { canAlertQuestion, guide, nextParcours } from "@/demos/parcours";

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
  /** Numéro PFlow : démos (mot-clé, expiration) avec le nom du resto. */
  loadDemos?(): Promise<DemoDirectoryEntry[]>;
  /** Transcription des messages vocaux (absente : le bot demande d'écrire, comme avant). */
  transcriber?: Transcriber | null;
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
    report.skipped.push({ wamid: event.wamid, reason: "canal en test, numéro hors liste : rien enregistré" });
    return;
  }
  // Idempotence : un message renvoyé par Meta n'est jamais retraité.
  if (!(await store.claimEvent(event.plateforme, event.wamid, event))) {
    report.skipped.push({ wamid: event.wamid, reason: "déjà reçu" });
    return;
  }

  const contact = await store.getOrCreateContact(canal.id, event.waId, event.profileName);
  event = await transcribeVoice(event, deps, report);
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
  const guidance = guided ? guide(event.message, bot.flows, contact.demo?.parcours, now) : null;
  const engineMessage = guidance ? guidance.message : event.message;

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
  const question = guidance?.question && result.outgoing.length > 0 && canAlertQuestion(contact.demo?.parcours, now) ? guidance.question : null;
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

  for (const e of result.events) {
    if (e.type !== "handoff") continue;
    let gerantPrevenu = false;
    if (canal.telAlerte) {
      // Le gérant n'est prévenu par WhatsApp que si sa propre fenêtre de 24 h est ouverte (sinon Meta refuse).
      try {
        await graph.send(
          canal.accountId,
          canal.telAlerte,
          { kind: "text", text: `🔔 ${bot.client.nomResto} : un client (${event.profileName ?? event.waId}) attend une réponse. Ouvrez la boîte de réception PFlow Bots.` },
          sendOptions(canal),
        );
        gerantPrevenu = true;
      } catch {
        gerantPrevenu = false;
      }
    }
    await store.addTransfert({ canalId: canal.id, contactId: contact.id, source: e.source, dernierMessage: e.message, gerantPrevenu });
  }

  if (question) {
    let gerantPrevenu = false;
    if (canal.telAlerte) {
      try {
        await graph.send(
          canal.accountId,
          canal.telAlerte,
          {
            kind: "text",
            text: `❓ ${bot.client.nomResto} : ${event.profileName ?? event.waId} pose une question pendant la démo : « ${question.slice(0, 500)} ». Le bot continue ; répondez depuis la boîte de réception PFlow Bots.`,
          },
          sendOptions(canal),
        );
        gerantPrevenu = true;
      } catch {
        gerantPrevenu = false;
      }
    }
    // Source « bloc » : les sources possibles sont fixées en base (bot_transferts_source_check), sans migration.
    await store.addTransfert({ canalId: canal.id, contactId: contact.id, source: "bloc", dernierMessage: question.slice(0, 1000), gerantPrevenu });
  }

  report.handled.push({ wamid: event.wamid, outgoing: sent });
  await store.finishEvent(event.plateforme, event.wamid);
}

/**
 * Message vocal : téléchargé puis transcrit ; le moteur reçoit alors le texte comme si le client l'avait
 * écrit. En cas d'échec (service absent, audio inaudible, trop long), le message reste « non lu » et le
 * bot répond comme avant (« je ne peux lire que les messages écrits »).
 */
async function transcribeVoice(event: InboundEvent, deps: ProcessorDeps, report: ProcessReport): Promise<InboundEvent> {
  if (!event.media || event.message.kind !== "unsupported" || event.message.mediaType !== "audio") return event;
  const base = (event.contenu && typeof event.contenu === "object" ? event.contenu : {}) as Record<string, unknown>;
  if (!deps.transcriber || !deps.graph.downloadMedia) return event;
  try {
    const audio = await deps.graph.downloadMedia(event.media);
    const text = (await deps.transcriber.transcribe(audio.data, audio.mimeType)).trim();
    if (!text) return { ...event, contenu: { ...base, erreur: "Vocal inaudible" } };
    return { ...event, message: { kind: "text", text }, contenu: { ...base, texte: `🎤 ${text}`, transcription: text } };
  } catch (error) {
    report.errors.push(`Transcription ${event.wamid} : ${message(error)}`);
    return { ...event, contenu: { ...base, erreur: message(error) } };
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
