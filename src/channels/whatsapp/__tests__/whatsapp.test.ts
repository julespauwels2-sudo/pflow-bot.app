import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import { loadBotFromWorkspace } from "../bot-loader";
import { createGraphClient, toGraphPayload } from "../graph";
import { createMemoryChannelStore } from "../memory-store";
import { parseWebhook } from "../parse";
import { processWebhookPayload } from "../processor";
import { signBody, verifyChallenge, verifySignature } from "../signature";
import type { Canal } from "../types";

const PHONE_ID = "1000000001";
const CLIENT_WA = "590690000001";

function payload(messages: unknown[], field = "messages", extra: Record<string, unknown> = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field,
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "590690999999", phone_number_id: PHONE_ID },
              contacts: [{ wa_id: CLIENT_WA, profile: { name: "Léa Martin" } }],
              ...(field === "messages" ? { messages } : { message_echoes: messages }),
              ...extra,
            },
          },
        ],
      },
    ],
  };
}
let n = 0;
const text = (body: string) => ({ from: CLIENT_WA, id: `wamid.in${++n}`, timestamp: "1762300000", type: "text", text: { body } });

describe("signature et vérification du webhook", () => {
  it("accepte la bonne signature, refuse le reste", () => {
    const body = JSON.stringify({ a: 1 });
    expect(verifySignature(body, signBody(body, "secret"), "secret")).toBe(true);
    expect(verifySignature(body, signBody(body, "autre"), "secret")).toBe(false);
    expect(verifySignature(body + " ", signBody(body, "secret"), "secret")).toBe(false);
    expect(verifySignature(body, null, "secret")).toBe(false);
  });

  it("renvoie le challenge seulement avec la bonne phrase", () => {
    const ok = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "phrase", "hub.challenge": "42" });
    expect(verifyChallenge(ok, "phrase")).toBe("42");
    expect(verifyChallenge(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "faux", "hub.challenge": "42" }), "phrase")).toBeNull();
    expect(verifyChallenge(ok, "")).toBeNull();
  });
});

describe("lecture des notifications de Meta", () => {
  it("texte, boutons, listes, médias, réactions, statuts et échos", () => {
    const { inbound, statuses } = parseWebhook(
      payload(
        [
          text("bonjour"),
          { from: CLIENT_WA, id: "wamid.b", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "r1", title: "Oui" } } },
          { from: CLIENT_WA, id: "wamid.l", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "l1", title: "Pizza" } } },
          { from: CLIENT_WA, id: "wamid.a", type: "audio", audio: { id: "x" } },
          { from: CLIENT_WA, id: "wamid.r", type: "reaction", reaction: { emoji: "👍" } },
        ],
        "messages",
        { statuses: [{ id: "wamid.out1", status: "read" }, { id: "wamid.out2", status: "failed", errors: [{ title: "Fenêtre fermée" }] }] },
      ),
    );
    expect(inbound.map((e) => e.message)).toEqual([
      { kind: "text", text: "bonjour" },
      { kind: "button_reply", id: "r1", title: "Oui" },
      { kind: "list_reply", id: "l1", title: "Pizza" },
      { kind: "unsupported", mediaType: "audio" },
      { kind: "unsupported", mediaType: "reaction" },
    ]);
    expect(inbound[0].profileName).toBe("Léa Martin");
    expect(inbound[4].ignored).toBe(true);
    expect(statuses).toEqual([
      { phoneNumberId: PHONE_ID, wamid: "wamid.out1", statut: "lu" },
      { phoneNumberId: PHONE_ID, wamid: "wamid.out2", statut: "echec", erreur: "Fenêtre fermée" },
    ]);
    const echo = parseWebhook(payload([{ from: "590690999999", to: CLIENT_WA, id: "wamid.e", type: "text", text: { body: "Je m'en occupe" } }], "smb_message_echoes"));
    expect(echo.inbound[0]).toMatchObject({ waId: CLIENT_WA, message: { kind: "echo", text: "Je m'en occupe" } });
    expect(parseWebhook({ object: "page" }).inbound).toEqual([]);
  });

  it("formats d'envoi Graph : texte, boutons, liste, bouton lien", () => {
    expect(toGraphPayload("1", { kind: "text", text: "Salut" })).toMatchObject({ type: "text", text: { body: "Salut" } });
    expect(toGraphPayload("1", { kind: "buttons", text: "?", buttons: [{ id: "a", title: "A" }] })).toMatchObject({
      type: "interactive",
      interactive: { type: "button", action: { buttons: [{ type: "reply", reply: { id: "a", title: "A" } }] } },
    });
    expect(toGraphPayload("1", { kind: "list", text: "?", buttonLabel: "Voir", items: [{ id: "x", title: "X" }] })).toMatchObject({
      interactive: { type: "list", action: { button: "Voir", sections: [{ rows: [{ id: "x", title: "X" }] }] } },
    });
    expect(toGraphPayload("1", { kind: "link", text: "Go", url: "https://x", buttonLabel: "Commander" })).toMatchObject({
      interactive: { type: "cta_url", action: { name: "cta_url", parameters: { display_text: "Commander", url: "https://x" } } },
    });
    expect(toGraphPayload("1", { kind: "typing", ms: 1000 })).toBeNull();
  });
});

