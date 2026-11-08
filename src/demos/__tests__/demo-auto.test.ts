/**
 * Démo permanente automatique, de bout en bout sur un faux Meta (aucun vrai téléphone) :
 * jeton dans les liens → commande validée (comme l'appel de la page Mint Bun) → confirmation + étape 2/3 →
 * ouverture du dashboard (redirection) → tâche à la minute → étape 3/3, une seule fois. Garde-fous compris.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import { loadBotFromWorkspace } from "@/channels/core/bot-loader";
import { createMemoryChannelStore } from "@/channels/core/memory-store";
import { processWebhookPayload } from "@/channels/core/processor";
import type { Canal } from "@/channels/core/types";
import { createGraphClient } from "@/channels/whatsapp/graph";
import { demoDirectory } from "../lifecycle";
import { DEMO_PERMANENTE, PFLOW_TEXTS } from "../pflow-bot";
import { createDemoToken, readDemoToken } from "../demo-token";
import { dashboardUrlWithOrder, etape3Seconds, formatDemoRecap, handleDemoDashboard, handleDemoOrder, runDemoDue, type DemoAutoDeps } from "../demo-auto";

const PFLOW_PHONE = "1000000099";
const SECRET = "secret-pflow-bots";
const BOTS = "https://bots.example";
const ALERTE = "590690938108";

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

type Out = { type: string; to?: string; text?: { body: string }; interactive?: { type: string; body: { text: string }; action: { buttons?: { reply: { id: string; title: string } }[]; parameters?: { display_text: string; url: string } } } };

let n = 0;
const notif = (from: string, message: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: PFLOW_PHONE }, contacts: [{ wa_id: from, profile: { name: "Marc" } }], messages: [{ from, id: `wamid.in${++n}`, ...message }] } }] }],
});

const order = (numero: number) => ({
  numero,
  mode: "retrait",
  total: 19.9,
  creneau: "Dès que possible",
  client_nom: "Marie",
  articles: [
    {
      nom: "Burger + frites + boisson",
      qte: 1,
      prix: 16.9,
      total: 19.9,
      supplements: [
        { groupe: "Votre burger", nom: "Spicy Matcha", prix: 0 },
        { groupe: "Votre boisson", nom: "Citronnade maison", prix: 0 },
        { groupe: "Suppléments", nom: "Supplément steak", prix: 3 },
      ],
    },
  ],
});

async function setup(etat: Canal["etat"] = "actif") {
  const repos = createLocalRepositories(createMemoryStore(), { now: () => new Date("2026-11-09T15:00:00Z") });
  await createMasterTemplate(repos);
  const data = await repos.workspace.exportAll();
  const canal: Canal = {
    id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: PFLOW_PHONE, triggerMode: "toujours",
    coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat, testNumeros: ["590690111111"], telAlerte: ALERTE,
  };
  const store = createMemoryChannelStore([canal]);
  const clock = { now: new Date("2026-11-09T15:00:00Z") };
  const graph = createGraphClient({ token: "t", base, version: "v24.0" });
  const deps = {
    store,
    graph,
    loadBot: async (id: string, options?: { demo?: boolean }) => loadBotFromWorkspace(data, id, options),
    loadDemos: async () => demoDirectory(data),
    now: () => clock.now,
    sleep: async () => {},
    pflowBotsSecret: SECRET,
    demoBotsUrl: BOTS,
  };
  const auto: DemoAutoDeps = { store, graph, secret: SECRET, botsUrl: BOTS, etape3Seconds: 90, now: () => clock.now, sleep: async () => {} };
  const out = (from: number, to?: string) => (sent.slice(from) as Out[]).filter((m) => m.to !== ALERTE && (!to || m.to === to));
  const say = async (who: string, t: string) => {
    const from = sent.length;
    await processWebhookPayload(notif(who, { type: "text", text: { body: t } }), deps);
    return out(from);
  };
  const contactOf = async (waId: string) => (await store.listContacts("pflow")).find((c) => c.waId === waId)!;
  /** Le prospect lance la démo : renvoie ses deux liens (avec jeton). */
  const start = async (who = "590690111111") => {
    const msgs = await say(who, "Tester la démo");
    const url = msgs[0].interactive!.action.parameters!.url;
    return { url, token: new URL(url).searchParams.get("j")! };
  };
  return { store, clock, auto, say, out, start, contactOf };
}

