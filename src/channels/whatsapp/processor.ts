/**
 * Traitement d'une notification du webhook : pour chaque message reçu, le moteur décide, puis les
 * réponses partent par l'API Graph. Aucune dépendance à Next.js (testable seul, déplaçable).
 */
import { runEngine, type AiPort, type AiRequest, type AiResult, type EngineResult } from "@/engine";
import { createContactToken } from "@/channels/pflow-order/contact-token";
import type { LoadedBot } from "./bot-loader";
import type { GraphClient } from "./graph";
import { parseWebhook } from "./parse";
import type { ChannelStore, InboundEvent } from "./types";

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
  graph: Pick<GraphClient, "send" | "markRead">;
  loadBot(restaurantId: string): Promise<LoadedBot | null>;
  ai?: AiPort;
  /** Journal des appels IA (coût suivi par client). */
  onAiCall?(info: AiCallInfo): Promise<void>;
  now?(): Date;
  sleep?(ms: number): Promise<void>;
  maxTypingMs?: number;
  /** Secret partagé avec PFlow Order : jeton de pré-remplissage dans le lien « Commander ». */
  pflowBotsSecret?: string;
}

export interface ProcessReport {
  handled: { wamid: string; outgoing: number }[];
  skipped: { wamid: string; reason: string }[];
  statuses: number;
  errors: string[];
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function processWebhookPayload(payload: unknown, deps: ProcessorDeps): Promise<ProcessReport> {
  const report: ProcessReport = { handled: [], skipped: [], statuses: 0, errors: [] };
  const { inbound, statuses } = parseWebhook(payload);
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
      await deps.store.finishEvent("whatsapp", event.wamid, message(error)).catch(() => undefined);
    }
  }
  return report;
}

async function processInbound(event: InboundEvent, deps: ProcessorDeps, report: ProcessReport): Promise<void> {
  const { store, graph } = deps;
  const skip = async (reason: string) => {
    report.skipped.push({ wamid: event.wamid, reason });
    await store.finishEvent("whatsapp", event.wamid, reason);
  };

  // Idempotence : un message renvoyé par Meta n'est jamais retraité.
  if (!(await store.claimEvent("whatsapp", event.wamid, event))) {
    report.skipped.push({ wamid: event.wamid, reason: "déjà reçu" });
    return;
  }
  const canal = await store.canalByPhone(event.phoneNumberId);
  if (!canal) return skip("numéro inconnu (aucun canal)");
  if (canal.etat === "coupe") return skip("canal coupé");
  if (canal.etat === "test" && !canal.testNumeros.includes(event.waId)) return skip("canal en test : numéro hors liste");

  const echo = event.message.kind === "echo";
  const contact = await store.getOrCreateContact(canal.id, event.waId, event.profileName);
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

  const bot = await deps.loadBot(canal.restaurantId);
  if (!bot) return skip("pas de bot actif pour ce resto");

  const stored = await store.getSession(contact.id);
  const ai: AiPort | undefined = deps.ai
    ? async (request) => {
        try {
          const result = await deps.ai!(request);
          await deps.onAiCall?.({ restaurantId: canal.restaurantId, request, result }).catch(() => undefined);
          return result;
        } catch (error) {
          await deps.onAiCall?.({ restaurantId: canal.restaurantId, request, error: message(error) }).catch(() => undefined);
          throw error;
        }
      }
    : undefined;

  const result: EngineResult = await runEngine(
    {
      now: deps.now ? deps.now() : new Date(),
      client: bot.client,
      channel: {
        id: canal.id,
        clientId: canal.restaurantId,
        triggerMode: canal.triggerMode,
        echoPauseHours: canal.echoPauseHours,
        handoffPauseHours: canal.handoffPauseHours,
        sessionTimeoutMinutes: canal.sessionMinutes,
        aiDailyLimitPerContact: bot.aiDailyLimit,
      },
      flows: bot.flows,
      infoSheet: bot.infoSheet,
      contact: contact.state,
      session: stored?.session ?? null,
      message: event.message,
      agent: bot.agent,
      // La page de commande sait que le client vient du bot, et pré-remplit prénom et téléphone.
      orderLinkQuery: orderLinkQuery(bot, event, deps.pflowBotsSecret),
    },
    { ai },
  );

  // Accusé de lecture (+ « en train d'écrire » s'il y a une réponse).
  if (!echo) await graph.markRead(canal.phoneNumberId, event.wamid, result.outgoing.length > 0).catch(() => undefined);

  let sent = 0;
  const sleep = deps.sleep ?? defaultSleep;
  for (const out of result.outgoing) {
    if (out.kind === "typing") {
      await sleep(Math.min(out.ms, deps.maxTypingMs ?? MAX_TYPING_MS));
      continue;
    }
    try {
      const wamid = await graph.send(canal.phoneNumberId, event.waId, out);
      await store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "bot", wamid, type: out.kind, contenu: out, statut: "envoye" });
      sent += 1;
    } catch (error) {
      await store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "bot", type: out.kind, contenu: out, statut: "echec", erreur: message(error) });
      report.errors.push(`Envoi à ${event.waId} : ${message(error)}`);
    }
  }

  await store.saveContact({ ...contact, state: result.contact });
  if (!(await store.saveSession(contact.id, result.session, stored?.version ?? null))) {
    report.errors.push(`Conversation de ${event.waId} modifiée en parallèle : état gardé tel quel`);
  }

  for (const e of result.events) {
    if (e.type !== "handoff") continue;
    let gerantPrevenu = false;
    if (canal.telAlerte) {
      // Le gérant n'est prévenu par WhatsApp que si sa propre fenêtre de 24 h est ouverte (sinon Meta refuse).
      try {
        await graph.send(canal.phoneNumberId, canal.telAlerte, {
          kind: "text",
          text: `🔔 ${bot.client.nomResto} : un client (${event.profileName ?? event.waId}) attend une réponse. Ouvrez la boîte de réception PFlow Bots.`,
        });
        gerantPrevenu = true;
      } catch {
        gerantPrevenu = false;
      }
    }
    await store.addTransfert({ canalId: canal.id, contactId: contact.id, source: e.source, dernierMessage: e.message, gerantPrevenu });
  }

  report.handled.push({ wamid: event.wamid, outgoing: sent });
  await store.finishEvent("whatsapp", event.wamid);
}

function orderLinkQuery(bot: LoadedBot, event: InboundEvent, secret: string | undefined): string {
  if (!secret || !bot.client.orderSlug) return "via=wa";
  const prenom = event.profileName?.trim().split(/\s+/)[0];
  const token = createContactToken({ tel: event.waId, ...(prenom ? { prenom } : {}), slug: bot.client.orderSlug }, secret);
  return `via=wa&wa=${token}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
