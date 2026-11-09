/**
 * Notifications push (Web Push, VAPID) : chiffrement réel vérifié (on déchiffre comme le ferait l'iPhone), ordre des
 * alertes (WhatsApp et push en parallèle, e-mail seulement si les deux échouent), abonnements expirés, routes /api/push.
 * Aucun vrai service push : les clés VAPID sont générées pour le test, les envois sont interceptés ou locaux.
 */
import { createECDH, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import webpush from "web-push";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import { loadBotFromWorkspace } from "@/channels/core/bot-loader";
import { createMemoryChannelStore } from "@/channels/core/memory-store";
import { processWebhookPayload } from "@/channels/core/processor";
import type { Canal, ChannelSender } from "@/channels/core/types";
import { demoDirectory } from "@/demos/lifecycle";
import { alertDelivered, sendAlert, type AlertConfig } from "../alerts";
import { alertPushPayload, pushConfigFromEnv, sendPushToAll, type PushConfig } from "../push";
import { deviceLabel, vapidKeyBytes } from "@/components/pwa";

const vapid = webpush.generateVAPIDKeys();

/** Un faux navigateur abonné : ses clés (p256dh, auth) et de quoi déchiffrer ce qu'il reçoit (RFC 8291). */
function fakeBrowser(endpoint = `https://web.push.apple.com/${randomBytes(8).toString("hex")}`) {
  const ecdh = createECDH("prime256v1");
  const publicKey = ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    endpoint,
    p256dh: publicKey.toString("base64url"),
    auth: auth.toString("base64url"),
    decrypt(body: Buffer): string {
      const salt = body.subarray(0, 16);
      const idlen = body[20];
      const serverKey = body.subarray(21, 21 + idlen);
      const ciphertext = body.subarray(21 + idlen);
      const shared = ecdh.computeSecret(serverKey);
      const ikm = Buffer.from(hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), publicKey, serverKey]), 32));
      const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
      const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
      const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
      decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
      const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
      // Dernier enregistrement : délimiteur 0x02 puis remplissage.
      return plain.subarray(0, plain.lastIndexOf(2)).toString("utf8");
    },
  };
}

/** Envoi intercepté : la vraie requête web-push (chiffrement + signature VAPID) est construite, pas envoyée. */
function capture(status: (endpoint: string) => number = () => 201) {
  const requests: { endpoint: string; headers: Record<string, string | number>; body: Buffer }[] = [];
  const send: NonNullable<PushConfig["send"]> = async (subscription, payload, options) => {
    const details = webpush.generateRequestDetails(subscription, payload, options);
    requests.push({ endpoint: details.endpoint, headers: details.headers as Record<string, string | number>, body: details.body as Buffer });
    const code = status(subscription.endpoint);
    if (code >= 400) throw new webpush.WebPushError("Received unexpected response code", code, {}, code === 410 ? "push subscription has unsubscribed or expired." : "erreur du service", subscription.endpoint);
    return { statusCode: code };
  };
  return { requests, config: { publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: "mailto:jules@example.com", send } satisfies PushConfig };
}

const canal: Canal = {
  id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: "1000000099", triggerMode: "toujours", numeroAffiche: "+590 691 26 68 53 (PFlow Démo)",
  coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [], telAlerte: "590690938108",
};
const input = { canal, motif: "Je veux le mien", contactName: "Marc", contactId: "590690111111", extrait: "Bonjour,\nc'est combien ?", conversationId: "contact-42" };

/** WhatsApp factice : OK, ou refusé (fenêtre fermée, modèle absent). */
const whatsapp = (ok: boolean, log: string[] = []): ChannelSender => ({
  async markRead() {},
  async send() {
    throw new Error("fenêtre fermée");
  },
  async sendTemplate() {
    log.push("whatsapp");
    if (!ok) throw new Error("modèle refusé");
    return "wamid.modele";
  },
});