describe("démo permanente automatique (faux Meta)", () => {
  it("jeton : propre au contact, chiffré (aucun numéro lisible), 24 h, refusé s'il est modifié", () => {
    const now = Math.floor(Date.parse("2026-11-09T15:00:00Z") / 1000);
    const token = createDemoToken({ contactId: "contact-123", canalId: "pflow" }, SECRET, now);
    expect(Buffer.from(token, "base64url").toString("latin1")).not.toContain("contact-123");
    expect(readDemoToken(token, SECRET, now)).toEqual({ contactId: "contact-123", canalId: "pflow" });
    expect(readDemoToken(token, SECRET, now + 24 * 3600 + 1)).toBeNull(); // expiré
    expect(readDemoToken(token, "autre-secret", now)).toBeNull();
    const tampered = token.slice(0, 20) + (token[20] === "A" ? "B" : "A") + token.slice(21);
    expect(readDemoToken(tampered, SECRET, now)).toBeNull();
    expect(readDemoToken("pas-un-jeton", SECRET, now)).toBeNull();
    expect(etape3Seconds(undefined)).toBe(90);
    expect(etape3Seconds("120")).toBe(120);
    expect(etape3Seconds("5")).toBe(15);
    expect(etape3Seconds("abc")).toBe(90);
  });

  it("commande validée → confirmation (numéro, récap, options, total, paiement sur place, « démo ») puis étape 2/3 ; dashboard → étape 3/3 ~90 s plus tard, une seule fois", async () => {
    const t = await setup();
    const { url, token } = await t.start();
    expect(url.startsWith(`${DEMO_PERMANENTE.commandeUrl}&j=`)).toBe(true);
    expect(url).not.toContain("590690111111");

    // La page Mint Bun envoie la commande validée.
    let from = sent.length;
    const res = await handleDemoOrder(t.auto, { jeton: token, commande: order(42) });
    expect(res).toEqual({ ok: true, envoye: true });
    const msgs = t.out(from);
    expect(msgs).toHaveLength(2);
    expect(msgs.every((m) => m.to === "590690111111")).toBe(true);
    const confirmation = msgs[0].text!.body;
    expect(confirmation).toContain("✅ *Commande enregistrée !*");
    expect(confirmation).toContain("Mint Bun a bien reçu votre commande");
    expect(confirmation).toContain("*Commande #42* — à emporter");
    expect(confirmation).toContain("• 1× Burger + frites + boisson — 19,90 €");
    expect(confirmation).toContain("Spicy Matcha, Citronnade maison, + Supplément steak");
    expect(confirmation).toContain("*Total : 19,90 €*");
    expect(confirmation).toContain("Paiement sur place");
    expect(confirmation).toContain("_Commande de démo : rien n'est préparé._");
    // Étape 2/3, avec le lien du dashboard qui passe par PFlow Bots (jeton).
    expect(msgs[1].interactive).toMatchObject({ type: "cta_url", body: { text: PFLOW_TEXTS.step2 }, action: { parameters: { display_text: "Voir le dashboard" } } });
    const dashLink = msgs[1].interactive!.action.parameters!.url;
    expect(dashLink.startsWith(`${BOTS}/api/demo/dashboard/`)).toBe(true);
    let parcours = (await t.contactOf("590690111111")).demo!.parcours!;
    expect(parcours.etape).toBe(2);
    expect(parcours.derniereCommande?.numero).toBe(42);

    // Le prospect tape quand même « Retour sur WhatsApp » : pas de 2e étape 2, un rappel.
    const again = await t.say("590690111111", DEMO_PERMANENTE.retourCommande);
    expect(again[0].interactive?.body.text).toBe(PFLOW_TEXTS.remind2);

    // Ouverture du dashboard : redirection avec la commande après le #, étape 3 programmée.
    const dashToken = dashLink.split("/").pop()!;
    const open = await handleDemoDashboard(t.auto, dashToken);
    expect(open.programmee).toBe(true);
    expect(open.redirect.startsWith(`${DEMO_PERMANENTE.dashboardUrl}#commande=`)).toBe(true);
    const shown = JSON.parse(Buffer.from(open.redirect.split("#commande=")[1], "base64url").toString("utf8"));
    expect(shown).toMatchObject({ resto: "Mint Bun", numero: 42, total: 19.9 });
    expect(shown.articles[0].supplements.map((s: { nom: string }) => s.nom)).toContain("Supplément steak");
    expect((await handleDemoDashboard(t.auto, dashToken)).programmee).toBe(false); // déjà programmée

    // La tâche à la minute : rien avant 90 s (le prospect a pu fermer l'onglet), puis l'étape 3/3, une seule fois.
    t.clock.now = new Date("2026-11-09T15:01:00Z");
    from = sent.length;
    expect((await runDemoDue(t.auto)).envoyees).toBe(0);
    t.clock.now = new Date("2026-11-09T15:01:31Z");
    expect((await runDemoDue(t.auto)).envoyees).toBe(1);
    const step3 = t.out(from);
    expect(step3).toHaveLength(1);
    expect(step3[0].interactive?.body.text).toBe(PFLOW_TEXTS.step3);
    expect((step3[0].interactive?.action.buttons ?? []).map((b) => b.reply.title)).toEqual(["🙋 Je veux le mien", "Comment ça marche ?"]);
    parcours = (await t.contactOf("590690111111")).demo!.parcours!;
    expect(parcours.etape).toBe(3);
    expect(parcours.etape3EnvoyeeAt).toBeTruthy();
    expect(parcours.etape3Due).toBeUndefined();
    t.clock.now = new Date("2026-11-09T15:05:00Z");
    from = sent.length;
    expect((await runDemoDue(t.auto)).envoyees).toBe(0);
    expect((await handleDemoDashboard(t.auto, dashToken)).programmee).toBe(false); // jamais deux fois
    expect(t.out(from)).toHaveLength(0);
  });

  it("garde-fous : même commande une seule fois, 3 confirmations par heure, jeton faux / expiré / d'un autre contact, contact en pause", async () => {
    const t = await setup();
    const a = await t.start("590690111111");
    const b = await t.start("590690222222");

    // Jeton faux ou expiré : refus, rien n'est envoyé.
    let from = sent.length;
    expect(await handleDemoOrder(t.auto, { jeton: a.token.slice(0, -4) + "AAAA", commande: order(1) })).toMatchObject({ ok: false, status: 403 });
    t.clock.now = new Date("2026-11-10T15:00:01Z");
    expect(await handleDemoOrder(t.auto, { jeton: a.token, commande: order(1) })).toMatchObject({ ok: false, status: 403 });
    t.clock.now = new Date("2026-11-09T15:10:00Z");
    expect(await handleDemoOrder(t.auto, { jeton: a.token, commande: { numero: 1 } })).toMatchObject({ ok: false, status: 400 });
    expect(t.out(from)).toHaveLength(0);

    // Le jeton de B n'écrit qu'à B.
    from = sent.length;
    expect(await handleDemoOrder(t.auto, { jeton: b.token, commande: order(7) })).toEqual({ ok: true, envoye: true });
    expect(t.out(from).every((m) => m.to === "590690222222")).toBe(true);

    // Même commande renvoyée : pas de second envoi.
    from = sent.length;
    expect(await handleDemoOrder(t.auto, { jeton: b.token, commande: order(7) })).toEqual({ ok: true, envoye: false, raison: "deja_confirmee" });
    expect(t.out(from)).toHaveLength(0);

    // 3 confirmations par heure et par contact.
    for (const numero of [8, 9]) expect((await handleDemoOrder(t.auto, { jeton: b.token, commande: order(numero) })).ok).toBe(true);
    expect(await handleDemoOrder(t.auto, { jeton: b.token, commande: order(10) })).toMatchObject({ ok: false, status: 429 });
    t.clock.now = new Date("2026-11-09T16:11:00Z");
    expect(await handleDemoOrder(t.auto, { jeton: b.token, commande: order(11) })).toEqual({ ok: true, envoye: true });

    // A en pause (Jules a la main) : ni confirmation, ni étape 3.
    await t.say("590690111111", "Je veux le mien");
    from = sent.length;
    expect(await handleDemoOrder(t.auto, { jeton: a.token, commande: order(3) })).toEqual({ ok: true, envoye: false, raison: "pause" });
    expect(t.out(from, "590690111111")).toHaveLength(0);
  });

  it("étape 3 : pas d'envoi si Jules a repris la main entre-temps, ni si le prospect y est déjà arrivé à la main ; canal en test hors liste refusé", async () => {
    const t = await setup();
    const a = await t.start();
    await handleDemoOrder(t.auto, { jeton: a.token, commande: order(5) });
    expect((await handleDemoDashboard(t.auto, a.token)).programmee).toBe(true);
    // Le prospect revient tout de suite avec « J'ai vu le dashboard 👀 » : étape 3 par le texte…
    const now = await t.say("590690111111", DEMO_PERMANENTE.retourDashboard);
    expect(now[0].interactive?.body.text).toBe(PFLOW_TEXTS.step3);
    // … et la tâche ne la renvoie pas.
    t.clock.now = new Date("2026-11-09T15:05:00Z");
    let from = sent.length;
    await runDemoDue(t.auto);
    expect(t.out(from)).toHaveLength(0);

    // Autre prospect : programmé, puis « Je veux le mien » (pause) avant l'échéance → rien n'est envoyé.
    const b = await t.start("590690222222");
    await handleDemoOrder(t.auto, { jeton: b.token, commande: order(6) });
    await handleDemoDashboard(t.auto, b.token);
    await t.say("590690222222", "Je veux le mien");
    t.clock.now = new Date("2026-11-09T15:10:00Z");
    from = sent.length;
    const report = await runDemoDue(t.auto);
    expect(report.envoyees).toBe(0);
    expect(t.out(from, "590690222222")).toHaveLength(0);
    expect((await t.contactOf("590690222222")).demo!.parcours!.etape3Due).toBeUndefined();

    // Canal en test : un numéro hors liste ne peut rien déclencher.
    const test = await setup("test");
    const ok = await test.start("590690111111");
    expect((await handleDemoOrder(test.auto, { jeton: ok.token, commande: order(1) })).ok).toBe(true);
    const forged = createDemoToken({ contactId: "inconnu", canalId: "pflow" }, SECRET, Math.floor(test.clock.now.getTime() / 1000));
    expect(await handleDemoOrder(test.auto, { jeton: forged, commande: order(2) })).toMatchObject({ ok: false, status: 403 });
  });

  it("format exact envoyé par la page de commande du CRM (champs en plus : id, option_id, options) : accepté et nettoyé", async () => {
    const t = await setup();
    const { token } = await t.start();
    // Ligne telle que js/commande.js la produit (articlesDe), lien et astérisques glissés dans un nom.
    const fromCrm = {
      jeton: token,
      commande: {
        numero: 51, mode: "retrait", total: 15.9, creneau: "Dès que possible", client_nom: "Marie *gras*",
        articles: [{ id: "d0000000-0000-4000-8000-000000000001", nom: "Mint Classic https://pirate.example", prix: 12.9, qte: 1, total: 15.9, options: ["d0000000-0000-4000-8000-000000000901"],
          supplements: [{ groupe: "Suppléments", option_id: "d0000000-0000-4000-8000-000000000901", nom: "Supplément steak", prix: 3 }] }],
      },
    };
    const from = sent.length;
    expect(await handleDemoOrder(t.auto, fromCrm)).toEqual({ ok: true, envoye: true });
    const confirmation = t.out(from)[0].text!.body;
    expect(confirmation).toContain("• 1× Mint Classic — 15,90 €");
    expect(confirmation).toContain("+ Supplément steak");
    expect(confirmation).not.toContain("pirate.example");
    expect(confirmation).not.toContain("*gras*");
  });

  it("récap et dashboard : textes nettoyés (pas de lien, pas de mise en forme), lien simple sans commande", () => {
    const recap = formatDemoRecap({
      ...order(1),
      mode: "retrait",
      articles: [{ nom: "Mint Classic", qte: 2, prix: 12.9, total: 25.8, supplements: [] }],
    } as Parameters<typeof formatDemoRecap>[0]);
    expect(recap).toBe("• 2× Mint Classic — 25,80 €");
    expect(dashboardUrlWithOrder(undefined)).toBe(DEMO_PERMANENTE.dashboardUrl);
  });

  it("sans PFLOW_BOTS_SECRET : liens simples, rien d'automatique (le parcours manuel marche toujours)", async () => {
    const t = await setup();
    const noSecret = { ...t.auto, secret: undefined };
    expect(await handleDemoOrder(noSecret, { jeton: "x".repeat(20), commande: order(1) })).toMatchObject({ ok: false, status: 503 });
    expect((await handleDemoDashboard(noSecret, "x")).redirect).toBe(DEMO_PERMANENTE.dashboardUrl);
  });
});
