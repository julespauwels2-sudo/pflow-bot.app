/**
 * Mesure : « Envoyer » depuis la boîte de réception, du clic à l'affichage, étape par étape (côté serveur).
 * Rien n'est envoyé chez Meta ni écrit en base : faux Graph et faux Supabase Auth (serveurs http locaux), stockage
 * en mémoire avec une latence par requête. Les routes Next sont appelées directement.
 *
 *   SCENARIO=avant|apres CONTACTS=10 npx vitest run --config scripts/mesures/vitest.config.ts
 *
 * - avant : l'écran attend POST, puis recharge toute la liste (GET /api/inbox), puis la conversation ;
 * - apres : l'écran affiche le message au clic ; la confirmation arrive avec la réponse du POST.
 * Latences (tirées au hasard, graine fixe) : Supabase 150–250 ms par requête (production : médiane 202 ms, journaux
 * Vercel), Meta 600–1200 ms (production : médiane 312 ms, jusqu'à ~800 ms selon les semaines).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, it } from "vitest";
import { createMemoryChannelStore } from "@/channels/core/memory-store";
import { createGraphClient } from "@/channels/whatsapp/graph";
import type { Canal, ChannelStore } from "@/channels/core/types";

const SCENARIO = process.env.SCENARIO === "apres" ? "apres" : "avant";
const CONTACTS = Number(process.env.CONTACTS ?? 10);
const RUNS = Number(process.env.RUNS ?? 5);
const SB: [number, number] = [150, 250];
const META: [number, number] = [600, 1200];
const OUT = process.env.OUT ?? "";

// Hasard reproductible.
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const lat = ([lo, hi]: [number, number]) => lo + rnd() * (hi - lo);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Mark = { etape: string; debut: number; fin: number };
let t0 = 0;
let marks: Mark[] = [];
async function timed<T>(etape: string, fn: () => Promise<T>): Promise<T> {
  const debut = performance.now() - t0;
  try {
    return await fn();
  } finally {
    marks.push({ etape, debut, fin: performance.now() - t0 });
  }
}

/** Requêtes Supabase par méthode du stockage (comme supabase-store.ts). */
const ALLERS: Record<string, number> = { saveSession: 2, resolveTransferts: 2, updateMessageStatus: 2 };
const NOMS: Record<string, string> = {
  getContact: "base : lecture contact",
  listCanaux: "base : lecture numéros",
  addMessage: "base : écriture message",
  saveContact: "base : écriture pause (contact)",
  listContacts: "base : contacts d'un numéro",
  listTransferts: "base : transferts d'un numéro",
  listMessages: "base : messages",
  getSession: "base : session",
  saveSession: "base : session (écriture)",
};

function withLatency(store: ChannelStore): ChannelStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) =>
        timed(NOMS[String(prop)] ?? `base : ${String(prop)}`, async () => {
          for (let i = 0; i < (ALLERS[String(prop)] ?? 1); i++) await sleep(lat(SB));
          return value.apply(target, args);
        });
    },
  });
}