function fakeEmail() {
  const calls: unknown[] = [];
  const doFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "mail" }), { status: 200 });
  }) as typeof fetch;
  return { calls, email: { apiKey: "re_test", to: "jules@example.com", from: "PFlow Bots <onboarding@resend.dev>" }, doFetch };
}

describe("notifications push", () => {
  it("configuration lue dans l'environnement : rien sans les deux clés ; contact VAPID par défaut", () => {
    const env = (vars: Record<string, string>) => (name: string) => vars[name] ?? "";
    expect(pushConfigFromEnv(env({ VAPID_PUBLIC_KEY: "pub" }))).toBeUndefined();
    expect(pushConfigFromEnv(env({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", ALERTE_EMAIL: "j@example.com" }))).toEqual({ publicKey: "pub", privateKey: "priv", subject: "mailto:j@example.com" });
    expect(pushConfigFromEnv(env({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" }))?.subject).toBe("https://pflow-bot-app.vercel.app");
    expect(pushConfigFromEnv(env({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:x@example.com" }))?.subject).toBe("mailto:x@example.com");
  });

  it("contenu de la notification : motif, contact, extrait sur une ligne, ouverture de la conversation", () => {
    expect(alertPushPayload(input)).toEqual({
      title: "🔔 Je veux le mien",
      body: "Marc : « Bonjour, c'est combien ? »",
      url: "/inbox?contact=contact-42",
      tag: "conversation-contact-42",
    });
    expect(alertPushPayload({ motif: "Parler à Jules", contactId: "590690111111" })).toMatchObject({ body: "+590690111111 attend une réponse.", url: "/inbox" });
    expect(alertPushPayload({ ...input, extrait: "x".repeat(500) }).body.length).toBeLessThan(220);
  });

  it("vrai chiffrement Web Push : l'appareil abonné déchiffre exactement la notification ; signature VAPID ; urgence haute", async () => {
    const store = createMemoryChannelStore([canal]);
    const browser = fakeBrowser();
    await store.savePushSubscription({ userId: "jules", endpoint: browser.endpoint, p256dh: browser.p256dh, auth: browser.auth, appareil: "iPhone (Safari)" });
    const { requests, config } = capture();
    const now = new Date("2026-11-09T15:00:00Z");
    const res = await sendPushToAll({ store, config, now }, alertPushPayload(input));
    expect(res).toEqual({ statut: "envoyee", envoyes: 1, erreurs: [] });
    const [req] = requests;
    expect(req.endpoint).toBe(browser.endpoint);
    expect(req.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(req.headers.Urgency).toBe("high");
    expect(req.headers.TTL).toBe(86400);
    expect(String(req.headers.Authorization)).toMatch(new RegExp(`^vapid t=.+, k=${vapid.publicKey}$`));
    // Le contenu ne circule pas en clair…
    expect(req.body.toString("utf8")).not.toContain("Marc");
    // … mais l'appareil le déchiffre à l'identique.
    expect(JSON.parse(browser.decrypt(req.body))).toEqual(alertPushPayload(input));
    const [saved] = await store.listPushSubscriptions();
    expect(saved.dernierEnvoiLe).toBe(now.toISOString());
  });

  it("abonnement expiré (410) supprimé ; autre échec gardé et noté ; « envoyee » dès qu'un appareil est atteint", async () => {
    const store = createMemoryChannelStore([canal]);
    const expired = fakeBrowser("https://fcm.googleapis.com/fcm/send/expire");
    const broken = fakeBrowser("https://updates.push.services.mozilla.com/wpush/v2/panne");
    const ok = fakeBrowser();
    for (const [b, appareil] of [[expired, "Android (Chrome)"], [broken, "PC Windows (Firefox)"], [ok, "iPhone (Safari)"]] as const) {
      await store.savePushSubscription({ userId: "jules", endpoint: b.endpoint, p256dh: b.p256dh, auth: b.auth, appareil });
    }
    const { config } = capture((endpoint) => (endpoint === expired.endpoint ? 410 : endpoint === broken.endpoint ? 500 : 201));
    const res = await sendPushToAll({ store, config, now: new Date() }, alertPushPayload(input));
    expect(res.statut).toBe("envoyee");
    expect(res.envoyes).toBe(1);
    expect(res.erreurs.join(" | ")).toContain("abonnement expiré supprimé (Android (Chrome))");
    expect(res.erreurs.join(" | ")).toContain("push (PC Windows (Firefox)) : 500");
    const left = await store.listPushSubscriptions();
    expect(left.map((s) => s.endpoint).sort()).toEqual([broken.endpoint, ok.endpoint].sort());
    expect(left.find((s) => s.endpoint === broken.endpoint)?.dernierEchec).toContain("500");

    // Tous en échec : « echec ».
    const { config: allBad } = capture(() => 500);
    expect((await sendPushToAll({ store, config: allBad, now: new Date() }, alertPushPayload(input))).statut).toBe("echec");
  });

  it("sans clés : « non_configure » ; sans appareil : « aucun_abonnement » ; un compte ne vise que ses appareils", async () => {
    const store = createMemoryChannelStore([canal]);
    expect((await sendPushToAll({ store, now: new Date() }, alertPushPayload(input))).statut).toBe("non_configure");
    const { config, requests } = capture();
    expect((await sendPushToAll({ store, config, now: new Date() }, alertPushPayload(input))).statut).toBe("aucun_abonnement");
    const a = fakeBrowser();
    const b = fakeBrowser();
    await store.savePushSubscription({ userId: "jules", endpoint: a.endpoint, p256dh: a.p256dh, auth: a.auth });
    await store.savePushSubscription({ userId: "autre", endpoint: b.endpoint, p256dh: b.p256dh, auth: b.auth });
    await sendPushToAll({ store, config, now: new Date() }, alertPushPayload(input), { userId: "jules" });
    expect(requests.map((r) => r.endpoint)).toEqual([a.endpoint]);
  });
});

describe("alertes : WhatsApp et push en parallèle, e-mail seulement si les deux échouent", () => {
  async function storeWithDevice() {
    const store = createMemoryChannelStore([canal]);
    const browser = fakeBrowser();
    await store.savePushSubscription({ userId: "jules", endpoint: browser.endpoint, p256dh: browser.p256dh, auth: browser.auth, appareil: "iPhone (Safari)" });
    return store;
  }
  const template = { name: "alerte_conversation", language: "fr" };

  it("WhatsApp OK et push OK : les deux partent, pas d'e-mail", async () => {
    const store = await storeWithDevice();
    const push = capture();
    const mail = fakeEmail();
    const res = await sendAlert({ store, graph: whatsapp(true), config: { template, push: push.config, email: mail.email, fetch: mail.doFetch }, now: new Date() }, input);
    expect(res).toEqual({ voie: "modele", push: "envoyee", erreurs: [] });
    expect(push.requests).toHaveLength(1);
    expect(mail.calls).toHaveLength(0);
  });

  it("WhatsApp en échec, push OK : prévenu par push, PAS d'e-mail", async () => {
    const store = await storeWithDevice();
    const push = capture();
    const mail = fakeEmail();
    const res = await sendAlert({ store, graph: whatsapp(false), config: { template, push: push.config, email: mail.email, fetch: mail.doFetch }, now: new Date() }, input);
    expect(res.voie).toBe("aucune");
    expect(res.push).toBe("envoyee");
    expect(alertDelivered(res)).toBe(true);
    expect(res.erreurs.join()).toContain("modèle : modèle refusé");
    expect(mail.calls).toHaveLength(0);
  });

  it("WhatsApp OK, push en échec : WhatsApp suffit, pas d'e-mail, l'échec push est noté", async () => {
    const store = await storeWithDevice();
    const push = capture(() => 500);
    const mail = fakeEmail();
    const res = await sendAlert({ store, graph: whatsapp(true), config: { template, push: push.config, email: mail.email, fetch: mail.doFetch }, now: new Date() }, input);
    expect(res).toMatchObject({ voie: "modele", push: "echec" });
    expect(res.erreurs.join()).toContain("push (iPhone (Safari)) : 500");
    expect(mail.calls).toHaveLength(0);
  });

  it("WhatsApp ET push en échec (ou push sans appareil) : e-mail de secours", async () => {
    const store = await storeWithDevice();
    const mail = fakeEmail();
    let res = await sendAlert({ store, graph: whatsapp(false), config: { template, push: capture(() => 500).config, email: mail.email, fetch: mail.doFetch }, now: new Date() }, input);
    expect(res).toMatchObject({ voie: "email", push: "echec" });
    expect(mail.calls).toHaveLength(1);
    res = await sendAlert({ store: createMemoryChannelStore([canal]), graph: whatsapp(false), config: { template, push: capture().config, email: mail.email, fetch: mail.doFetch }, now: new Date() }, input);
    expect(res).toMatchObject({ voie: "email", push: "aucun_abonnement" });
    expect(res.erreurs.join()).toContain("aucun appareil abonné");
    expect(mail.calls).toHaveLength(2);
  });

  it("vraiment en parallèle : WhatsApp attend la fin du push pour répondre, et le push attend que WhatsApp ait commencé", async () => {
    // En séquentiel, l'un des deux attendrait l'autre indéfiniment : chaque attente est bornée à 1 s (échec du test).
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      return { promise, resolve };
    };
    const within = (p: Promise<void>, what: string) => Promise.race([p, new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`${what} : pas en parallèle`)), 1000))]);
    const whatsappStarted = deferred();
    const pushDone = deferred();
    const order: string[] = [];
    const store = await storeWithDevice();
    const graph: ChannelSender = {
      ...whatsapp(true),
      sendTemplate: async () => {
        order.push("whatsapp:debut");
        whatsappStarted.resolve();
        await within(pushDone.promise, "WhatsApp attend le push");
        order.push("whatsapp:fin");
        return "wamid";
      },
    };
    const push = capture();
    const send = push.config.send;
    const config: AlertConfig = {
      template,
      push: {
        ...push.config,
        send: async (...args) => {
          await within(whatsappStarted.promise, "le push attend WhatsApp");
          order.push("push");
          const r = await send(...args);
          pushDone.resolve();
          return r;
        },
      },
    };
    const res = await sendAlert({ store, graph, config, now: new Date() }, input);
    expect(res).toMatchObject({ voie: "modele", push: "envoyee", erreurs: [] });
    expect(order).toEqual(["whatsapp:debut", "push", "whatsapp:fin"]);
  });

  it("de bout en bout : « Je veux le mien » → notification vers la conversation, transfert noté « push envoyée », gérant prévenu sans WhatsApp", async () => {
    const repos = createLocalRepositories(createMemoryStore(), { now: () => new Date("2026-11-09T15:00:00Z") });
    await createMasterTemplate(repos);
    const data = await repos.workspace.exportAll();
    const store = await storeWithDevice();
    const browser = fakeBrowser();
    await store.savePushSubscription({ userId: "jules", endpoint: browser.endpoint, p256dh: browser.p256dh, auth: browser.auth });
    const push = capture();
    const sent: unknown[] = [];
    const graph: ChannelSender = {
      async markRead() {},
      async send(_account, _to, message) {
        sent.push(message);
        return `wamid.${sent.length}`;
      },
    };
    const deps = {
      store,
      graph,
      loadBot: async (id: string, options?: { demo?: boolean }) => loadBotFromWorkspace(data, id, options),
      loadDemos: async () => demoDirectory(data),
      now: () => new Date("2026-11-09T15:00:00Z"),
      sleep: async () => {},
      // Pas de modèle WhatsApp, pas d'e-mail : seul le push peut prévenir Jules.
      alerts: { push: push.config } as AlertConfig,
    };
    const report = await processWebhookPayload(
      {
        object: "whatsapp_business_account",
        entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: canal.accountId }, contacts: [{ wa_id: "590690111111", profile: { name: "Marc" } }], messages: [{ from: "590690111111", id: "wamid.push.1", type: "text", text: { body: "Je veux le mien" } }] } }] }],
      },
      deps,
    );
    expect(report.errors).toEqual([]);
    const [transfert] = await store.listTransferts("pflow");
    expect(transfert).toMatchObject({ gerantPrevenu: true, alerteVoie: "aucune", alertePush: "envoyee" });
    const notification = JSON.parse(browser.decrypt(push.requests.find((r) => r.endpoint === browser.endpoint)!.body));
    expect(notification).toEqual({ title: "🔔 Je veux le mien", body: "Marc attend une réponse.", url: `/inbox?contact=${transfert.contactId}`, tag: `conversation-${transfert.contactId}` });
  });
});

describe("navigateur : clé et nom de l'appareil", () => {
  it("clé publique VAPID → 65 octets ; noms d'appareils lisibles", () => {
    const bytes = vapidKeyBytes(vapid.publicKey);
    expect(bytes).toHaveLength(65);
    expect(Buffer.from(bytes).toString("base64url")).toBe(vapid.publicKey);
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe("iPhone (Safari)");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", 5)).toBe("iPad (Safari)");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe("Mac (Chrome)");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("PC Windows (Edge)");
  });
});

describe("routes /api/push (mode mémoire, sans Supabase)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const json = (method: string, body?: unknown) => new Request("http://localhost/api/push", { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

  it("sans clés VAPID : configure=false, abonnement refusé (503) ; avec : abonnement, liste, test, retrait", async () => {
    process.env.CHANNELS_STORE = "memory";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const { GET, POST, DELETE } = await import("@/app/api/push/route");
    const { POST: TEST } = await import("@/app/api/push/test/route");
    // Service push injoignable en local (127.0.0.1:9) : l'envoi échoue vite, sans sortir sur Internet.
    const browser = fakeBrowser("https://127.0.0.1:9/push/appareil-test");
    const subscription = { endpoint: browser.endpoint, keys: { p256dh: browser.p256dh, auth: browser.auth } };

    let body = await (await GET(json("GET"))).json();
    expect(body).toMatchObject({ configure: false, publicKey: null });
    expect((await POST(json("POST", { subscription, appareil: "iPhone (Safari)" }))).status).toBe(503);

    process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
    process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
    process.env.VAPID_SUBJECT = "mailto:jules@example.com";
    // Abonnements invalides refusés (adresse non https, clés absentes).
    expect((await POST(json("POST", { subscription: { ...subscription, endpoint: "http://evil.example/x" } }))).status).toBe(400);
    expect((await POST(json("POST", { subscription: { endpoint: browser.endpoint } }))).status).toBe(400);
    expect((await POST(json("POST", { subscription, appareil: "iPhone (Safari)" }))).status).toBe(200);

    const raw = await (await GET(json("GET"))).text();
    expect(raw).not.toContain(vapid.privateKey);
    body = JSON.parse(raw);
    expect(body.configure).toBe(true);
    expect(body.publicKey).toBe(vapid.publicKey);
    expect(body.appareils).toEqual([expect.objectContaining({ endpoint: browser.endpoint, appareil: "iPhone (Safari)" })]);

    const test = await TEST(new Request("http://localhost/api/push/test", { method: "POST" }));
    const result = await test.json();
    expect(test.status).toBe(502);
    expect(result.statut).toBe("echec");
    body = await (await GET(json("GET"))).json();
    expect(body.appareils[0].dernierEchec).toBeTruthy();

    expect(await (await DELETE(json("DELETE", { endpoint: browser.endpoint }))).json()).toEqual({ ok: true, retire: true });
    expect((await (await GET(json("GET"))).json()).appareils).toEqual([]);
  }, 20_000);
});
