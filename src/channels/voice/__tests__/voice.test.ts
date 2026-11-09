import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import { loadBotFromWorkspace } from "../../core/bot-loader";
import { allowedMediaUrl } from "../../core/media";
import { createMemoryChannelStore } from "../../core/memory-store";
import { processEvents, processWebhookPayload, VOICE_TEXTS } from "../../core/processor";
import { messageText } from "../../core/inbox";
import { audioDurationSeconds, formatDuration } from "../duration";
import type { Canal } from "../../core/types";
import { parseInstagramWebhook } from "../../instagram/parse";
import { createInstagramSender } from "../../instagram/send";
import { createGraphClient } from "../../whatsapp/graph";
import { parseWebhook } from "../../whatsapp/parse";
import { createTranscriber, DEFAULT_VOICE_LIMITS, MAX_AUDIO_BYTES, transcriberFromEnv, transcriptionStatus, VOCABULARY_HINT, voiceLimitsFromEnv } from "../transcriber";

const PHONE_ID = "1000000001";
const CLIENT = "590690000001";
const AUDIO = Buffer.from("OggS-faux-vocal");
/** Fichier servi par le faux Meta (changé par certains tests). */
let audioFile: Buffer = AUDIO;

type Call = { method?: string; path: string; headers: IncomingMessage["headers"]; body: Buffer };
let server: Server;
let base = "";
const calls: Call[] = [];
let transcript = "bonjour";

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      calls.push({ method: req.method, path: req.url ?? "", headers: req.headers, body });
      const url = req.url ?? "";
      const json = (v: unknown) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(v));
      };
      if (url === "/v24.0/media-1") return json({ url: `${base}/fichier/media-1`, mime_type: "audio/ogg; codecs=opus", file_size: AUDIO.length });
      if (url.startsWith("/fichier/")) {
        res.setHeader("content-type", "audio/ogg");
        return res.end(audioFile);
      }
      if (url === "/v1/audio/transcriptions" || url === "/openai/v1/audio/transcriptions") return json({ text: ` ${transcript} ` });
      if (url.startsWith("/v1/listen")) return json({ results: { channels: [{ alternatives: [{ transcript }] }] } });
      if (url.endsWith("/messages")) return json({ messages: [{ id: `wamid.out${calls.length}` }], message_id: `m_out${calls.length}` });
      res.statusCode = 404;
      json({ error: { message: "inconnu" } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => {
  calls.length = 0;
  transcript = "bonjour";
  audioFile = AUDIO;
});

describe("services de transcription (interchangeables)", () => {
  it("OpenAI et Mistral : formulaire avec le fichier, langue fr ; Deepgram : audio brut", async () => {
    for (const provider of ["openai", "mistral"] as const) {
      calls.length = 0;
      const t = createTranscriber({ provider, apiKey: "cle-test", base });
      expect(await t.transcribe(new Uint8Array(AUDIO), "audio/ogg")).toBe("bonjour");
      expect(calls[0].path).toBe("/v1/audio/transcriptions");
      expect(calls[0].headers.authorization).toBe("Bearer cle-test");
      const form = calls[0].body.toString();
      expect(form).toContain('name="language"');
      expect(form).toContain("fr");
      expect(form).toContain(provider === "openai" ? "gpt-4o-mini-transcribe" : "voxtral-mini-latest");
      expect(form).toContain('filename="vocal.ogg"');
    }
    calls.length = 0;
    const d = createTranscriber({ provider: "deepgram", apiKey: "cle-dg", base });
    expect(await d.transcribe(new Uint8Array(AUDIO), "audio/ogg")).toBe("bonjour");
    expect(calls[0].path).toBe("/v1/listen?model=nova-3&language=fr&smart_format=true");
    expect(calls[0].headers.authorization).toBe("Token cle-dg");
    expect(calls[0].body.equals(AUDIO)).toBe(true);
  });

  it("audio trop long refusé avant tout envoi", async () => {
    const t = createTranscriber({ provider: "openai", apiKey: "k", base });
    await expect(t.transcribe(new Uint8Array(MAX_AUDIO_BYTES + 1), "audio/ogg")).rejects.toThrow("trop long");
    expect(calls).toHaveLength(0);
  });

  it("inactive sans clé ; le statut ne contient jamais la clé", () => {
    const saved = { p: process.env.TRANSCRIPTION_PROVIDER, k: process.env.TRANSCRIPTION_API_KEY };
    delete process.env.TRANSCRIPTION_PROVIDER;
    delete process.env.TRANSCRIPTION_API_KEY;
    expect(transcriberFromEnv()).toBeNull();
    expect(transcriptionStatus().active).toBe(false);
    process.env.TRANSCRIPTION_PROVIDER = "deepgram";
    process.env.TRANSCRIPTION_API_KEY = "cle-secrete-123";
    expect(transcriberFromEnv()?.provider).toBe("deepgram");
    expect(JSON.stringify(transcriptionStatus())).not.toContain("cle-secrete-123");
    process.env.TRANSCRIPTION_PROVIDER = saved.p ?? "";
    process.env.TRANSCRIPTION_API_KEY = saved.k ?? "";
  });

  it("adresses de média : https seulement, jamais une adresse interne", () => {
    expect(allowedMediaUrl("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1", "")).toBe(true);
    expect(allowedMediaUrl("http://lookaside.fbsbx.com/x", "")).toBe(false);
    expect(allowedMediaUrl("https://127.0.0.1/x", "")).toBe(false);
    expect(allowedMediaUrl("https://169.254.169.254/latest", "")).toBe(false);
    expect(allowedMediaUrl("file:///etc/passwd", "")).toBe(false);
  });
});

async function setup(plateforme: "whatsapp" | "instagram") {
  let k = 0;
  const repos = createLocalRepositories(createMemoryStore(), { newId: () => `id${++k}`, now: () => new Date("2026-11-05T15:00:00Z") });
  const template = await createMasterTemplate(repos);
  const client = await repos.clients.create({ nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou" });
  await repos.bots.link(client.id, template.id);
  const workspace = await repos.workspace.exportAll();
  const canal: Canal = {
    id: "c1", restaurantId: client.id, plateforme, accountId: PHONE_ID, triggerMode: "mots_cles_uniquement", coexistence: false,
    echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [],
  };
  const store = createMemoryChannelStore([canal]);
  const graph = plateforme === "whatsapp" ? createGraphClient({ token: "jeton-test", base, version: "v24.0" }) : createInstagramSender({ token: "jeton-ig", base, version: "v24.0" });
  const deps = { store, graph, loadBot: async (id: string) => loadBotFromWorkspace(workspace, id), now: () => new Date("2026-11-05T15:00:00Z"), sleep: async () => {} };
  return { store, deps };
}

const voiceNote = {
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_ID }, contacts: [{ wa_id: CLIENT, profile: { name: "Léa" } }], messages: [{ from: CLIENT, id: "wamid.voc1", type: "audio", audio: { id: "media-1", mime_type: "audio/ogg; codecs=opus", voice: true } }] } }] }],
};
const sentTexts = () => calls.filter((c) => c.path.endsWith("/messages")).map((c) => JSON.parse(c.body.toString()));

