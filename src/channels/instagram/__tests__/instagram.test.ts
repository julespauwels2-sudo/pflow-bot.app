import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import { loadBotFromWorkspace } from "../../core/bot-loader";
import { createMemoryChannelStore } from "../../core/memory-store";
import { processEvents } from "../../core/processor";
import type { Canal } from "../../core/types";
import { parseInstagramWebhook } from "../parse";
import { createInstagramSender, plainInstagramText, toInstagramPayload } from "../send";

const ACCOUNT = "17841400000000001";
const CLIENT = "6000000000001";
let n = 0;
const notif = (messaging: unknown[]) => ({ object: "instagram", entry: [{ id: ACCOUNT, time: 1, messaging }] });
const text = (t: string) => ({ sender: { id: CLIENT }, recipient: { id: ACCOUNT }, timestamp: 1762300000000, message: { mid: `m_${++n}`, text: t } });

describe("Instagram : lecture des notifications", () => {
  it("texte, réponse rapide, postback, vocal, écho du resto, lu", () => {
    const { inbound, statuses } = parseInstagramWebhook(
      notif([
        text("bonjour"),
        { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, message: { mid: "m_q", text: "Oui", quick_reply: { payload: "r1" } } },
        { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, postback: { mid: "m_p", title: "Commander", payload: "p1" } },
        { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, message: { mid: "m_a", attachments: [{ type: "audio", payload: { url: "https://cdn.example/voc.mp4" } }] } },
        { sender: { id: ACCOUNT }, recipient: { id: CLIENT }, message: { mid: "m_e", text: "Je m'en occupe", is_echo: true } },
        { sender: { id: ACCOUNT }, recipient: { id: CLIENT }, message: { mid: "m_bot", text: "réponse du bot", is_echo: true, app_id: 123 } },
        { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, read: { mid: "m_out1" } },
      ]),
    );
    expect(inbound.map((e) => [e.waId, e.message])).toEqual([
      [CLIENT, { kind: "text", text: "bonjour" }],
      [CLIENT, { kind: "button_reply", id: "r1", title: "Oui" }],
      [CLIENT, { kind: "button_reply", id: "p1", title: "Commander" }],
      [CLIENT, { kind: "unsupported", mediaType: "audio" }],
      [CLIENT, { kind: "echo", text: "Je m'en occupe" }],
    ]);
    expect(inbound[3].media).toEqual({ url: "https://cdn.example/voc.mp4" });
    expect(inbound.every((e) => e.plateforme === "instagram" && e.accountId === ACCOUNT)).toBe(true);
    expect(statuses).toEqual([{ plateforme: "instagram", accountId: ACCOUNT, wamid: "m_out1", statut: "lu" }]);
    expect(parseInstagramWebhook({ object: "whatsapp_business_account" }).inbound).toEqual([]);
  });

  it("formats adaptés : réponses rapides (13 max, 20 car.), bouton lien, texte coupé à 1 000", () => {
    expect(toInstagramPayload("u", { kind: "buttons", text: "?", buttons: [{ id: "a", title: "Un titre beaucoup trop long" }] })).toEqual({
      recipient: { id: "u" },
      message: { text: "?", quick_replies: [{ content_type: "text", title: "Un titre beaucoup t…", payload: "a" }] },
    });
    const list = toInstagramPayload("u", { kind: "list", text: "?", buttonLabel: "Voir", items: Array.from({ length: 15 }, (_, i) => ({ id: `l${i}`, title: `Choix ${i}` })) });
    expect((list!.message as { quick_replies: unknown[] }).quick_replies).toHaveLength(13);
    expect(toInstagramPayload("u", { kind: "link", text: "Go", url: "https://x", buttonLabel: "Commander" })).toMatchObject({
      message: { attachment: { type: "template", payload: { template_type: "button", buttons: [{ type: "web_url", url: "https://x", title: "Commander" }] } } },
    });
    expect(((toInstagramPayload("u", { kind: "text", text: "x".repeat(1200) })!.message as { text: string }).text).length).toBe(1000);
  });
});

