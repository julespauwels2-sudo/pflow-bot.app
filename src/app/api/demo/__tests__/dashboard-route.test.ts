/**
 * Route du lien [Voir le dashboard] (/api/demo/dashboard/<jeton>) : le prospect est redirigé TOUT DE SUITE ; l'attente
 * de ≈ 20 s avant l'étape 3/3 se fait APRÈS la réponse (`after` de Next.js = waitUntil sur Vercel), jamais avant.
 * `after` est intercepté : on mesure le temps de réponse, puis on joue la tâche d'après-réponse avec une horloge simulée.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSender } from "@/channels/core/types";
import { createMemoryChannelStore } from "@/channels/core/memory-store";
import { createDemoToken } from "@/demos/demo-token";
import { DEMO_PERMANENTE } from "@/demos/pflow-bot";
import type { DemoAutoDeps } from "@/demos/demo-auto";

const hoisted = vi.hoisted(() => ({ afterTasks: [] as (() => Promise<void>)[], deps: null as DemoAutoDeps | null }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: () => Promise<void>) => void hoisted.afterTasks.push(task) };
});
vi.mock("@/demos/demo-auto-server", () => ({ demoAutoDeps: async () => hoisted.deps }));

const SECRET = "secret-de-test";

async function setup() {
  const store = createMemoryChannelStore([
    { id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: "1000000099", triggerMode: "toujours", coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [] },
  ]);
  const contact = await store.getOrCreateContact("pflow", "590690111111", "Marc");
  const at = new Date().toISOString();
  await store.saveContact({ ...contact, demo: { clientId: "", lastAt: at, visited: [], parcours: { etape: 2, at } } });
  const sent: { at: number; to: string }[] = [];
  const graph: ChannelSender = {
    async markRead() {},
    async send(_account, to) {
      sent.push({ at: Date.now(), to });
      return `wamid.${sent.length}`;
    },
  };
  hoisted.deps = { store, graph, secret: SECRET, botsUrl: "https://bots.example", etape3Seconds: 20 };
  return { store, sent, token: createDemoToken({ contactId: contact.id, canalId: "pflow" }, SECRET) };
}

afterEach(() => {
  vi.useRealTimers();
  hoisted.afterTasks.length = 0;
});

describe("/api/demo/dashboard/<jeton>", () => {
  it("redirection immédiate (< 1 s), étape 3/3 programmée ; l'attente de 20 s se fait après la réponse", async () => {
    const { sent, token, store } = await setup();
    const { GET } = await import("../dashboard/[jeton]/route");
    const t0 = performance.now();
    const response = await GET(new Request(`https://bots.example/api/demo/dashboard/${token}`), { params: Promise.resolve({ jeton: token }) });
    const ms = performance.now() - t0;
    expect(response.status).toBe(302);
    expect(response.headers.get("location")?.startsWith(DEMO_PERMANENTE.dashboardUrl)).toBe(true);
    expect(ms).toBeLessThan(1000);
    // Au moment de la réponse : rien n'est encore parti, une seule tâche d'après-réponse est enregistrée.
    expect(sent).toHaveLength(0);
    expect(hoisted.afterTasks).toHaveLength(1);
    const due = (await store.listContacts("pflow"))[0].demo?.parcours?.etape3Due;
    expect(Date.parse(due!) - Date.now()).toBeGreaterThan(18_000);

    // La tâche d'après-réponse : elle attend ≈ 20 s (horloge simulée), puis envoie l'étape 3/3.
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const start = Date.now();
    const task = hoisted.afterTasks[0]();
    await vi.advanceTimersByTimeAsync(19_000);
    expect(sent).toHaveLength(0); // pas avant 20 s
    await vi.advanceTimersByTimeAsync(10_000);
    await task;
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0].at - start).toBeGreaterThanOrEqual(20_000);
    expect(sent[0].at - start).toBeLessThan(25_000);
  });

  it("jeton faux : redirection immédiate vers le dashboard, rien de programmé", async () => {
    await setup();
    const { GET } = await import("../dashboard/[jeton]/route");
    const t0 = performance.now();
    const response = await GET(new Request("https://bots.example/api/demo/dashboard/faux"), { params: Promise.resolve({ jeton: "faux" }) });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(response.headers.get("location")).toBe(DEMO_PERMANENTE.dashboardUrl);
    expect(hoisted.afterTasks).toHaveLength(0);
  });

  it("durée maximale déclarée pour la route : 300 s (Vercel Pro, Fluid compute : 800 s au plus)", async () => {
    const route = await import("../dashboard/[jeton]/route");
    expect(route.maxDuration).toBe(300);
  });
});
