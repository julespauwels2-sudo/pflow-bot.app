/**
 * Événements de commande envoyés par PFlow Order (patches docs/etape-c/patches/01 et 02, route
 * /api/webhooks/pflow-order). PFlow Order demande « prends-tu cet événement ? » avant UChat :
 * - pris: true  → PFlow Bots a traité (envoyé, ou ignoré : client inconnu, fenêtre de 24 h fermée…) ;
 * - pris: false → UChat s'en occupe, exactement comme avant.
 *
 * GARDE-FOU ABSOLU : un événement de vraie commande n'est pris QUE si le resto a un canal WhatsApp en
 * état « actif ». Canal « test » ou « coupé », aucun canal : pris: false. PFlow Order vérifie la même
 * règle avant d'appeler (qg66, pflow_bots_canal_actif) : double barrière.
 * Seule exception : une SIMULATION (simulation: true, envoyée par la page État de PFlow Bots, jamais par
 * PFlow Order) vers un numéro de la liste de test d'un canal en test.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { runEngine, type AiPort, type OrderEvent } from "@/engine";
import type { LoadedBot } from "../core/bot-loader";
import { maskId } from "../core/privacy";
import { sendOptions } from "../core/send-options";
import type { Canal, ChannelSender, ChannelStore } from "../core/types";

/** PFlow Order refuse d'attendre plus de 8 s ; une signature de plus de 5 min est refusée. */
export const ORDER_SIGNATURE_MAX_AGE_SECONDS = 300;

/** Événements PFlow Order → événements des flux PFlow Bots (même table que le patch 01). */
export const PFLOW_ORDER_EVENTS: Record<string, OrderEvent | undefined> = {
  commande: "commande_validee",
  paiement: "commande_validee",
  en_preparation: "commande_en_preparation",
  prete: "commande_prete",
};

const text = (max: number) => z.string().max(max);
const variables = z.record(z.string(), text(2000)).optional();

const commandeSchema = z.object({
  type: z.literal("commande"),
  restaurant_id: z.string().uuid(),
  slug: text(200).optional(),
  client_tel: z.string().regex(/^\d{6,20}$/),
  commande_id: text(100).optional(),
  evenements: z.array(z.object({ pflow_order: text(60), pflow_bots: text(60).optional() })).min(1).max(10),
  variables,
  champs: variables,
  simulation: z.boolean().optional(),
});

const relanceSchema = z.object({
  type: z.literal("option"),
  option: z.literal("relance"),
  restaurant_id: z.string().uuid(),
  slug: text(200).optional(),
  client_tel: z.string().regex(/^\d{6,20}$/),
  client_nom: text(200).optional(),
  panier: z.object({ recap: text(2000).optional(), total: text(60).optional(), lien: text(1000).optional() }),
  test: z.boolean().optional(),
  simulation: z.boolean().optional(),
});

export const orderPayloadSchema = z.discriminatedUnion("type", [commandeSchema, relanceSchema]);
export type OrderPayload = z.infer<typeof orderPayloadSchema>;

export interface OrderEnvoi {
  etat: "ok" | "ignore" | "echec";
  detail: string;
}

export type OrderResponse = { pris: true; envois: Record<string, OrderEnvoi> } | { pris: false; raison: string };