describe("Instagram : mise en forme", () => {
  it("retire *gras*, _italique_, ~barré~ et ```code``` sans toucher au reste", () => {
    expect(plainInstagramText("ℹ️ *Infos pratiques*\nQue souhaitez-vous _savoir_ ?")).toBe("ℹ️ Infos pratiques\nQue souhaitez-vous savoir ?");
    expect(plainInstagramText("~5 €~ *4 €* (promo)")).toBe("5 € 4 € (promo)");
    expect(plainInstagramText("```code```")).toBe("code");
    expect(plainInstagramText("2 * 3 = 6, mon_adresse, 5*")).toBe("2 * 3 = 6, mon_adresse, 5*");
  });
});

describe("Instagram de bout en bout contre un faux serveur", () => {
  const received: { path: string; body: Record<string, unknown> }[] = [];
  let server: Server;
  let base = "";
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ path: req.url ?? "", body: JSON.parse(body || "{}") });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ recipient_id: CLIENT, message_id: `m_out${received.length}` }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("« bonjour » : l'Accueil part en bouton lien + réponses rapides ; un clic suit le bon chemin ; l'écho met en pause", async () => {
    let k = 0;
    const repos = createLocalRepositories(createMemoryStore(), { newId: () => `id${++k}`, now: () => new Date("2026-11-05T15:00:00Z") });
    const template = await createMasterTemplate(repos);
    const client = await repos.clients.create({ nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou" });
    await repos.bots.link(client.id, template.id);
    const workspace = await repos.workspace.exportAll();
    const canal: Canal = {
      id: "ig1", restaurantId: client.id, plateforme: "instagram", accountId: ACCOUNT, triggerMode: "mots_cles_uniquement", coexistence: true,
      echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [],
    };
    const store = createMemoryChannelStore([canal]);
    const deps = { store, graph: createInstagramSender({ token: "jeton-ig", base, version: "v24.0" }), loadBot: async (id: string) => loadBotFromWorkspace(workspace, id), now: () => new Date("2026-11-05T15:00:00Z"), sleep: async () => {}, pflowBotsSecret: "secret-pflow" };

    const report = await processEvents(parseInstagramWebhook(notif([text("Bonjour !")])), deps);
    expect(report.errors).toEqual([]);
    const sent = received.filter((r) => r.body.message);
    expect(sent[0].path).toBe(`/v24.0/${ACCOUNT}/messages`);
    expect(sent[0].body).toMatchObject({ recipient: { id: CLIENT }, message: { attachment: { payload: { template_type: "button", buttons: [{ url: "https://order.pflow.fr/c/cookies-an-nou?via=ig" }] } } } });
    const quick = (sent[1].body.message as { quick_replies: { title: string; payload: string }[] }).quick_replies;
    expect(quick.map((q) => q.title)).toEqual(["⭐ Me conseiller", "ℹ️ Infos pratiques"]);
    expect(received.some((r) => r.body.sender_action === "typing_on")).toBe(true);

    const infos = quick.find((q) => q.title.includes("Infos"))!;
    await processEvents(parseInstagramWebhook(notif([{ sender: { id: CLIENT }, recipient: { id: ACCOUNT }, message: { mid: "m_click", text: infos.title, quick_reply: { payload: infos.payload } } }])), deps);
    expect(received.filter((r) => r.body.message).at(-1)?.body).toMatchObject({ message: { text: "ℹ️ Infos pratiques\nQue souhaitez-vous savoir ?" } });

    await processEvents(parseInstagramWebhook(notif([{ sender: { id: ACCOUNT }, recipient: { id: CLIENT }, message: { mid: "m_echo", text: "Je réponds moi-même", is_echo: true } }])), deps);
    const count = received.length;
    await processEvents(parseInstagramWebhook(notif([text("bonjour")])), deps);
    expect(received.length).toBe(count);
    expect((await store.listContacts("ig1"))[0].state.pause?.reason).toBe("echo_gerant");
  });
});
