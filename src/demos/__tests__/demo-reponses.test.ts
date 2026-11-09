/**
 * Numéro PFlow Démo : réponses intelligentes en plein parcours (src/demos/demo-knowledge.ts).
 * Faux Meta (envois + vocal), faux modèle d'IA (réponses JSON choisies par le test), notifications push interceptées.
 * Cas demandés : salutation (pas d'alerte), question couverte (réponse, pas d'alerte), question non couverte (alerte),
 * prix non renseigné (alerte, aucun prix inventé), livraison (aucun détail, alerte), vocal transcrit avec un « ? » de politesse.
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
import type { AlertConfig } from "@/channels/core/alerts";
import type { Canal } from "@/channels/core/types";
import { createGraphClient } from "@/channels/whatsapp/graph";
import { createTranscriber } from "@/channels/voice/transcriber";
import { demoAnswerParams } from "@/ai/demo-claude";
import { demoDirectory } from "../lifecycle";
import { DEMO_PERMANENTE, PFLOW_TEXTS, pflowBaseBot } from "../pflow-bot";
import { guide } from "../parcours";
import {
  answerDemoQuestion,
  courtesyReply,
  DEFAULT_DEMO_KNOWLEDGE,
  demoSystemPrompt,
  forcedStatus,
  HANDOFF_REPLIES,
  type DemoCompletion,
} from "../demo-knowledge";

const PFLOW_PHONE = "1000000077";
const PROSPECT = "590690222222";

type Out = { type: string; to?: string; text?: { body: string }; interactive?: { type: string; body: { text: string }; action: { buttons?: { reply: { id: string; title: string } }[]; parameters?: { url: string } } } };

let server: Server;
let base = "";
const sent: Out[] = [];
let transcript = "";

/** Faux vocal Ogg/Opus de quelques secondes (durée lisible par src/channels/voice/duration.ts). */
function fakeOgg(seconds: number): Buffer {
  const page = (granule: number, payload: Buffer) => {
    const header = Buffer.alloc(27);
    header.write("OggS", 0, "latin1");
    header.writeUInt32LE(granule % 2 ** 32, 6);
    header.writeUInt32LE(Math.floor(granule / 2 ** 32), 10);
    header[26] = 1;
    return Buffer.concat([header, Buffer.from([payload.length]), payload]);
  };
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "latin1");
  head[8] = 1;
  head[9] = 1;
  head.writeUInt16LE(312, 10);
  return Buffer.concat([page(0, head), page(Math.round(seconds * 48_000) + 312, Buffer.alloc(40, 7))]);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = req.url ?? "";
      const json = (v: unknown) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(v));
      };
      if (url === "/v24.0/media-v") return json({ url: `${base}/fichier/media-v`, mime_type: "audio/ogg; codecs=opus" });
      if (url.startsWith("/fichier/")) {
        res.setHeader("content-type", "audio/ogg");
        return res.end(fakeOgg(3));
      }
      if (url === "/openai/v1/audio/transcriptions") return json({ text: ` ${transcript} ` });
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (body.type) sent.push(body);
      json({ messages: [{ id: `wamid.out${sent.length}` }] });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let n = 0;
const notif = (message: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: PFLOW_PHONE }, contacts: [{ wa_id: PROSPECT, profile: { name: "Marc" } }], messages: [{ from: PROSPECT, id: `wamid.r${++n}`, ...message }] } }] }],
});

/** Faux modèle : la réponse JSON dépend de la question (comme Claude Haiku avec la base). Garde chaque appel. */
function fakeModel(answers: Record<string, { statut: string; reponse: string }>) {
  const calls: { system: string; question: string }[] = [];
  const complete: DemoCompletion = async (input) => {
    calls.push(input);
    const hit = Object.entries(answers).find(([k]) => input.question.toLowerCase().includes(k));
    return JSON.stringify(hit ? hit[1] : { statut: "inconnu", reponse: "" });
  };
  return { complete, calls };
}

const HORAIRES = "Oui 🙂 Depuis votre tableau de bord, vous gérez vous-même vos horaires, votre carte, vos prix et vos ruptures.";

