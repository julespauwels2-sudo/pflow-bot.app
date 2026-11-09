/**
 * Alertes au gérant / à Jules : UNE seule voie, la notification push. Jamais de message WhatsApp vers le numéro
 * d'alerte (ni libre, ni modèle Meta), jamais d'e-mail. Sans appareil ou en cas d'échec, l'alerte reste visible dans la
 * boîte de réception (transfert ouvert) et est notée « non reçue » (bandeau rouge de la page État).
 * Faux Meta (serveur local) ; les notifications sont interceptées (le chiffrement est testé dans push.test.ts).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import { loadBotFromWorkspace } from "@/channels/core/bot-loader";
import { listInbox } from "@/channels/core/inbox";
import { createMemoryChannelStore } from "@/channels/core/memory-store";
import { processWebhookPayload } from "@/channels/core/processor";
import type { Canal } from "@/channels/core/types";
import { createGraphClient } from "@/channels/whatsapp/graph";
import { demoDirectory } from "@/demos/lifecycle";
import { alertConfigFromEnv, alertDelivered, sendAlert, type AlertConfig } from "../alerts";

const PHONE = "1000000099";
const ALERTE = "590690938108";
const PROSPECT = "590690111111";

let server: Server;
let base = "";
const sent: { to?: string; type?: string }[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = JSON.parse(body || "{}");
      res.setHeader("content-type", "application/json");
      if (json.type) sent.push(json);
      res.end(JSON.stringify({ messages: [{ id: `wamid.out${sent.length}` }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => vi.restoreAllMocks());

const canal: Canal = {
  id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: PHONE, triggerMode: "toujours", numeroAffiche: "+590 691 26 68 53 (PFlow Démo)",
  coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [], telAlerte: ALERTE,
};
const input = { canal, motif: "Je veux le mien", contactName: "Marc", contactId: PROSPECT, extrait: "C'est combien ?", conversationId: "contact-1" };

/** Notifications interceptées ; `status` : réponse du service push (201 = reçue). */
function fakePush(status = 201) {
  const notifications: { title: string; body: string; url: string }[] = [];
  const config: AlertConfig = {
    push: {
      publicKey: "pub",
      privateKey: "priv",
      subject: "https://pflow-bot-app.vercel.app",
      send: async (_s, payload) => {
        if (status >= 400) throw Object.assign(new Error("Received unexpected response code"), { statusCode: status, body: "erreur du service" });
        notifications.push(JSON.parse(payload));
        return { statusCode: status };
      },
    },
  };
  return { config, notifications };
}

async function withDevice() {
  const store = createMemoryChannelStore([canal]);
  await store.savePushSubscription({ userId: "jules", endpoint: "https://web.push.apple.com/iphone", p256dh: "cle", auth: "auth", appareil: "iPhone (Safari)" });
  return store;
}

