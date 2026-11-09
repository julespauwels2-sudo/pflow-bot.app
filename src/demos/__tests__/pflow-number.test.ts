import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import { isEmptyDemoSheet, loadBotFromWorkspace } from "@/channels/core/bot-loader";
import { createMemoryChannelStore } from "@/channels/core/memory-store";
import { processWebhookPayload } from "@/channels/core/processor";
import { demoDirectory } from "../lifecycle";
import type { Canal } from "@/channels/core/types";
import type { AlertConfig } from "@/channels/core/alerts";
import { createGraphClient } from "@/channels/whatsapp/graph";
import { DEMO_PERMANENTE, PFLOW_DEMO_BUTTONS, PFLOW_FLOWS, PFLOW_TEXTS, pflowBaseBot } from "../pflow-bot";
import { canAlertQuestion, guide, guideMessage, looksLikeQuestion } from "../parcours";
import { buildPrompt } from "@/ai/prompt";
import { matchKeyword, TEXTS, type AiRequest } from "@/engine";
import { routePflowMessage } from "../router";

const PFLOW_PHONE = "1000000099";
const PROSPECT = "590690111111";
const CODE = "0123456789abcdef0123";

let server: Server;
let base = "";
const sent: Record<string, unknown>[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = JSON.parse(body || "{}");
      if (json.type) sent.push(json);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ messages: [{ id: `wamid.out${sent.length}` }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let n = 0;
const notif = (message: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: PFLOW_PHONE }, contacts: [{ wa_id: PROSPECT, profile: { name: "Marc" } }], messages: [{ from: PROSPECT, id: `wamid.in${++n}`, ...message }] } }] }],
});
const text = (t: string) => notif({ type: "text", text: { body: t } });
const click = (id: string, title: string) => notif({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const texts = (from: number) => sent.slice(from).map((m) => JSON.stringify(m));

/**
 * Jules a activé les notifications sur son iPhone : les alertes partent en push (seule voie). Les notifications sont
 * interceptées en clair (le chiffrement est testé dans push.test.ts) ; rien ne part vers son numéro WhatsApp.
 */
async function julesSubscribed(store: ReturnType<typeof createMemoryChannelStore>) {
  await store.savePushSubscription({ userId: "jules", endpoint: "https://web.push.apple.com/iphone-de-jules", p256dh: "cle", auth: "auth", appareil: "iPhone (Safari)" });
  const notifications: { title: string; body: string; url: string }[] = [];
  const alerts: AlertConfig = {
    push: {
      publicKey: "pub",
      privateKey: "priv",
      subject: "https://pflow-bot-app.vercel.app",
      send: async (_subscription, payload) => {
        notifications.push(JSON.parse(payload));
        return { statusCode: 201 };
      },
    },
  };
  return { alerts, notifications };
}

describe("numéro PFlow partagé par les démos (faux Meta)", () => {
  it("bot PFlow, mot-clé de démo, session, autre démo, démo expirée ; jamais le vrai slug ni de jeton", async () => {
    const clock = { now: new Date("2026-11-10T15:00:00Z") };
    const repos = createLocalRepositories(createMemoryStore(), { now: () => clock.now });
    const template = await createMasterTemplate(repos);
    const byron = await repos.clients.create({ nomResto: "Byron", orderSlug: "byron-vrai-slug" });
    const mexico = await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
    const gwada = await repos.clients.create({ nomResto: "Gwada Food", orderSlug: "gwada" });
    for (const c of [byron, mexico, gwada]) {
      await repos.bots.link(c.id, template.id);
      await repos.demos.start(c.id, { days: 5 });
    }
    await repos.demos.setDays(gwada.id, 1);
    const data = await repos.workspace.exportAll();
    data.clients.find((c) => c.id === byron.id)!.demoCode = CODE;

    const canal: Canal = {
      id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: PFLOW_PHONE, triggerMode: "mots_cles_uniquement",
      coexistence: false, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [],
    };
    const store = createMemoryChannelStore([canal]);
    clock.now = new Date("2026-11-12T15:00:00Z"); // Gwada Food a expiré (1 jour).
    const deps = {
      store,
      graph: createGraphClient({ token: "t", base, version: "v24.0" }),
      loadBot: async (id: string, options?: { demo?: boolean }) => loadBotFromWorkspace(data, id, options),
      loadDemos: async () => demoDirectory(data),
      now: () => clock.now,
      sleep: async () => {},
      pflowBotsSecret: "secret-pflow-bots",
    };

    // 1. Sans mot-clé : bot PFlow de base.
    let from = sent.length;
    expect((await processWebhookPayload(text("Bonjour"), deps)).errors).toEqual([]);
    expect(texts(from).join()).toContain("Bienvenue chez PFlow");

    // 2. « BYRON » : la démo de Byron démarre (son Accueil), bouton vers la page de DÉMO du CRM.
    from = sent.length;
    await processWebhookPayload(text("BYRON"), deps);
    const byronMsgs = texts(from).join();
    expect(byronMsgs).toContain("Bienvenue chez Byron");
    expect(byronMsgs).toContain(`https://order.pflow.fr/demo/commande?d=${CODE}`);
    expect(byronMsgs).not.toContain("byron-vrai-slug");
    expect(byronMsgs).not.toContain("via=wa");
    const contact = (await store.listContacts("pflow"))[0];
    expect(contact.demo).toMatchObject({ clientId: byron.id, visited: [byron.id] });

    // 3. Un bouton de la démo : on reste dans Byron.
    from = sent.length;
    await processWebhookPayload(click("infos", "ℹ️ Infos pratiques"), deps);
    expect(texts(from).join()).toContain("Infos pratiques");

    // 4. Un autre mot-clé : Mexico (pas de code de démo dans le CRM → pas de bouton Commander).
    from = sent.length;
    await processWebhookPayload(text("mexico"), deps);
    expect(texts(from).join()).toContain("Bienvenue chez Mexico");
    expect(sent.slice(from).some((m) => m.type === "interactive" && (m.interactive as { type: string }).type === "cta_url")).toBe(false);
    expect(texts(from).join()).not.toContain("/c/mexico");

    // 5. Démo expirée : message poli.
    from = sent.length;
    await processWebhookPayload(text("Gwada Food"), deps);
    expect(texts(from).join()).toContain(JSON.stringify(PFLOW_TEXTS.demoEnded("Gwada Food")).slice(1, -1));

    // 6. Après la session (30 min sans message) : retour au bot PFlow.
    clock.now = new Date("2026-11-12T15:45:00Z");
    from = sent.length;
    await processWebhookPayload(text("Bonjour"), deps);
    expect(texts(from).join()).toContain("Bienvenue chez PFlow");
    expect((await store.listContacts("pflow"))[0].demo?.visited).toEqual([byron.id, mexico.id]);
  });

  it("démo d'un resto sans bot publié (pas relié au modèle, brouillon seulement) : le modèle maître, à son nom, sans bouton Commander (bug du 7 novembre)", async () => {
    const repos = createLocalRepositories(createMemoryStore(), { now: () => new Date("2026-11-07T15:00:00Z") });
    await createMasterTemplate(repos);
    const gwada = await repos.clients.create({ nomResto: "Gwada food", orderSlug: "gwada-vrai-slug" });
    // Comme en production : un brouillon « Acceuil » jamais publié, aucun lien au modèle.
    await repos.flows.create({ ownerKind: "client", ownerId: gwada.id, name: "Acceuil", draft: { nodes: [], edges: [] } });
    await repos.demos.start(gwada.id, { days: 5 });
    const data = await repos.workspace.exportAll();
    expect(loadBotFromWorkspace(data, gwada.id)).toBeNull(); // hors démo : pas de bot (inchangé)
    const demoBot = loadBotFromWorkspace(data, gwada.id, { demo: true })!;
    expect(demoBot.client).toMatchObject({ nomResto: "Gwada food", orderSlug: "" });
    expect(demoBot.client.orderUrl).toBeUndefined();
    expect(demoBot.agent?.functions.length).toBeGreaterThan(0);

    const canal: Canal = {
      id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: PFLOW_PHONE, triggerMode: "toujours",
      coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "test", testNumeros: [PROSPECT],
    };
    const store = createMemoryChannelStore([canal]);
    const deps = {
      store,
      graph: createGraphClient({ token: "t", base, version: "v24.0" }),
      loadBot: async (id: string, options?: { demo?: boolean }) => loadBotFromWorkspace(data, id, options),
      loadDemos: async () => demoDirectory(data),
      now: () => new Date("2026-11-07T21:29:24Z"),
      sleep: async () => {},
    };
    const from = sent.length;
    expect((await processWebhookPayload(text("gwada food"), deps)).errors).toEqual([]);
    const msgs = texts(from).join();
    expect(msgs).toContain("Bienvenue chez Gwada food");
    expect(msgs).not.toContain("Bienvenue chez PFlow");
    expect(msgs).not.toContain("gwada-vrai-slug");
    expect(sent.slice(from).some((m) => m.type === "interactive" && (m.interactive as { type: string }).type === "cta_url")).toBe(false);
    expect((await store.listContacts("pflow"))[0].demo).toMatchObject({ clientId: gwada.id });
  });

  it("démo sans carte : l'IA ne connaît aucun produit, répond « démo » avec les boutons Obtenir / Tester ; pas de fonction de commande", async () => {
    const repos = createLocalRepositories(createMemoryStore(), { now: () => new Date("2026-11-07T15:00:00Z") });
    await createMasterTemplate(repos);
    const gwada = await repos.clients.create({ nomResto: "Gwada food", orderSlug: "gwada-vrai-slug" });
    await repos.demos.start(gwada.id, { days: 5 });
    const data = await repos.workspace.exportAll();
    // Comme en production : aucune carte, aucune fiche remplie ; seulement les valeurs par défaut du CRM.
    data.infoSheets[gwada.id] = {
      horaires: [{ jour: 1, plages: [{ de: "11:00", a: "14:00" }] }],
      livraison: false,
      retrait: true,
      zonesLivraison: "Jarry",
      adresse: "Rue des Palmiers",
      paiementEnLigne: { mode: "non", aConfigurer: false },
    };

    const canal: Canal = {
      id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: PFLOW_PHONE, triggerMode: "toujours",
      coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "test", testNumeros: [PROSPECT],
    };
    const store = createMemoryChannelStore([canal]);
    const requests: AiRequest[] = [];
    const answer = "C'est une démo : la carte de Gwada food n'y est pas encore 🙂";
    const deps = {
      store,
      graph: createGraphClient({ token: "t", base, version: "v24.0" }),
      loadBot: async (id: string, options?: { demo?: boolean }) => loadBotFromWorkspace(data, id, options),
      loadDemos: async () => demoDirectory(data),
      now: () => new Date("2026-11-07T21:29:24Z"),
      sleep: async () => {},
      ai: async (request: AiRequest) => {
        requests.push(request);
        return { decision: { action: "repondre" as const, fonction: "", texte: answer }, usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const buttonsOf = (m: Record<string, unknown>) =>
      ((m.interactive as { action?: { buttons?: { reply: { id: string; title: string } }[] } })?.action?.buttons ?? []).map((b) => b.reply);

    // Accueil : pas de page de commande de démo → le texte d'accueil, puis « pas encore prête » + boutons PFlow.
    let from = sent.length;
    await processWebhookPayload(text("gwada food"), deps);
    expect(texts(from).join()).toContain("Bienvenue chez Gwada food");
    const notice = sent.slice(from).find((m) => JSON.stringify(m).includes("n'est pas encore prête dans cette démo"))!;
    expect(buttonsOf(notice).map((b) => b.title)).toEqual(["🙋 Je veux le mien", "😋 Tester la démo"]);

    // Question sur un prix : l'IA reçoit les règles « démo sans carte » et aucune fonction de commande.
    from = sent.length;
    await processWebhookPayload(text("c'est combien votre bokit poulet ?"), deps);
    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.client.demo).toEqual({ sansCarte: true, ficheVide: true });
    // Les valeurs par défaut du CRM ne vont jamais à l'IA : tout est inconnu.
    expect(req.infoSheet).toEqual({ horaires: [] });
    expect(req.functions.map((f) => f.name)).not.toEqual(expect.arrayContaining(["lancer_commande"]));
    for (const hidden of ["lancer_commande", "proposer_commande", "suivre_commande", "annuler_commande"]) {
      expect(req.functions.map((f) => f.name)).not.toContain(hidden);
    }
    const system = buildPrompt(req).system.map((b) => b.text).join("\n");
    expect(system).toContain("tu ne connais AUCUN produit, AUCUN prix");
    expect(system).toContain("ces infos ne sont pas encore renseignées");
    for (const faux of ["Livraison : non", "Retrait sur place : oui", "Jarry", "Rue des Palmiers", "11:00", "11 h"]) expect(system).not.toContain(faux);
    expect(system).toContain("## Horaires d'ouverture\nNon renseignés.");
    // La réponse de l'IA porte les deux boutons PFlow.
    const reply = sent.slice(from).find((m) => JSON.stringify(m).includes("la carte de Gwada food n'y est pas encore"))!;
    expect(reply.type).toBe("interactive");
    expect(buttonsOf(reply).map((b) => b.title)).toEqual(["🙋 Je veux le mien", "😋 Tester la démo"]);

    // « Tester la démo » : on quitte la démo pour le bot PFlow de base.
    from = sent.length;
    await processWebhookPayload(click(PFLOW_DEMO_BUTTONS[1].id, PFLOW_DEMO_BUTTONS[1].title), deps);
    expect(texts(from).join()).toContain("https://order.pflow.fr/demo/commande?r=pflow"); // la démo permanente
    expect((await store.listContacts("pflow"))[0].demo?.clientId).toBe("");

    // Retour dans la démo, puis « Je veux le mien » : transfert à Jules (bot PFlow), jamais l'IA de la démo.
    await processWebhookPayload(text("gwada food"), deps);
    from = sent.length;
    await processWebhookPayload(click(PFLOW_DEMO_BUTTONS[0].id, PFLOW_DEMO_BUTTONS[0].title), deps);
    expect(texts(from).join()).toContain(PFLOW_TEXTS.wantMine.slice(0, 30));
    expect(requests).toHaveLength(1);
    expect(texts(from).join()).not.toContain(TEXTS.handoff.slice(0, 30));
  });

  it("parcours guidé : accueil 1 bouton → étape 1/3 → retour « J'ai passé ma commande ✅ » → 2/3 → « J'ai vu le dashboard 👀 » → 3/3 → Jules prévenu", async () => {
    const repos = createLocalRepositories(createMemoryStore(), { now: () => new Date("2026-11-08T15:00:00Z") });
    await createMasterTemplate(repos);
    const gwada = await repos.clients.create({ nomResto: "Gwada food", orderSlug: "gwada" });
    await repos.demos.start(gwada.id, { days: 5 });
    const data = await repos.workspace.exportAll();
    const canal: Canal = {
      id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: PFLOW_PHONE, triggerMode: "toujours",
      coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [], telAlerte: "590690938108",
    };
    const store = createMemoryChannelStore([canal]);
    const jules = await julesSubscribed(store);
    let calls = 0;
    const clock = { now: new Date("2026-11-08T15:00:00Z") };
    const deps = {
      store,
      graph: createGraphClient({ token: "t", base, version: "v24.0" }),
      loadBot: async (id: string, options?: { demo?: boolean }) => loadBotFromWorkspace(data, id, options),
      loadDemos: async () => demoDirectory(data),
      now: () => clock.now,
      sleep: async () => {},
      alerts: jules.alerts,
      ai: async () => {
        calls++;
        throw new Error("le bot PFlow de base n'appelle jamais l'IA");
      },
    };
    type Out = { type: string; to?: string; text?: { body: string }; interactive?: { type: string; body: { text: string }; action: { buttons?: { reply: { id: string; title: string } }[]; parameters?: { display_text: string; url: string } } } };
    const out = (from: number) => (sent.slice(from) as Out[]).filter((m) => m.to !== "590690938108");
    const titles = (m: Out) => (m.interactive?.action.buttons ?? []).map((b) => b.reply.title);
    const step = async () => (await store.listContacts("pflow"))[0].demo?.parcours?.etape;
    const say = async (t: string) => { const from = sent.length; await processWebhookPayload(text(t), deps); return out(from); };
    const press = async (m: Out, i: number) => {
      const b = m.interactive!.action.buttons![i].reply;
      const from = sent.length;
      await processWebhookPayload(click(b.id, b.title), deps);
      return out(from);
    };

    // 1. Accueil : un seul message, un seul bouton (n'importe quel premier message).
    let msgs = await say("Bonjour, c'est quoi ce numéro ?");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].interactive?.body.text).toBe(PFLOW_TEXTS.welcome);
    expect(titles(msgs[0])).toEqual(["Tester la démo"]);
    expect(await step()).toBe(0);

    // 2. Étape 1/3 : un message, un bouton lien « Je commande ».
    msgs = await press(msgs[0], 0);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].interactive).toMatchObject({ type: "cta_url", body: { text: PFLOW_TEXTS.step1 }, action: { parameters: { display_text: "Je commande", url: DEMO_PERMANENTE.commandeUrl } } });
    expect(await step()).toBe(1);

    // Filet de sécurité : autre chose (ou un retour plus tard, « Bonjour ») → rappel de l'étape 1 avec son bouton.
    for (const autre of ["euh je comprends pas", "Bonjour"]) {
      msgs = await say(autre);
      expect(msgs[0].interactive).toMatchObject({ type: "cta_url", body: { text: PFLOW_TEXTS.remind1 }, action: { parameters: { url: DEMO_PERMANENTE.commandeUrl } } });
      expect(msgs[1].interactive?.body.text).toBe(PFLOW_TEXTS.remindDone);
      expect(titles(msgs[1])).toEqual(["✅ C'est fait", "💬 Parler à Jules"]);
      expect(await step()).toBe(1);
    }

    // 3. Retour depuis la confirmation (texte prérempli du CRM) → étape 2/3 « Voir le dashboard ».
    msgs = await say(DEMO_PERMANENTE.retourCommande);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].interactive).toMatchObject({ type: "cta_url", body: { text: PFLOW_TEXTS.step2 }, action: { parameters: { display_text: "Voir le dashboard", url: DEMO_PERMANENTE.dashboardUrl } } });
    expect(await step()).toBe(2);

    // Rappel de l'étape 2, puis « ✅ C'est fait » (bouton du rappel) → étape 3/3.
    msgs = await say("ok merci");
    expect(msgs[0].interactive?.body.text).toBe(PFLOW_TEXTS.remind2);
    msgs = await press(msgs[1], 0);
    expect(msgs[0].interactive?.body.text).toBe(PFLOW_TEXTS.step3);
    expect(titles(msgs[0])).toEqual(["🙋 Je veux le mien", "Comment ça marche ?"]);
    expect(await step()).toBe(3);

    // « Comment ça marche ? » : 3 lignes, puis [Je veux le mien].
    msgs = await press(msgs[0], 1);
    expect(msgs[0].interactive?.body.text).toBe(PFLOW_TEXTS.howItWorks);
    expect(PFLOW_TEXTS.howItWorks.split("\n")).toHaveLength(3);
    expect(titles(msgs[0])).toEqual(["🙋 Je veux le mien"]);

    // « Je veux le mien » : transfert, Jules prévenu (notification push + boîte de réception), puis le bot se tait.
    let from = sent.length;
    msgs = await press(msgs[0], 0);
    expect(JSON.stringify(msgs)).toContain(PFLOW_TEXTS.wantMine.slice(0, 30));
    expect(jules.notifications.at(-1)).toMatchObject({ title: "🔔 Je veux le mien", url: expect.stringMatching(/^\/inbox\?contact=/) });
    expect((await store.listTransferts("pflow")).length).toBe(1);
    from = sent.length;
    await processWebhookPayload(text("Bonjour"), deps);
    expect(out(from)).toHaveLength(0);
    expect(calls).toBe(0);

    // Aucun message n'est jamais envoyé sans que le prospect écrive : pas de relance. Rien vers le numéro de Jules.
    expect(sent.filter((m) => (m as Out).to !== "590690938108").length).toBeGreaterThan(0);
    expect(sent.some((m) => (m as Out).to === "590690938108")).toBe(false);
  });

  it("parcours guidé : retour « J'ai vu le dashboard 👀 », « c'est fait » écrit, oubli après 7 jours, nom de démo prioritaire", async () => {
    const repos = createLocalRepositories(createMemoryStore(), { now: () => new Date("2026-11-08T15:00:00Z") });
    await createMasterTemplate(repos);
    const gwada = await repos.clients.create({ nomResto: "Gwada food", orderSlug: "gwada" });
    await repos.demos.start(gwada.id, { days: 5 });
    const data = await repos.workspace.exportAll();
    const canal: Canal = {
      id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: PFLOW_PHONE, triggerMode: "toujours",
      coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [],
    };
    const store = createMemoryChannelStore([canal]);
    const clock = { now: new Date("2026-11-08T15:00:00Z") };
    const deps = {
      store,
      graph: createGraphClient({ token: "t", base, version: "v24.0" }),
      loadBot: async (id: string, options?: { demo?: boolean }) => loadBotFromWorkspace(data, id, options),
      loadDemos: async () => demoDirectory(data),
      now: () => clock.now,
      sleep: async () => {},
    };
    const say = async (t: string) => { const from = sent.length; await processWebhookPayload(text(t), deps); return texts(from).join(); };
    const step = async () => (await store.listContacts("pflow"))[0].demo?.parcours?.etape;

    // Intention de commander dès le premier message : étape 1 directement.
    expect(await say("Bonjour je veux commander")).toContain(DEMO_PERMANENTE.commandeUrl);
    expect(await step()).toBe(1);
    // « c'est fait » écrit à la main → étape 2.
    expect(await say("C'est fait !")).toContain(DEMO_PERMANENTE.dashboardUrl);
    expect(await step()).toBe(2);
    // Retour depuis le dashboard (texte prérempli) → étape 3, même sans « c'est fait ».
    expect(await say(DEMO_PERMANENTE.retourDashboard)).toContain("Étape 3/3");
    expect(await step()).toBe(3);
    // Plus tard, un autre message : rappel de l'étape 3 (ses boutons).
    clock.now = new Date("2026-11-10T09:00:00Z");
    expect(await say("bonjour")).toContain("Étape 3/3");
    // Nom d'une démo personnalisée : toujours prioritaire.
    expect(await say("gwada food")).toContain("Gwada food");
    // 7 jours sans rien : on repart de l'accueil.
    clock.now = new Date("2026-11-20T09:00:00Z");
    expect(await say("bonjour")).toContain("Bienvenue chez PFlow");
    expect(await step()).toBe(0);
  });

  it("parcours guidé (fonctions pures) : mots-clés, « c'est fait », rappel", () => {
    const flows = pflowBaseBot().flows;
    const now = new Date("2026-11-08T12:00:00Z");
    const at = now.toISOString();
    const g = (t: string, etape?: 0 | 1 | 2 | 3) => {
      const m = guideMessage({ kind: "text", text: t }, flows, etape === undefined ? undefined : { etape, at }, now);
      return m.kind === "start_flow" ? m.flowId : m.kind;
    };
    // Mêmes textes et numéro que les boutons « Retour sur WhatsApp » du CRM (img/demo/mint-bun/carte.json).
    expect(DEMO_PERMANENTE).toMatchObject({ numeroWhatsapp: "590691266853", retourCommande: "J'ai passé ma commande ✅", retourDashboard: "J'ai vu le dashboard 👀" });
    expect(g("salut")).toBe(PFLOW_FLOWS.accueil);
    expect(g("n'importe quoi")).toBe(PFLOW_FLOWS.accueil);
    for (const t of ["commander", "Bonjour je veux commander", "la carte", "Tester la démo", "démo"]) expect(g(t), t).toBe(PFLOW_FLOWS.etape1);
    expect(g(DEMO_PERMANENTE.retourCommande, 1)).toBe(PFLOW_FLOWS.etape2);
    expect(g(DEMO_PERMANENTE.retourDashboard, 2)).toBe(PFLOW_FLOWS.etape3);
    expect(g("ok", 1)).toBe(PFLOW_FLOWS.etape2);
    expect(g("ok", 2)).toBe(PFLOW_FLOWS.etape3);
    expect(g("ok", 3)).toBe(PFLOW_FLOWS.rappel3);
    expect(g("bonjour", 1)).toBe(PFLOW_FLOWS.rappel1);
    expect(g("hein", 2)).toBe(PFLOW_FLOWS.rappel2);
    expect(g("hein ?", 2)).toBe(`${PFLOW_FLOWS.question}2`); // un « ? » : question pour Jules
    expect(g("Obtenir ma démo", 1)).toBe(PFLOW_FLOWS.mien);
    expect(g("je veux le mien", 0)).toBe(PFLOW_FLOWS.mien);
    expect(g("Comment ça marche ?", 2)).toBe(PFLOW_FLOWS.commentCaMarche);
    const click = guideMessage({ kind: "button_reply", id: "x", title: "y" }, flows, { etape: 1, at }, now);
    expect(click.kind).toBe("button_reply");
    // Les textes des boutons « Retour sur WhatsApp » du CRM font quitter une démo personnalisée en cours.
    const route = routePflowMessage({
      message: { kind: "text", text: DEMO_PERMANENTE.retourCommande },
      demos: [{ id: "d", clientId: "g", keyword: "Gwada food", nomResto: "Gwada food", startedAt: "2026-11-07T00:00:00Z", expiresAt: "2026-11-12T00:00:00Z" } as never],
      current: { clientId: "g", lastAt: at, visited: ["g"] },
      now,
      sessionMinutes: 30,
    });
    expect(route).toEqual({ kind: "pflow" });
  });

  it("démo sans carte mais avec une fiche remplie (FAQ…) : l'IA garde la fiche ; avec une carte : rien ne change", async () => {
    const repos = createLocalRepositories(createMemoryStore(), { now: () => new Date("2026-11-08T15:00:00Z") });
    await createMasterTemplate(repos);
    const r = await repos.clients.create({ nomResto: "Chez Test", orderSlug: "chez-test" });
    const data = await repos.workspace.exportAll();
    data.infoSheets[r.id] = { horaires: [], livraison: true, retrait: false, faq: "Q : Vous avez du végétarien ? R : Oui." };
    expect(loadBotFromWorkspace(data, r.id, { demo: true })!.client.demo).toMatchObject({ sansCarte: true, ficheVide: false });
    expect(isEmptyDemoSheet(data.infoSheets[r.id])).toBe(false);
    data.infoSheets[r.id] = { horaires: [], livraison: false, retrait: true, resumeCarte: "• Bokit : 7 €" };
    expect(loadBotFromWorkspace(data, r.id, { demo: true })!.client.demo).toMatchObject({ sansCarte: false, ficheVide: false });
    expect(isEmptyDemoSheet({ horaires: [], livraison: false, retrait: true, zonesLivraison: "Jarry", adresse: "x" })).toBe(true);
    // Hors démo : jamais de drapeau démo.
    expect(loadBotFromWorkspace(data, r.id)).toBeNull();
  });

  it("démo sans carte ni fiche : « Infos pratiques » n'affiche pas les valeurs par défaut du CRM, mais « pas encore renseignées » + boutons", async () => {
    const repos = createLocalRepositories(createMemoryStore(), { now: () => new Date("2026-11-08T15:00:00Z") });
    await createMasterTemplate(repos);
    const gwada = await repos.clients.create({ nomResto: "Gwada food", orderSlug: "gwada" });
    await repos.demos.start(gwada.id, { days: 5 });
    const data = await repos.workspace.exportAll();
    const defauts = {
      horaires: [{ jour: 1 as const, plages: [{ de: "11:00", a: "14:00" }] }],
      livraison: false,
      retrait: true,
      zonesLivraison: "Jarry",
      adresse: "Rue des Palmiers",
      paiementEnLigne: { mode: "non" as const, aConfigurer: false },
    };
    data.infoSheets[gwada.id] = defauts;
    const canal: Canal = {
      id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: PFLOW_PHONE, triggerMode: "toujours",
      coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "test", testNumeros: [PROSPECT],
    };
    const store = createMemoryChannelStore([canal]);
    const deps = {
      store,
      graph: createGraphClient({ token: "t", base, version: "v24.0" }),
      loadBot: async (id: string, options?: { demo?: boolean }) => loadBotFromWorkspace(data, id, options),
      loadDemos: async () => demoDirectory(data),
      now: () => new Date("2026-11-08T15:00:00Z"),
      sleep: async () => {},
    };
    const buttonsOf = (m: Record<string, unknown>) =>
      ((m.interactive as { action?: { buttons?: { reply: { id: string; title: string } }[] } })?.action?.buttons ?? []).map((b) => b.reply);
    await processWebhookPayload(text("gwada food"), deps);
    for (const ask of ["horaires", "livraison", "paiement"]) {
      const from = sent.length;
      await processWebhookPayload(text(ask), deps);
      const msgs = texts(from).join();
      expect(msgs, ask).toContain(TEXTS.demoInfosVides);
      for (const faux of ["Retrait", "retrait", "Jarry", "Rue des Palmiers", "11 h", "11:00", "sur place", "Livraison : non", "Que souhaitez-vous savoir"]) {
        expect(msgs, `${ask} : ${faux}`).not.toContain(faux);
      }
      const notice = sent.slice(from).find((m) => JSON.stringify(m).includes(TEXTS.demoInfosVides))!;
      expect(buttonsOf(notice).map((b) => b.title)).toEqual(["🙋 Je veux le mien", "😋 Tester la démo"]);
    }

    // Fiche remplie (FAQ) : « Infos pratiques » s'affiche normalement.
    data.infoSheets[gwada.id] = { ...defauts, faq: "Q : Végétarien ? R : Oui." };
    const from = sent.length;
    await processWebhookPayload(text("horaires"), deps);
    expect(texts(from).join()).toContain("Que souhaitez-vous savoir");
    expect(texts(from).join()).not.toContain(TEXTS.demoInfosVides);
  });

  describe("parcours guidé : joindre Jules en plein parcours", () => {
    type Out = { type: string; to?: string; text?: { body: string }; interactive?: { type: string; body: { text: string }; action: { buttons?: { reply: { id: string; title: string } }[]; parameters?: { display_text: string; url: string } } } };
    const ALERTE = "590690938108";
    async function setup() {
      const repos = createLocalRepositories(createMemoryStore(), { now: () => new Date("2026-11-08T15:00:00Z") });
      await createMasterTemplate(repos);
      const data = await repos.workspace.exportAll();
      const canal: Canal = {
        id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: PFLOW_PHONE, triggerMode: "toujours",
        coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [], telAlerte: ALERTE,
      };
      const store = createMemoryChannelStore([canal]);
      const jules = await julesSubscribed(store);
      const clock = { now: new Date("2026-11-08T15:00:00Z") };
      const deps = {
        store,
        graph: createGraphClient({ token: "t", base, version: "v24.0" }),
        loadBot: async (id: string, options?: { demo?: boolean }) => loadBotFromWorkspace(data, id, options),
        loadDemos: async () => demoDirectory(data),
        now: () => clock.now,
        sleep: async () => {},
        alerts: jules.alerts,
      };
      const out = (from: number) => {
        // Jamais de message WhatsApp vers le numéro de Jules : l'alerte part en notification push.
        expect((sent.slice(from) as Out[]).some((m) => m.to === ALERTE)).toBe(false);
        return sent.slice(from) as Out[];
      };
      let seen = 0;
      const alerts = () => {
        const fresh = jules.notifications.slice(seen).map((n) => `${n.title} | ${n.body}`);
        seen = jules.notifications.length;
        return fresh;
      };
      const titles = (m: Out) => (m.interactive?.action.buttons ?? []).map((b) => b.reply.title);
      const say = async (t: string) => { const from = sent.length; alerts(); await processWebhookPayload(text(t), deps); return { msgs: out(from), alerts: alerts() }; };
      const press = async (m: Out, title: string) => {
        const b = m.interactive!.action.buttons!.find((x) => x.reply.title === title)!.reply;
        const from = sent.length;
        alerts();
        await processWebhookPayload(click(b.id, b.title), deps);
        return { msgs: out(from), alerts: alerts() };
      };
      const etape = async () => (await store.listContacts("pflow"))[0].demo?.parcours;
      const paused = async () => Boolean((await store.listContacts("pflow"))[0].state.pause);
      return { store, clock, say, press, titles, etape, paused };
    }

    it("chaque rappel d'étape propose [💬 Parler à Jules] : transfert à Jules avec alerte, « Pas de souci… »", async () => {
      const t = await setup();
      await t.say("Tester la démo");
      // Rappel de l'étape 1 : [✅ C'est fait] [💬 Parler à Jules].
      let r = await t.say("hmm");
      expect(t.titles(r.msgs[1])).toEqual(["✅ C'est fait", "💬 Parler à Jules"]);
      r = await t.press(r.msgs[1], "💬 Parler à Jules");
      expect(JSON.stringify(r.msgs)).toContain(PFLOW_TEXTS.talkToJules);
      expect(r.alerts).toHaveLength(1);
      expect(r.alerts[0]).toContain("🔔 Parler à Jules");
      expect(await t.paused()).toBe(true); // comme « Je veux le mien » : Jules reprend la main
      const transferts = await t.store.listTransferts("pflow");
      expect(transferts).toHaveLength(1);
      expect(transferts[0].source).toBe("bloc");
    });

    it("rappels des étapes 2 et 3 : [💬 Parler à Jules] aussi ; « parler à Jules » écrit fait pareil", async () => {
      const t = await setup();
      await t.say("Tester la démo");
      await t.say(DEMO_PERMANENTE.retourCommande);
      let r = await t.say("hmm");
      expect(r.msgs[0].interactive?.body.text).toBe(PFLOW_TEXTS.remind2);
      expect(t.titles(r.msgs[1])).toEqual(["✅ C'est fait", "💬 Parler à Jules"]);
      await t.say(DEMO_PERMANENTE.retourDashboard);
      r = await t.say("hmm");
      expect(r.msgs[0].interactive?.body.text).toBe(PFLOW_TEXTS.step3);
      expect(t.titles(r.msgs[0])).toEqual(["🙋 Je veux le mien", "Comment ça marche ?", "💬 Parler à Jules"]);
      r = await t.say("Je voudrais parler à Jules");
      expect(JSON.stringify(r.msgs)).toContain(PFLOW_TEXTS.talkToJules);
      expect(r.alerts).toHaveLength(1);
    });

    it("question en plein parcours : « Bonne question ! », alerte à Jules avec la question, PAS de pause, rappel de l'étape ; une alerte max / 30 min", async () => {
      const t = await setup();
      // Sans parcours (premier message), une question mène à l'accueil, sans alerte.
      let r = await t.say("C'est quoi PFlow exactement ?");
      expect(r.msgs[0].interactive?.body.text).toBe(PFLOW_TEXTS.welcome);
      expect(r.alerts).toHaveLength(0);

      await t.say("Tester la démo");
      // 1. Une question (« ? ») : réponse, alerte avec le texte, rappel de l'étape 1 (avec son bouton).
      r = await t.say("C'est payant ?");
      expect(r.msgs[0].text?.body).toBe(PFLOW_TEXTS.question);
      expect(r.msgs[1].interactive).toMatchObject({ type: "cta_url", body: { text: PFLOW_TEXTS.remind1 }, action: { parameters: { url: DEMO_PERMANENTE.commandeUrl } } });
      expect(t.titles(r.msgs[2])).toEqual(["✅ C'est fait", "💬 Parler à Jules"]);
      expect(r.alerts).toHaveLength(1);
      expect(r.alerts[0]).toContain("🔔 Question pendant la démo");
      expect(r.alerts[0]).toContain("« C'est payant ? »");
      expect(await t.paused()).toBe(false);
      const transferts = await t.store.listTransferts("pflow");
      expect(transferts).toHaveLength(1);
      expect(transferts[0].dernierMessage).toBe("C'est payant ?");
      expect((await t.etape())?.etape).toBe(1);

      // Le prospect continue la démo : pas de pause.
      r = await t.say(DEMO_PERMANENTE.retourCommande);
      expect(r.msgs[0].interactive?.body.text).toBe(PFLOW_TEXTS.step2);

      // 2. Autre question (plus de 4 mots, sans « ? ») 10 min après : réponse et rappel, mais PAS de 2e alerte.
      t.clock.now = new Date("2026-11-08T15:10:00Z");
      r = await t.say("et pour la livraison vous faites comment");
      expect(r.msgs[0].text?.body).toBe(PFLOW_TEXTS.question);
      expect(r.msgs[1].interactive?.body.text).toBe(PFLOW_TEXTS.remind2);
      expect(r.alerts).toHaveLength(0);
      expect(await t.store.listTransferts("pflow")).toHaveLength(1);

      // 3. Un message court sans « ? » : simple rappel, pas de « Bonne question ».
      r = await t.say("ah ok");
      expect(r.msgs[0].interactive?.body.text).toBe(PFLOW_TEXTS.remind2);
      expect(JSON.stringify(r.msgs)).not.toContain(PFLOW_TEXTS.question);

      // 4. Plus de 30 min après la première alerte : nouvelle alerte.
      t.clock.now = new Date("2026-11-08T15:31:00Z");
      r = await t.say("Ça marche aussi pour un food truck ?");
      expect(r.alerts).toHaveLength(1);
      expect(await t.store.listTransferts("pflow")).toHaveLength(2);
      expect(await t.paused()).toBe(false);
    });

    it("détection d'une question (fonction pure)", () => {
      expect(looksLikeQuestion("C'est payant ?")).toBe(true);
      expect(looksLikeQuestion("et pour la livraison vous faites comment")).toBe(true);
      expect(looksLikeQuestion("ah ok")).toBe(false);
      expect(looksLikeQuestion("euh je comprends pas")).toBe(false);
      const flows = pflowBaseBot().flows;
      const now = new Date("2026-11-08T12:00:00Z");
      const at = now.toISOString();
      expect(guide({ kind: "text", text: "C'est payant ?" }, flows, { etape: 2, at }, now)).toEqual({
        message: { kind: "start_flow", flowId: "pflow-question-2" },
        question: "C'est payant ?",
      });
      // Les mots-clés du parcours passent avant (« comment ça marche ? » n'est pas une question pour Jules).
      expect(guide({ kind: "text", text: "Comment ça marche ?" }, flows, { etape: 2, at }, now).question).toBeUndefined();
      expect(canAlertQuestion({ etape: 1, at, alerteAt: at }, new Date("2026-11-08T12:29:00Z"))).toBe(false);
      expect(canAlertQuestion({ etape: 1, at, alerteAt: at }, new Date("2026-11-08T12:30:00Z"))).toBe(true);
    });
  });
});