async function setup(model = fakeModel({})) {
  sent.length = 0;
  const repos = createLocalRepositories(createMemoryStore(), { now: () => new Date("2026-11-09T15:00:00Z") });
  await createMasterTemplate(repos);
  const data = await repos.workspace.exportAll();
  const canal: Canal = {
    id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: PFLOW_PHONE, triggerMode: "toujours",
    coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [], telAlerte: "",
  };
  const store = createMemoryChannelStore([canal]);
  await store.savePushSubscription({ userId: "jules", endpoint: "https://web.push.apple.com/iphone", p256dh: "cle", auth: "auth", appareil: "iPhone" });
  const notifications: { title: string; body: string }[] = [];
  const alerts: AlertConfig = {
    push: { publicKey: "pub", privateKey: "priv", subject: "https://pflow-bot-app.vercel.app", send: async (_s, payload) => (notifications.push(JSON.parse(payload)), { statusCode: 201 }) },
  };
  const clock = { now: new Date("2026-11-09T15:00:00Z") };
  const deps = {
    store,
    graph: createGraphClient({ token: "t", base, version: "v24.0" }),
    loadBot: async (id: string, options?: { demo?: boolean }) => loadBotFromWorkspace(data, id, options),
    loadDemos: async () => demoDirectory(data),
    now: () => clock.now,
    sleep: async () => {},
    alerts,
    demoAnswer: model.complete,
    transcriber: createTranscriber({ provider: "groq", apiKey: "k", base: `${base}/openai` }),
  };
  let seen = 0;
  const run = async (payload: unknown) => {
    const from = sent.length;
    await processWebhookPayload(payload, deps);
    // Une alerte au plus toutes les 30 min par contact : chaque message du test arrive 31 min après le précédent.
    clock.now = new Date(clock.now.getTime() + 31 * 60_000);
    const fresh = notifications.slice(seen);
    seen = notifications.length;
    return { msgs: sent.slice(from), alerts: fresh.map((x) => `${x.title} | ${x.body}`) };
  };
  const say = (t: string) => run(notif({ type: "text", text: { body: t } }));
  const voice = (said: string) => {
    transcript = said;
    return run(notif({ type: "audio", audio: { id: "media-v", mime_type: "audio/ogg; codecs=opus", voice: true } }));
  };
  // Le prospect démarre la démo : étape 1/3 en cours.
  await say("Tester la démo");
  return { say, voice, store, model, deps };
}