describe("messages vocaux de bout en bout (faux Meta + faux service)", () => {
  it("lecture : l'identifiant du média WhatsApp est gardé", () => {
    const { inbound } = parseWebhook(voiceNote);
    expect(inbound[0]).toMatchObject({ message: { kind: "unsupported", mediaType: "audio" }, media: { id: "media-1", mimeType: "audio/ogg; codecs=opus" }, contenu: { type: "audio", vocal: true } });
  });

  it("WhatsApp : vocal « bonjour » téléchargé avec le token, transcrit, et le bot répond comme à un texte", async () => {
    const { store, deps } = await setup("whatsapp");
    const report = await processWebhookPayload(voiceNote, { ...deps, transcriber: createTranscriber({ provider: "openai", apiKey: "k", base }) });
    expect(report.errors).toEqual([]);
    expect(calls.find((c) => c.path === "/fichier/media-1")?.headers.authorization).toBe("Bearer jeton-test");
    const sent = sentTexts().filter((b) => b.type);
    expect(sent[0].interactive.type).toBe("cta_url");
    const contact = (await store.listContacts("c1"))[0];
    const entrant = (await store.listMessages(contact.id)).find((m) => m.sens === "entrant");
    expect(entrant?.contenu).toEqual({ type: "audio", vocal: true, texte: "🎤 bonjour", transcription: "bonjour", statut: "transcrit" });
  });

  it("sans service configuré : comportement d'avant (aucun téléchargement, « je ne peux lire que l'écrit » si une question attend)", async () => {
    const { deps } = await setup("whatsapp");
    const report = await processWebhookPayload(voiceNote, deps);
    expect(report.errors).toEqual([]);
    expect(calls.some((c) => c.path.includes("media-1"))).toBe(false);
  });

  it("service en panne : erreur notée, le message reste un vocal non lu (pas de plantage)", async () => {
    const { store, deps } = await setup("whatsapp");
    const report = await processWebhookPayload(voiceNote, { ...deps, transcriber: createTranscriber({ provider: "openai", apiKey: "k", base: `${base}/panne` }) });
    expect(report.errors[0]).toContain("Transcription wamid.voc1");
    const contact = (await store.listContacts("c1"))[0];
    const entrant = (await store.listMessages(contact.id)).find((m) => m.sens === "entrant");
    expect((entrant?.contenu as { erreur?: string }).erreur).toContain("Transcription refusée");
    // Réponse claire au client, au lieu du silence.
    expect(sentTexts().some((b) => b.text?.body === VOICE_TEXTS.echec)).toBe(true);
  });

  it("Instagram : l'adresse de la notification est téléchargée sans token, puis transcrite (Deepgram)", async () => {
    const { deps } = await setup("instagram");
    const notif = { object: "instagram", entry: [{ id: PHONE_ID, messaging: [{ sender: { id: "igsid-1" }, recipient: { id: PHONE_ID }, message: { mid: "m_voc", attachments: [{ type: "audio", payload: { url: `${base}/fichier/ig-voc` } }] } }] }] };
    const report = await processEvents(parseInstagramWebhook(notif), { ...deps, transcriber: createTranscriber({ provider: "deepgram", apiKey: "k", base }) });
    expect(report.errors).toEqual([]);
    expect(calls.find((c) => c.path === "/fichier/ig-voc")?.headers.authorization).toBeUndefined();
    expect(sentTexts().some((b) => b.message?.attachment?.payload?.template_type === "button")).toBe(true);
  });
});

