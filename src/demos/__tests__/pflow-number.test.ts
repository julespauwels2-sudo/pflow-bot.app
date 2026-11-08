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
import { createGraphClient } from "@/channels/whatsapp/graph";
import { PFLOW_DEMO_BUTTONS, PFLOW_TEXTS } from "../pflow-bot";
import { buildPrompt } from "@/ai/prompt";
import { TEXTS, type AiRequest } from "@/engine";

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
    expect(texts(from).join()).toContain("Ici *PFlow*");

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
    expect(texts(from).join()).toContain("Ici *PFlow*");
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
    expect(msgs).not.toContain("Ici *PFlow*");
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
    expect(buttonsOf(notice).map((b) => b.title)).toEqual(["🎁 Obtenir ma démo", "😋 Tester la démo"]);

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
    expect(buttonsOf(reply).map((b) => b.title)).toEqual(["🎁 Obtenir ma démo", "😋 Tester la démo"]);

    // « Tester la démo » : on quitte la démo pour le bot PFlow de base.
    from = sent.length;
    await processWebhookPayload(click(PFLOW_DEMO_BUTTONS[1].id, PFLOW_DEMO_BUTTONS[1].title), deps);
    expect(texts(from).join()).toContain("PFlow Order");
    expect((await store.listContacts("pflow"))[0].demo?.clientId).toBe("");

    // Retour dans la démo, puis « Obtenir ma démo » : transfert à Jules (bot PFlow), jamais l'IA de la démo.
    await processWebhookPayload(text("gwada food"), deps);
    from = sent.length;
    await processWebhookPayload(click(PFLOW_DEMO_BUTTONS[0].id, PFLOW_DEMO_BUTTONS[0].title), deps);
    expect(texts(from).join()).toContain(PFLOW_TEXTS.demoRequest.slice(0, 40));
    expect(requests).toHaveLength(1);
    expect(texts(from).join()).not.toContain(TEXTS.handoff.slice(0, 30));
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
});