describe("PFlow Démo : réponses intelligentes", () => {
  it("salutation en plein parcours (« Salut, ça va ? ») : réponse sympa, rappel de l'étape, aucune alerte, pas d'appel à l'IA", async () => {
    const t = await setup();
    for (const [said, reply] of [
      ["Salut, ça va ?", "Ça va très bien, merci 😊 Et vous ?"],
      ["Bonjour !", "Bonjour 👋"],
      ["merci beaucoup", "Avec plaisir 😊"],
      ["ok super", "Super 👍"],
    ]) {
      const r = await t.say(said);
      expect(r.msgs[0].text?.body, said).toBe(reply);
      expect(r.msgs[1].interactive?.body.text, said).toBe(PFLOW_TEXTS.remind1);
      expect(r.alerts, said).toHaveLength(0);
      expect(JSON.stringify(r.msgs)).not.toContain(PFLOW_TEXTS.question);
    }
    expect(t.model.calls).toHaveLength(0);
    expect(await t.store.listTransferts("pflow")).toHaveLength(0);
  });

  it("question couverte par la base (horaires) : l'IA répond, puis l'étape reprend avec [💬 Parler à Jules] ; aucune alerte", async () => {
    const t = await setup(fakeModel({ horaires: { statut: "repondu", reponse: HORAIRES } }));
    const r = await t.say("Est-ce que je pourrais renseigner les horaires de mon restaurant avec le système ?");
    expect(r.msgs[0].text?.body).toBe(HORAIRES);
    expect(r.msgs[1].interactive).toMatchObject({ type: "cta_url", body: { text: PFLOW_TEXTS.remind1 }, action: { parameters: { url: DEMO_PERMANENTE.commandeUrl } } });
    expect((r.msgs[2].interactive?.action.buttons ?? []).map((b) => b.reply.title)).toEqual(["✅ C'est fait", "💬 Parler à Jules"]);
    expect(r.alerts).toHaveLength(0);
    expect(await t.store.listTransferts("pflow")).toHaveLength(0);
    // L'IA a reçu la base (FAQ + règles) et la question.
    expect(t.model.calls).toHaveLength(1);
    expect(t.model.calls[0].system).toContain("ses horaires");
    expect(t.model.calls[0].system).toContain("Ne jamais inventer un prix");
  });

  it("question non couverte : « Bonne question ! Jules vous répond très vite », alerte push avec la question, le bot continue", async () => {
    const t = await setup();
    const r = await t.say("Est-ce que ça marche avec ma caisse Zelty ?");
    expect(r.msgs[0].text?.body).toBe(HANDOFF_REPLIES.inconnu.texte);
    expect(r.msgs[1].interactive?.body.text).toBe(PFLOW_TEXTS.remind1);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toContain("Question sans réponse dans la base");
    expect(r.alerts[0]).toContain("Zelty");
    const transferts = await t.store.listTransferts("pflow");
    expect(transferts).toHaveLength(1);
    expect((await t.store.listContacts("pflow"))[0].state.pause).toBeFalsy();
  });

  it("prix non renseigné (option payante) : alerte, aucun prix inventé, même si l'IA en invente un", async () => {
    // L'IA « invente » 15 € : le garde-fou le refuse (montant absent de la base) et passe la main à Jules.
    const t = await setup(fakeModel({ stock: { statut: "repondu", reponse: "La gestion du stock coûte 15 € par mois." } }));
    const r = await t.say("Combien coûte l'option gestion du stock ?");
    expect(JSON.stringify(r.msgs)).not.toContain("15 €");
    expect(r.msgs[0].text?.body).toBe(HANDOFF_REPLIES.inconnu.texte);
    expect(r.alerts).toHaveLength(1);
    // Négociation : Jules, sans même demander à l'IA.
    const before = t.model.calls.length;
    const r2 = await t.say("Vous pouvez me faire une remise sur l'abonnement ?");
    expect(r2.msgs[0].text?.body).toBe(HANDOFF_REPLIES.prix.texte);
    expect(r2.alerts).toHaveLength(1);
    expect(r2.alerts[0]).toContain("Question de prix / négociation");
    expect(t.model.calls.length).toBe(before);
  });

  it("le prix de l'abonnement (dans la base) est donné ; « 49 € » passe le garde-fou", async () => {
    const t = await setup(fakeModel({ combien: { statut: "repondu", reponse: "L'abonnement PFlow Order est à 49 €/mois, sans engagement et sans commission." } }));
    const r = await t.say("Ça coûte combien par mois ?");
    expect(r.msgs[0].text?.body).toContain("49 €/mois");
    expect(r.alerts).toHaveLength(0);
  });

  it("livraison : « en préparation, plusieurs formules à venir », aucun détail, alerte à Jules ; inscription et « parler à Jules » aussi", async () => {
    const t = await setup();
    let r = await t.say("Vous faites la livraison ? C'est combien ?");
    expect(r.msgs[0].text?.body).toBe(HANDOFF_REPLIES.livraison.texte);
    expect(r.alerts[0]).toContain("Question sur la livraison");
    r = await t.say("Je veux m'inscrire, comment on fait ?");
    expect(r.msgs[0].text?.body).toBe(HANDOFF_REPLIES.inscription.texte);
    expect(r.alerts[0]).toContain("Veut s'inscrire");
    expect(t.model.calls).toHaveLength(0); // repérés sans l'IA
  });

  it("vocal transcrit avec un « ? » de politesse (« Salut ça va ? ») : réponse sympa, aucune alerte", async () => {
    const t = await setup();
    const r = await t.voice("Salut ça va ?");
    expect(r.msgs[0].text?.body).toBe("Ça va très bien, merci 😊 Et vous ?");
    expect(r.msgs[1].interactive?.body.text).toBe(PFLOW_TEXTS.remind1);
    expect(r.alerts).toHaveLength(0);
    expect(t.model.calls).toHaveLength(0);
  });

  it("vocal avec une vraie question couverte : l'IA répond, aucune alerte", async () => {
    const t = await setup(fakeModel({ horaires: { statut: "repondu", reponse: HORAIRES } }));
    const r = await t.voice("Est-ce que je pourrais renseigner les horaires de mon restaurant avec le système ?");
    expect(r.msgs[0].text?.body).toBe(HORAIRES);
    expect(r.alerts).toHaveLength(0);
  });

  it("IA en panne : « Jules vous répond », alerte (rien n'est inventé)", async () => {
    const t = await setup({ complete: async () => { throw new Error("délai dépassé"); }, calls: [] });
    const r = await t.say("Est-ce que je peux mettre des photos sur ma carte ?");
    expect(r.msgs[0].text?.body).toBe(HANDOFF_REPLIES.inconnu.texte);
    expect(r.alerts).toHaveLength(1);
  });

  it("question AVANT de démarrer la démo : réponse de l'IA + [Tester la démo] [💬 Parler à Jules]", async () => {
    const model = fakeModel({ sumup: { statut: "repondu", reponse: "Oui, le paiement en ligne est inclus, avec SumUp ou Stripe 🙂" } });
    const t = await setup(model);
    // Nouveau prospect : autre numéro.
    const fresh = notif({ type: "text", text: { body: "Ça marche avec SumUp ?" } });
    (fresh.entry[0].changes[0].value.contacts[0] as { wa_id: string }).wa_id = "590690333333";
    (fresh.entry[0].changes[0].value.messages[0] as { from: string }).from = "590690333333";
    const from = sent.length;
    await processWebhookPayload(fresh, t.deps);
    const msgs = sent.slice(from);
    expect(msgs[0].interactive?.body.text).toContain("SumUp ou Stripe");
    expect((msgs[0].interactive?.action.buttons ?? []).map((b) => b.reply.title)).toEqual(["Tester la démo", "💬 Parler à Jules"]);
  });
});