function server(handler: (path: string, body: string) => Promise<{ status?: number; json: unknown }>): Promise<{ srv: Server; base: string }> {
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const out = await handler(req.url ?? "", body);
      res.statusCode = out.status ?? 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out.json));
    });
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` })));
}

let auth: { srv: Server; base: string };
let graph: { srv: Server; base: string };
let metaCalls = 0;
const contactIds: string[] = [];

beforeAll(async () => {
  auth = await server(async (path) => {
    if (path.startsWith("/auth/v1/user")) return timed("auth : utilisateur (Supabase Auth)", async () => (await sleep(lat(SB)), { json: { id: "u-admin", aud: "authenticated", role: "authenticated", email: "admin@example.test" } }));
    if (path.startsWith("/rest/v1/bot_admins")) return timed("auth : droit admin (bot_admins)", async () => (await sleep(lat(SB)), { json: { user_id: "u-admin" } }));
    return { status: 404, json: {} };
  });
  graph = await server(async () => timed("Meta : envoi du message", async () => (await sleep(lat(META)), { json: { messaging_product: "whatsapp", messages: [{ id: `wamid.mesure${++metaCalls}` }] } })));
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: auth.base,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "cle-anon-fictive",
    SUPABASE_SERVICE_ROLE_KEY: "cle-service-fictive",
    WHATSAPP_APP_SECRET: "secret-fictif",
    WHATSAPP_VERIFY_TOKEN: "phrase-fictive",
    WHATSAPP_TOKEN: "jeton-fictif",
  });
  const base = { plateforme: "whatsapp" as const, wabaId: "w", triggerMode: "toujours" as const, coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif" as const, testNumeros: [] };
  const canaux: Canal[] = [
    { ...base, id: "c1", restaurantId: "r1", accountId: "101" },
    { ...base, id: "c2", restaurantId: "r2", accountId: "102" },
    { ...base, id: "c3", restaurantId: "r3", accountId: "103" },
    { ...base, id: "pf", restaurantId: "", role: "pflow", accountId: "199", coexistence: false },
  ];
  const memory = createMemoryChannelStore(canaux);
  const now = Date.now();
  for (let i = 0; i < CONTACTS; i++) {
    const canal = canaux[i % canaux.length]!;
    const c = await memory.getOrCreateContact(canal.id, `59069000${String(i).padStart(4, "0")}`, `Client ${i}`);
    await memory.saveContact({ ...c, state: { ...c.state, lastInboundAt: new Date(now - 600_000).toISOString() } });
    for (let k = 0; k < 6; k++) await memory.addMessage({ canalId: canal.id, contactId: c.id, sens: k % 2 ? "sortant" : "entrant", auteur: "bot", type: "text", contenu: { texte: `message ${k}` } });
    contactIds.push(c.id);
  }
  const runtime = {
    mode: "supabase",
    store: withLatency(memory),
    senders: { whatsapp: createGraphClient({ token: "jeton-fictif", base: graph.base, version: "v24.0" }) },
    deps: () => null,
    // Lecture des données des bots (plusieurs tables lues ensemble) : compté comme 2 allers-retours.
    workspace: () => timed("base : données des bots", async () => (await sleep(lat(SB)), await sleep(lat(SB)), { clients: [1, 2, 3].map((n) => ({ id: `r${n}`, nomResto: `Resto ${n}` })) })),
    connexions: null,
  };
  (globalThis as unknown as { __pflowChannels?: Promise<unknown> }).__pflowChannels = Promise.resolve(runtime);
});
afterAll(() => {
  auth.srv.close();
  graph.srv.close();
});

const headers = { authorization: "Bearer jeton-de-session-fictif", "content-type": "application/json" };

it(`envoi depuis la boîte de réception (${SCENARIO}, ${CONTACTS} conversations)`, async () => {
  const contactRoute = await import("@/app/api/inbox/[contactId]/route");
  const listRoute = await import("@/app/api/inbox/route");
  const runs: { affichage: number; confirmation: number; post: number; liste: number; fil: number; marks: Mark[] }[] = [];
  for (let r = 0; r < RUNS; r++) {
    const contactId = contactIds[r % contactIds.length]!;
    const params = { params: Promise.resolve({ contactId }) };
    marks = [];
    t0 = performance.now();
    const post = await timed("POST /api/inbox/[contactId] (total)", () =>
      contactRoute.POST(new Request(`http://x/api/inbox/${contactId}`, { method: "POST", headers, body: JSON.stringify({ type: "repondre", texte: `Bonjour ${r}` }) }), params),
    );
    if (!post.ok) throw new Error(`POST ${post.status} ${await post.text()}`);
    const tPost = performance.now() - t0;
    // Liste et conversation : rechargées après l'envoi (avant) ; dans « après », ce sont les rechargements
    // réguliers (toutes les 5 s), mesurés ici seulement pour leur durée.
    const t1 = performance.now();
    const liste = await timed("GET /api/inbox (liste, total)", () => listRoute.GET(new Request("http://x/api/inbox", { headers })));
    if (!liste.ok) throw new Error(`GET liste ${liste.status}`);
    const tListe = performance.now() - t1;
    const t2 = performance.now();
    const fil = await timed("GET /api/inbox/[contactId] (conversation, total)", () => contactRoute.GET(new Request(`http://x/api/inbox/${contactId}`, { headers }), params));
    if (!fil.ok) throw new Error(`GET fil ${fil.status}`);
    const tFil = performance.now() - t2;
    const total = performance.now() - t0;
    runs.push({
      affichage: SCENARIO === "avant" ? total : 0,
      confirmation: SCENARIO === "avant" ? total : tPost,
      post: tPost,
      liste: tListe,
      fil: tFil,
      marks: [...marks],
    });
  }
  const med = (k: "affichage" | "confirmation" | "post" | "liste" | "fil") => {
    const v = runs.map((x) => x[k]).sort((a, b) => a - b);
    return Math.round(v[Math.floor(v.length / 2)]!);
  };
  const median = [...runs].sort((a, b) => a.post - b.post)[Math.floor(runs.length / 2)]!;
  const fmt = (n: number) => `${Math.round(n)} ms`;
  const lines = [
    `## Mesure « ${SCENARIO} » : ${CONTACTS} conversations, ${RUNS} envois (médianes)`,
    "",
    `- clic → message visible : **${fmt(med("affichage"))}**${SCENARIO === "apres" ? " (affichage local, voir mesure navigateur)" : ""}`,
    `- clic → confirmation : **${fmt(med("confirmation"))}**`,
    `- POST : ${fmt(med("post"))} · GET liste : ${fmt(med("liste"))} · GET conversation : ${fmt(med("fil"))}`,
    `- appels à Meta : ${metaCalls} pour ${RUNS} envois`,
    "",
    "Détail d'un envoi (médian), en ms depuis le clic :",
    "",
    "| étape | début | fin | durée |",
    "|---|---:|---:|---:|",
    ...median.marks
      .filter((m) => SCENARIO === "avant" || m.debut < median.post)
      .sort((a, b) => a.debut - b.debut)
      .map((m) => `| ${m.etape} | ${Math.round(m.debut)} | ${Math.round(m.fin)} | ${Math.round(m.fin - m.debut)} |`),
  ];
  const text = lines.join("\n");
  console.log(text);
  if (OUT) writeFileSync(OUT, text + "\n");
  if (metaCalls !== RUNS) throw new Error(`Meta appelé ${metaCalls} fois pour ${RUNS} envois`);
});