describe("alertes : push seulement", () => {
  it("configuration : push si les clés VAPID sont là ; les anciennes variables (modèle Meta, Resend) sont ignorées", () => {
    const env = (vars: Record<string, string>) => (name: string) => vars[name] ?? "";
    expect(alertConfigFromEnv(env({}))).toEqual({});
    expect(alertConfigFromEnv(env({ WHATSAPP_ALERTE_MODELE: "alerte_conversation", RESEND_API_KEY: "re_x", ALERTE_EMAIL: "j@example.com" }))).toEqual({});
    expect(alertConfigFromEnv(env({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" }))).toEqual({
      push: { publicKey: "pub", privateKey: "priv", subject: "https://pflow-bot-app.vercel.app" },
    });
  });

  it("un appareil abonné : notification envoyée, voie « push »", async () => {
    const store = await withDevice();
    const push = fakePush();
    const res = await sendAlert({ store, config: push.config, now: new Date() }, input);
    expect(res).toEqual({ voie: "push", push: "envoyee", erreurs: [] });
    expect(alertDelivered(res)).toBe(true);
    expect(push.notifications).toEqual([{ title: "🔔 Je veux le mien", body: "Marc : « C'est combien ? »", url: "/inbox?contact=contact-1", tag: "conversation-contact-1" }]);
  });

  it("aucun appareil, clés absentes ou push en échec : « aucune », avec la raison ; jamais de WhatsApp ni d'e-mail", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let res = await sendAlert({ store: createMemoryChannelStore([canal]), config: fakePush().config, now: new Date() }, input);
    expect(res).toMatchObject({ voie: "aucune", push: "aucun_abonnement" });
    expect(res.erreurs.join()).toContain("aucun appareil abonné");

    res = await sendAlert({ store: await withDevice(), config: {}, now: new Date() }, input);
    expect(res).toMatchObject({ voie: "aucune", push: "non_configure" });
    expect(res.erreurs.join()).toContain("clés VAPID non définies");

    res = await sendAlert({ store: await withDevice(), config: fakePush(500).config, now: new Date() }, input);
    expect(res).toMatchObject({ voie: "aucune", push: "echec" });
    expect(res.erreurs.join()).toContain("push (iPhone (Safari)) : 500");
    expect(alertDelivered(res)).toBe(false);
    // Aucun appel réseau : ni Meta, ni Resend.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  async function scenario(config: AlertConfig, store = createMemoryChannelStore([canal])) {
    const repos = createLocalRepositories(createMemoryStore(), { now: () => new Date("2026-11-09T15:00:00Z") });
    await createMasterTemplate(repos);
    const data = await repos.workspace.exportAll();
    // Même si Jules vient d'écrire au numéro PFlow (fenêtre de 24 h ouverte), aucune alerte ne part sur WhatsApp.
    const jules = await store.getOrCreateContact("pflow", ALERTE, "Jules");
    await store.saveContact({ ...jules, state: { ...jules.state, lastInboundAt: "2026-11-09T14:00:00Z" } });
    const deps = {
      store,
      graph: createGraphClient({ token: "t", base, version: "v24.0" }),
      loadBot: async (id: string, options?: { demo?: boolean }) => loadBotFromWorkspace(data, id, options),
      loadDemos: async () => demoDirectory(data),
      now: () => new Date("2026-11-09T15:00:00Z"),
      sleep: async () => {},
      alerts: config,
    };
    const from = sent.length;
    const report = await processWebhookPayload(
      {
        object: "whatsapp_business_account",
        entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE }, contacts: [{ wa_id: PROSPECT, profile: { name: "Marc" } }], messages: [{ from: PROSPECT, id: `wamid.alerte.${Math.random()}`, type: "text", text: { body: "Je veux le mien" } }] } }] }],
      },
      deps,
    );
    const whatsapp = sent.slice(from);
    const inbox = await listInbox(store, data, new Date("2026-11-09T15:00:00Z"));
    const conversation = inbox.flatMap((c) => c.conversations).find((c) => c.waId === PROSPECT)!;
    return { report, whatsapp, transfert: (await store.listTransferts("pflow"))[0], conversation };
  }

  it("de bout en bout, appareil abonné : notification qui ouvre la conversation ; rien vers le numéro de Jules", async () => {
    const push = fakePush();
    const r = await scenario(push.config, await withDevice());
    expect(r.report.errors).toEqual([]);
    expect(r.whatsapp.length).toBeGreaterThan(0); // la réponse au prospect
    expect(r.whatsapp.some((m) => m.to === ALERTE || m.type === "template")).toBe(false);
    expect(r.transfert).toMatchObject({ gerantPrevenu: true, alertePush: "envoyee" });
    expect(r.transfert.alerteVoie).toBeUndefined();
    expect(push.notifications[0].url).toBe(`/inbox?contact=${r.transfert.contactId}`);
    expect(r.conversation.transfertOuvert).toBe(true);
  });

  it("de bout en bout, aucun appareil : alerte non reçue mais visible dans la boîte de réception ; rien vers le numéro de Jules", async () => {
    const r = await scenario(fakePush().config);
    expect(r.whatsapp.some((m) => m.to === ALERTE || m.type === "template")).toBe(false);
    expect(r.transfert).toMatchObject({ gerantPrevenu: false, alertePush: "aucun_abonnement" });
    expect(r.transfert.alerteErreur).toContain("aucun appareil abonné");
    expect(r.report.errors.join()).toContain("Alerte non envoyée");
    // La conversation reste marquée « 🔔 Attend l'équipe ».
    expect(r.conversation.transfertOuvert).toBe(true);
  });
});