describe("base de connaissances (fonctions pures)", () => {
  it("politesse : seulement des mots de politesse, 8 mots max", () => {
    expect(courtesyReply("Salut, ça va ?")).toBe("Ça va très bien, merci 😊 Et vous ?");
    expect(courtesyReply("cc ça va ?")).toBe("Ça va très bien, merci 😊 Et vous ?");
    expect(courtesyReply("Bonne journée !")).toBe("Merci à vous, à très vite 👋");
    expect(courtesyReply("ok")).toBe("Super 👍");
    expect(courtesyReply("Bonjour, c'est payant ?")).toBeNull();
    expect(courtesyReply("Salut, je peux gérer mes horaires ?")).toBeNull();
    expect(courtesyReply("")).toBeNull();
    // Le parcours : politesse en plein parcours → réponse + rappel ; avant la démo → l'accueil.
    const flows = pflowBaseBot().flows;
    const now = new Date("2026-11-09T12:00:00Z");
    expect(guide({ kind: "text", text: "Salut ça va ?" }, flows, { etape: 2, at: now.toISOString() }, now)).toMatchObject({ courtesy: "Ça va très bien, merci 😊 Et vous ?", step: 2 });
    expect(guide({ kind: "text", text: "Salut ça va ?" }, flows, undefined, now).courtesy).toBeUndefined();
  });

  it("catégories toujours confiées à Jules (sans l'IA)", () => {
    expect(forcedStatus("Vous livrez à Baie-Mahault ?")).toBe("livraison");
    expect(forcedStatus("et la livraison ?")).toBe("livraison");
    expect(forcedStatus("Vous pouvez faire un geste commercial ?")).toBe("prix");
    expect(forcedStatus("je veux signer")).toBe("inscription");
    expect(forcedStatus("Je voudrais parler à quelqu'un")).toBe("parler_jules");
    expect(forcedStatus("Je peux renseigner mes horaires ?")).toBeNull(); // « renseigner » n'est pas « signer »
    expect(forcedStatus("Combien coûte l'abonnement ?")).toBeNull(); // un prix de la base : l'IA répond
  });

  it("garde-fous sur la réponse de l'IA : montant absent de la base, livraison, JSON invalide, réponse vide", async () => {
    const kb = DEFAULT_DEMO_KNOWLEDGE;
    const ask = (raw: string, q = "Une question ?") => answerDemoQuestion(async () => raw, kb, q);
    expect(await ask(JSON.stringify({ statut: "repondu", reponse: "C'est 49 € par mois." }))).toEqual({ statut: "repondu", reponse: "C'est 49 € par mois." });
    expect((await ask(JSON.stringify({ statut: "repondu", reponse: "Comptez 29,90 euros de frais." }))).statut).toBe("inconnu");
    expect((await ask(JSON.stringify({ statut: "repondu", reponse: "La livraison coûte 3 €." }))).statut).toBe("livraison");
    expect((await ask("pas du json")).statut).toBe("inconnu");
    expect((await ask(JSON.stringify({ statut: "repondu", reponse: "  " }))).statut).toBe("inconnu");
    expect((await ask(JSON.stringify({ statut: "n_importe_quoi", reponse: "x" }))).statut).toBe("inconnu");
    expect(await ask(JSON.stringify({ statut: "prix", reponse: "15 €" }))).toEqual({ statut: "prix", reponse: "" });
  });

  it("la base par défaut contient ce que Jules a demandé ; la consigne interdit d'inventer", () => {
    const faq = DEFAULT_DEMO_KNOWLEDGE.faq;
    for (const ligne of [
      "49 €/mois, sans engagement, sans commission sur les commandes",
      "Pas de frais de mise en place : seulement l'abonnement à 49 €/mois, sans engagement, sans commission.",
      "à ses couleurs, avec sa carte",
      "Un assistant WhatsApp",
      "le mode rush et les pauses",
      "SumUp ou Stripe",
      "prévenu sur WhatsApp quand sa commande est prête",
      "gestion du stock, relance des paniers, avis Google",
      "Livraison : en cours de développement, plusieurs formules à venir.",
    ]) expect(faq).toContain(ligne);
    const system = demoSystemPrompt(DEFAULT_DEMO_KNOWLEDGE);
    expect(system).toContain("Tu n'inventes JAMAIS un prix");
    expect(system).toContain(faq);
  });

  it("appel à Claude : sortie JSON structurée, consigne en cache, réflexion coupée sur Haiku", () => {
    const params = demoAnswerParams("claude-haiku-5-5", { system: "BASE", question: "Q ?" });
    expect(params).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 400, messages: [{ role: "user", content: "Q ?" }] });
    expect(JSON.stringify(params)).toContain("json_schema");
    expect(JSON.stringify(params)).toContain("ephemeral");
  });
});
