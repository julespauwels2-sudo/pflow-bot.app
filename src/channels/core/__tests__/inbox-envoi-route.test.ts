/**
 * Répondre depuis la boîte de réception (route POST /api/inbox/[contactId]) : le message part une seule fois, il est
 * enregistré, le bot se met en pause, et la réponse renvoie le message (son id réel) ; échec de Meta : 502 avec la
 * tentative enregistrée en « échec », sans pause.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/inbox/[contactId]/route";
import { createMemoryChannelStore } from "../memory-store";
import type { Canal, ChannelStore } from "../types";

const canal: Canal = {
  id: "c1", restaurantId: "r1", plateforme: "whatsapp", accountId: "111", wabaId: "w", triggerMode: "toujours", coexistence: true,
  echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [],
};
const runtimeSlot = globalThis as unknown as { __pflowChannels?: Promise<unknown> };

let store: ChannelStore;
let contactId: string;
let sent: { to: string; text?: string }[];
let refuse: boolean;
let reads: Record<string, number>;

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("CHANNELS_STORE", "memory");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("WHATSAPP_APP_SECRET", "s");
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "v");
  vi.stubEnv("WHATSAPP_TOKEN", "t");
  const memory = createMemoryChannelStore([canal]);
  const contact = await memory.getOrCreateContact("c1", "590690000001", "Léa");
  await memory.saveContact({ ...contact, state: { ...contact.state, lastInboundAt: new Date(Date.now() - 60_000).toISOString() } });
  contactId = contact.id;
  reads = {};
  // Compte les lectures (pour vérifier qu'on ne relit pas le contact ni les numéros).
  store = new Proxy(memory, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => ((reads[String(prop)] = (reads[String(prop)] ?? 0) + 1), value.apply(target, args));
    },
  });
  sent = [];
  refuse = false;
  const sender = {
    send: async (_account: string, to: string, m: { text?: string }) => {
      sent.push({ to, text: m.text });
      if (refuse) throw new Error("(#131047) Re-engagement message");
      return `wamid.${sent.length}`;
    },
  };
  runtimeSlot.__pflowChannels = Promise.resolve({ mode: "memory", store, senders: { whatsapp: sender }, deps: () => null, workspace: async () => ({ clients: [] }), connexions: null });
});
afterAll(() => {
  runtimeSlot.__pflowChannels = undefined;
  vi.unstubAllEnvs();
});

const post = (body: unknown) =>
  POST(new Request(`http://x/api/inbox/${contactId}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ contactId }),
  });

describe("répondre depuis la boîte de réception (route)", () => {
  it("envoie une seule fois, enregistre le message, met le bot en pause et renvoie le message enregistré", async () => {
    const response = await post({ type: "repondre", texte: "  Bonjour, je regarde ça !  " });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; message: { id: string; texte: string; statut: string; wamid: string }; pause: { reason: string; until: string } };
    expect(sent).toEqual([{ to: "590690000001", text: "Bonjour, je regarde ça !" }]);
    const messages = await store.listMessages(contactId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: body.message.id, sens: "sortant", auteur: "humain", statut: "envoye", wamid: "wamid.1" });
    expect(body.message).toMatchObject({ texte: "Bonjour, je regarde ça !", statut: "envoye" });
    expect(body.pause.reason).toBe("echo_gerant");
    expect((await store.getContact(contactId))?.state.pause).toEqual(body.pause);
    // Contact et numéros lus une seule fois chacun (pas de relecture dans l'action).
    expect(reads.getContact).toBe(2); // 1 par la route + 1 ci-dessus
    expect(reads.listCanaux).toBe(1);
  });

  it("échec de Meta : 502, tentative enregistrée en « échec » et renvoyée, pas de pause, un seul appel", async () => {
    refuse = true;
    const response = await post({ type: "repondre", texte: "Bonjour" });
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string; message: { id: string; statut: string; erreur: string } };
    expect(body.error).toContain("Re-engagement");
    expect(sent).toHaveLength(1);
    const messages = await store.listMessages(contactId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: body.message.id, statut: "echec" });
    expect(body.message.erreur).toContain("Re-engagement");
    expect((await store.getContact(contactId))?.state.pause).toBeFalsy();
  });

  it("message vide : 400 sans envoi ni enregistrement", async () => {
    const response = await post({ type: "repondre", texte: "   " });
    expect(response.status).toBe(400);
    expect(sent).toEqual([]);
    expect(await store.listMessages(contactId)).toEqual([]);
  });

  it("reprendre la main : renvoie la pause posée", async () => {
    const response = await post({ type: "reprendre" });
    expect(await response.json()).toEqual({ ok: true, pause: { reason: "manuel", until: null } });
  });
});