/** Faux vocal Ogg Opus de la durée voulue : page d'en-tête (OpusHead, pre-skip 312) puis page finale. */
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

const vocal = (id: string) => ({
  ...voiceNote,
  entry: [{ ...voiceNote.entry[0], changes: [{ ...voiceNote.entry[0].changes[0], value: { ...voiceNote.entry[0].changes[0].value, messages: [{ ...voiceNote.entry[0].changes[0].value.messages[0], id }] } }] }],
});

describe("vocaux : Groq, durée, limites, réponses claires", () => {
  it("Groq (service retenu) : format OpenAI sous /openai, modèle whisper-large-v3-turbo, français, indication de vocabulaire ; par défaut avec la seule clé", async () => {
    transcript = "je voudrais deux bokits poulet";
    const t = createTranscriber({ provider: "groq", apiKey: "gsk_test", base: `${base}/openai` });
    expect(await t.transcribe(new Uint8Array(AUDIO), "audio/ogg")).toBe("je voudrais deux bokits poulet");
    const call = calls.find((c) => c.path === "/openai/v1/audio/transcriptions")!;
    expect(call.headers.authorization).toBe("Bearer gsk_test");
    const body = call.body.toString("latin1");
    for (const field of ["whisper-large-v3-turbo", 'name="language"', "fr", 'name="prompt"', "Guadeloupe", 'name="temperature"']) expect(body).toContain(field);
    expect(VOCABULARY_HINT).toContain("Créole");

    const saved = { p: process.env.TRANSCRIPTION_PROVIDER, k: process.env.TRANSCRIPTION_API_KEY };
    delete process.env.TRANSCRIPTION_PROVIDER;
    process.env.TRANSCRIPTION_API_KEY = "gsk_cle_secrete";
    expect(transcriptionStatus()).toEqual({ active: true, provider: "groq", missing: [] });
    expect(transcriberFromEnv()?.provider).toBe("groq");
    process.env.TRANSCRIPTION_PROVIDER = saved.p ?? "";
    process.env.TRANSCRIPTION_API_KEY = saved.k ?? "";
  });

  it("durée lue dans le fichier Ogg Opus (sans service) ; autre format : inconnue ; limites par défaut 2 min et 10 / 24 h", () => {
    expect(audioDurationSeconds(new Uint8Array(fakeOgg(23.4)), "audio/ogg")).toBeCloseTo(23.4, 1);
    expect(audioDurationSeconds(new Uint8Array(fakeOgg(180)), "audio/ogg; codecs=opus")).toBeCloseTo(180, 1);
    expect(audioDurationSeconds(new Uint8Array([1, 2, 3, 4]), "audio/mp4")).toBeNull();
    expect(formatDuration(23.4)).toBe("0:23");
    expect(formatDuration(65)).toBe("1:05");
    expect(DEFAULT_VOICE_LIMITS).toEqual({ maxSeconds: 120, maxPerDay: 10 });
    const saved = { s: process.env.TRANSCRIPTION_MAX_SECONDES, j: process.env.TRANSCRIPTION_MAX_PAR_JOUR };
    process.env.TRANSCRIPTION_MAX_SECONDES = "90";
    process.env.TRANSCRIPTION_MAX_PAR_JOUR = "n'importe quoi";
    expect(voiceLimitsFromEnv()).toEqual({ maxSeconds: 90, maxPerDay: 10 });
    process.env.TRANSCRIPTION_MAX_SECONDES = saved.s ?? "";
    process.env.TRANSCRIPTION_MAX_PAR_JOUR = saved.j ?? "";
  });

  it("vocal de 23 s : transcrit, traité comme un texte ; boîte de réception : vocal + durée + transcription ; l'audio n'est pas gardé", async () => {
    audioFile = fakeOgg(23);
    const { store, deps } = await setup("whatsapp");
    const report = await processWebhookPayload(voiceNote, { ...deps, transcriber: createTranscriber({ provider: "groq", apiKey: "k", base: `${base}/openai` }) });
    expect(report.errors).toEqual([]);
    expect(sentTexts().filter((b) => b.type)[0].interactive.type).toBe("cta_url"); // même réponse qu'au texte « bonjour »
    const contact = (await store.listContacts("c1"))[0];
    const entrant = (await store.listMessages(contact.id)).find((m) => m.sens === "entrant")!;
    expect(entrant.contenu).toMatchObject({ transcription: "bonjour", statut: "transcrit", duree: 23 });
    expect(messageText(entrant)).toBe("🎤 Message vocal (0:23)\n« bonjour »");
    // Rien de l'audio n'est enregistré (ni octets, ni adresse du fichier).
    const stored = JSON.stringify(await store.listMessages(contact.id));
    expect(stored).not.toContain("OggS");
    expect(stored).not.toContain("/fichier/");
  });

  it("vocal de 3 min : pas transcrit (aucun appel au service), le bot demande d'écrire", async () => {
    audioFile = fakeOgg(180);
    const { store, deps } = await setup("whatsapp");
    await processWebhookPayload(voiceNote, { ...deps, transcriber: createTranscriber({ provider: "groq", apiKey: "k", base: `${base}/openai` }) });
    expect(calls.some((c) => c.path.includes("audio/transcriptions"))).toBe(false);
    expect(sentTexts().some((b) => b.text?.body === VOICE_TEXTS.tropLong("2 minutes"))).toBe(true);
    expect(VOICE_TEXTS.tropLong("2 minutes")).toBe("Votre vocal est un peu long (plus de 2 minutes) : pouvez-vous l'écrire, ou envoyer un vocal plus court ?");
    const contact = (await store.listContacts("c1"))[0];
    const entrant = (await store.listMessages(contact.id)).find((m) => m.sens === "entrant")!;
    expect(entrant.contenu).toMatchObject({ statut: "trop_long", duree: 180 });
    expect(messageText(entrant)).toBe("🎤 Message vocal (3:00) : non transcrit (trop long), le bot a demandé d'écrire");
  });

  it("vocal inaudible (transcription vide) : « Je n'ai pas bien compris votre vocal, pouvez-vous l'écrire ? »", async () => {
    transcript = "   ";
    const { deps } = await setup("whatsapp");
    await processWebhookPayload(voiceNote, { ...deps, transcriber: createTranscriber({ provider: "groq", apiKey: "k", base: `${base}/openai` }) });
    expect(VOICE_TEXTS.echec).toBe("Je n'ai pas bien compris votre vocal, pouvez-vous l'écrire ?");
    expect(sentTexts().some((b) => b.text?.body === VOICE_TEXTS.echec)).toBe(true);
  });

  it("plafond par contact sur 24 h : au-delà, plus de transcription (pas de coût), le bot demande d'écrire", async () => {
    audioFile = fakeOgg(10);
    const { store, deps } = await setup("whatsapp");
    const d = { ...deps, transcriber: createTranscriber({ provider: "groq", apiKey: "k", base: `${base}/openai` }), voiceLimits: { maxSeconds: 120, maxPerDay: 2 } };
    await processWebhookPayload(vocal("wamid.p1"), d);
    await processWebhookPayload(vocal("wamid.p2"), d);
    const before = calls.filter((c) => c.path.includes("audio/transcriptions")).length;
    expect(before).toBe(2);
    await processWebhookPayload(vocal("wamid.p3"), d);
    expect(calls.filter((c) => c.path.includes("audio/transcriptions")).length).toBe(2);
    expect(calls.filter((c) => c.path.startsWith("/fichier/")).length).toBe(2); // même pas téléchargé
    expect(sentTexts().some((b) => b.text?.body === VOICE_TEXTS.plafond)).toBe(true);
    const contact = (await store.listContacts("c1"))[0];
    const third = (await store.listMessages(contact.id)).filter((m) => m.sens === "entrant").at(-1)!;
    expect(third.contenu).toMatchObject({ statut: "plafond" });
  });

  it("contact en pause (Jules a la main) : vocal transcrit pour la boîte de réception, mais le bot ne répond rien", async () => {
    transcript = "   ";
    const { store, deps } = await setup("whatsapp");
    const contact = await store.getOrCreateContact("c1", CLIENT, "Léa");
    await store.saveContact({ ...contact, state: { ...contact.state, pause: { reason: "manuel", until: null } } });
    await processWebhookPayload(voiceNote, { ...deps, transcriber: createTranscriber({ provider: "groq", apiKey: "k", base: `${base}/openai` }) });
    expect(sentTexts().filter((b) => b.type === "text")).toHaveLength(0);
  });
});