describe("de bout en bout contre un faux serveur Meta", () => {
  const received: { path: string; auth?: string; body: Record<string, unknown> }[] = [];
  let server: Server;
  let base = "";
  let refuse = false;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const json = JSON.parse(body || "{}");
        received.push({ path: req.url ?? "", auth: req.headers.authorization, body: json });
        res.setHeader("content-type", "application/json");
        if (refuse && json.type) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: { message: "Re-engagement message" } }));
        }
        res.end(JSON.stringify(json.status === "read" ? { success: true } : { messages: [{ id: `wamid.out${received.length}` }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  async function setup(canalPatch: Partial<Canal> = {}) {
    let k = 0;
    const repos = createLocalRepositories(createMemoryStore(), { newId: () => `id${++k}`, now: () => new Date("2026-11-05T15:00:00Z") });
    const template = await createMasterTemplate(repos);
    const client = await repos.clients.create({ nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou" });
    await repos.bots.link(client.id, template.id);
    const workspace = await repos.workspace.exportAll();
    const canal: Canal = {
      id: "canal1",
      restaurantId: client.id,
      phoneNumberId: PHONE_ID,
      wabaId: "WABA",
      triggerMode: "mots_cles_uniquement",
      coexistence: true,
      echoPauseHours: 12,
      handoffPauseHours: 24,
      sessionMinutes: 30,
      etat: "actif",
      testNumeros: [],
      ...canalPatch,
    };
    const store = createMemoryChannelStore([canal]);
    const graph = createGraphClient({ token: "jeton-test", base, version: "v24.0" });
    const deps = { store, graph, loadBot: async (id: string) => loadBotFromWorkspace(workspace, id), now: () => new Date("2026-11-05T15:00:00Z"), sleep: async () => {} };
    return { store, deps, canal };
  }
  const sentMessages = () => received.filter((r) => r.body.type);

  it("« bonjour » : l'Accueil part (bouton lien + boutons), une seule fois même si Meta renvoie", async () => {
    received.length = 0;
    const { store, deps } = await setup();
    const p = payload([text("Bonjour !")]);
    const report = await processWebhookPayload(p, deps);
    expect(report.errors).toEqual([]);
    expect(report.handled[0].outgoing).toBe(2);
    const [first, second] = sentMessages();
    expect(first.path).toBe(`/v24.0/${PHONE_ID}/messages`);
    expect(first.auth).toBe("Bearer jeton-test");
    expect(first.body).toMatchObject({ to: CLIENT_WA, interactive: { type: "cta_url", action: { parameters: { url: "https://order.pflow.fr/c/cookies-an-nou" } } } });
    expect(second.body).toMatchObject({ interactive: { type: "button" } });
    expect(received.find((r) => r.body.status === "read")?.body).toMatchObject({ typing_indicator: { type: "text" } });

    // Renvoi du même message par Meta : rien ne repart.
    const count = sentMessages().length;
    const again = await processWebhookPayload(p, deps);
    expect(again.skipped).toEqual([{ wamid: expect.any(String), reason: "déjà reçu" }]);
    expect(sentMessages().length).toBe(count);

    // Clic sur « Infos pratiques » : le bouton renvoyé par le bot fonctionne.
    const buttons = (second.body.interactive as { action: { buttons: { reply: { id: string; title: string } }[] } }).action.buttons;
    const infos = buttons.find((b) => b.reply.title.includes("Infos"))!.reply;
    await processWebhookPayload(payload([{ from: CLIENT_WA, id: "wamid.click", type: "interactive", interactive: { type: "button_reply", button_reply: infos } }]), deps);
    expect(sentMessages().at(-1)?.body).toMatchObject({ interactive: { type: "button", body: { text: "ℹ️ *Infos pratiques*\nQue souhaitez-vous savoir ?" } } });

    // Boîte de réception : messages entrants et sortants notés.
    const contact = (await store.listContacts("canal1"))[0];
    const messages = await store.listMessages(contact.id);
    expect(messages.map((m) => m.sens)).toEqual(["entrant", "sortant", "sortant", "entrant", "sortant"]);
  });

  it("coexistence : le gérant répond depuis son appli → le bot se tait 12 h", async () => {
    received.length = 0;
    const { store, deps } = await setup();
    await processWebhookPayload(payload([{ from: "590690999999", to: CLIENT_WA, id: "wamid.echo1", type: "text", text: { body: "Je m'en occupe" } }], "smb_message_echoes"), deps);
    const contact = (await store.listContacts("canal1"))[0];
    expect(contact.state.pause).toMatchObject({ reason: "echo_gerant" });
    await processWebhookPayload(payload([text("bonjour")]), deps);
    expect(sentMessages()).toEqual([]);
    expect((await store.listMessages(contact.id)).map((m) => m.sens)).toEqual(["echo", "entrant"]);
  });

  it("canal en test : seuls les numéros de test reçoivent une réponse ; canal inconnu ignoré", async () => {
    received.length = 0;
    const { deps } = await setup({ etat: "test", testNumeros: ["590690000002"] });
    const report = await processWebhookPayload(payload([text("bonjour")]), deps);
    expect(report.skipped[0].reason).toContain("test");
    expect(sentMessages()).toEqual([]);
    const other = await processWebhookPayload({ ...payload([text("bonjour")]), entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "999" }, messages: [text("x")] } }] }] }, deps);
    expect(other.skipped[0].reason).toContain("numéro inconnu");
  });

  it("transfert humain : alerte notée ; envoi refusé par Meta : noté en échec sans planter", async () => {
    received.length = 0;
    const { store, deps } = await setup({ triggerMode: "toujours" });
    // L'Accueil (flux par défaut) puis un texte libre : l'IA (simulée) passe la main à l'équipe.
    await processWebhookPayload(payload([text("salut")]), deps);
    const withAi = { ...deps, ai: async () => ({ decision: { action: "transfert_humain" as const, texte: "" }, usage: { inputTokens: 1, outputTokens: 1 } }) };
    await processWebhookPayload(payload([text("j'ai un problème avec ma commande")]), withAi);
    expect((await store.listTransferts("canal1"))[0]).toMatchObject({ source: "ia", dernierMessage: "j'ai un problème avec ma commande" });

    // Contact en pause après le transfert : le message suivant ne reçoit pas de réponse du bot.
    const sentBefore = sentMessages().length;
    await processWebhookPayload(payload([text("bonjour")]), deps);
    expect(sentMessages().length).toBe(sentBefore);

    const fresh = await setup();
    refuse = true;
    const report = await processWebhookPayload(payload([text("bonjour")]), fresh.deps);
    refuse = false;
    expect(report.errors[0]).toContain("Re-engagement message");
    const contact = (await fresh.store.listContacts("canal1"))[0];
    expect((await fresh.store.listMessages(contact.id)).at(-1)).toMatchObject({ statut: "echec" });
  });

  it("statuts d'envoi : le message passe en « lu »", async () => {
    received.length = 0;
    const { store, deps } = await setup();
    await processWebhookPayload(payload([text("bonjour")]), deps);
    const contact = (await store.listContacts("canal1"))[0];
    const out = (await store.listMessages(contact.id)).find((m) => m.sens === "sortant")!;
    await processWebhookPayload(payload([], "messages", { statuses: [{ id: out.wamid, status: "read" }] }), deps);
    expect((await store.listMessages(contact.id)).find((m) => m.id === out.id)?.statut).toBe("lu");
  });
});