/** Signature de PFlow Order : sha256=HMAC-SHA256(secret, horodatage + "." + corps). */
export function signOrderPayload(body: string, secret: string, timestamp: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function verifyOrderSignature(body: string, timestamp: string | null, signature: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!timestamp || !signature || !/^\d{9,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > ORDER_SIGNATURE_MAX_AGE_SECONDS) return false;
  const expected = Buffer.from(signOrderPayload(body, secret, timestamp));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface OrderDeps {
  store: ChannelStore;
  graph: ChannelSender;
  loadBot(restaurantId: string): Promise<LoadedBot | null>;
  ai?: AiPort;
  now?(): Date;
}

/** Canal WhatsApp du resto qui peut recevoir cet événement, ou la raison du refus (pris: false). */
export async function orderCanal(payload: OrderPayload, store: ChannelStore): Promise<{ canal: Canal } | { raison: string }> {
  const canaux = (await store.listCanaux()).filter((c) => c.restaurantId === payload.restaurant_id && c.plateforme === "whatsapp" && (c.role ?? "resto") === "resto");
  const actif = canaux.find((c) => c.etat === "actif");
  if (actif) return { canal: actif };
  // Simulation (page État de PFlow Bots) : canal en test, numéro de la liste de test seulement.
  const test = canaux.find((c) => c.etat === "test");
  if (payload.simulation && test) {
    return test.testNumeros.includes(payload.client_tel) ? { canal: test } : { raison: "simulation : numéro hors liste de test" };
  }
  if (test) return { raison: "canal en test : la vraie commande reste à UChat" };
  if (canaux.some((c) => c.etat === "coupe")) return { raison: "canal coupé" };
  return { raison: "aucun canal PFlow Bots" };
}

/** Événements à jouer (PFlow Order → flux), sans doublon : « commande » + « paiement » = un seul message. */
function plan(payload: OrderPayload): { cles: string[]; event?: OrderEvent; data: Record<string, string> }[] {
  if (payload.type === "option") {
    return [
      {
        cles: ["relance"],
        event: "panier_abandonne",
        data: {
          client_nom: payload.client_nom ?? "",
          panier_recap: payload.panier.recap ?? "",
          panier_total: payload.panier.total ?? "",
          ...(payload.panier.lien ? { lien_panier: payload.panier.lien } : {}),
        },
      },
    ];
  }
  const data: Record<string, string> = { ...(payload.variables ?? {}) };
  const steps: { cles: string[]; event?: OrderEvent; data: Record<string, string> }[] = [];
  for (const e of payload.evenements) {
    const event = PFLOW_ORDER_EVENTS[e.pflow_order];
    const same = event && steps.find((s) => s.event === event);
    if (same) same.cles.push(e.pflow_order);
    else steps.push({ cles: [e.pflow_order], event, data });
  }
  return steps;
}

export async function handleOrderEvent(payload: OrderPayload, deps: OrderDeps): Promise<OrderResponse> {
  const found = await orderCanal(payload, deps.store);
  if ("raison" in found) return { pris: false, raison: found.raison };
  const { canal } = found;
  const envois: Record<string, OrderEnvoi> = {};
  const note = (cles: string[], envoi: OrderEnvoi) => cles.forEach((k) => (envois[k] = envoi));
  const steps = plan(payload);

  const bot = await deps.loadBot(canal.restaurantId);
  if (!bot) {
    steps.forEach((s) => note(s.cles, { etat: "echec", detail: "pas de bot actif pour ce resto" }));
    return { pris: true, envois };
  }
  // Client qui n'a jamais écrit au bot : pas de contact créé, rien envoyé (fenêtre de 24 h fermée).
  const contact = (await deps.store.listContacts(canal.id)).find((c) => c.waId === payload.client_tel);
  if (!contact) {
    steps.forEach((s) => note(s.cles, { etat: "ignore", detail: "le client n'a jamais écrit au bot (fenêtre de 24 h fermée)" }));
    return { pris: true, envois };
  }

  // Idempotence : un même événement d'une même commande n'est envoyé qu'une fois (PFlow Order peut rejouer).
  const idKey = (cles: string[]) => (payload.type === "commande" && payload.commande_id && !payload.simulation ? `${payload.commande_id}:${cles.join("+")}` : null);

  for (const step of steps) {
    if (!step.event) {
      note(step.cles, { etat: "ignore", detail: `événement « ${step.cles.join(", ")} » pas encore géré par PFlow Bots` });
      continue;
    }
    const key = idKey(step.cles);
    if (key && !(await deps.store.claimEvent("pflow_order", key, { ...payload, client_tel: maskId(payload.client_tel) }))) {
      note(step.cles, { etat: "ok", detail: "déjà envoyé" });
      continue;
    }
    const stored = await deps.store.getSession(contact.id);
    const current = (await deps.store.getContact(contact.id)) ?? contact;
    const result = await runEngine(
      {
        now: deps.now ? deps.now() : new Date(),
        client: bot.client,
        channel: {
          id: canal.id,
          clientId: bot.client.id,
          triggerMode: canal.triggerMode,
          echoPauseHours: canal.echoPauseHours,
          handoffPauseHours: canal.handoffPauseHours,
          sessionTimeoutMinutes: canal.sessionMinutes,
          aiDailyLimitPerContact: bot.aiDailyLimit,
        },
        flows: bot.flows,
        infoSheet: bot.infoSheet,
        contact: current.state,
        session: stored?.session ?? null,
        message: { kind: "event", event: step.event, data: step.data },
        agent: bot.agent,
      },
      { ai: deps.ai },
    );
    const ignored = result.events.find((e) => e.type === "ignored");
    const outgoing = result.outgoing.filter((m) => m.kind !== "typing");
    if (!outgoing.length) {
      const reason = ignored && "reason" in ignored ? ignored.reason : "aucun message";
      const detail = reason === "fenetre_fermee" ? "fenêtre de 24 h fermée" : reason === "aucun_flux_evenement" ? "aucun flux pour cet événement" : reason;
      note(step.cles, { etat: "ignore", detail });
      if (key) await deps.store.finishEvent("pflow_order", key, detail);
      continue;
    }
    const errors: string[] = [];
    for (const out of outgoing) {
      try {
        const wamid = await deps.graph.send(canal.accountId, payload.client_tel, out, sendOptions(canal));
        await deps.store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "bot", wamid, type: out.kind, contenu: out, statut: "envoye" });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(msg);
        await deps.store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "bot", type: out.kind, contenu: out, statut: "echec", erreur: msg });
      }
    }
    await deps.store.saveContact({ ...current, state: result.contact });
    await deps.store.saveSession(contact.id, result.session, stored?.version ?? null);
    const flow = result.events.find((e) => e.type === "flow_started");
    const flowName = flow && "flowId" in flow ? (bot.flows.find((f) => f.id === flow.flowId)?.name ?? flow.flowId) : step.event;
    note(
      step.cles,
      errors.length
        ? { etat: "echec", detail: `flux « ${flowName} » : ${maskId(errors[0]).slice(0, 160)}` }
        : { etat: "ok", detail: `flux « ${flowName} »${payload.simulation ? " (simulation)" : ""}` },
    );
    if (key) await deps.store.finishEvent("pflow_order", key, errors.length ? maskId(errors[0]) : undefined);
  }
  return { pris: true, envois };
}
