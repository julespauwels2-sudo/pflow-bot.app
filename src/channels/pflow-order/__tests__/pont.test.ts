import { describe, expect, it } from "vitest";
import { DEFAULT_CHANNEL_SETTINGS, runEngine, type Flow, type OrderBridgeRequest } from "@/engine";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import { agentConfigFor } from "@/data/agent";
import { toEngineFlow } from "@/data/types";
import { createOrderBridge, orderBridgeFromEnv } from "../pont";

/** Faux pont de PFlow Order (même contrat que repo/api/pont.js : actions suivi et annulation). */
function fauxPont(reponses: Record<string, { status?: number; json: unknown }>) {
  const appels: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    appels.push({ url: String(url), headers: init?.headers as Record<string, string>, body });
    const r = reponses[body.action] ?? { status: 404, json: {} };
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { appels, bridge: createOrderBridge({ baseUrl: "https://order.test/", cle: "cle-du-pont", fetch: fetchFn }) };
}

async function bot() {
  const repos = createLocalRepositories(createMemoryStore());
  const template = await createMasterTemplate(repos);
  const flows = (await repos.flows.listByOwner(template.id)).map(toEngineFlow).filter((f): f is Flow => f !== null);
  return { flows, agent: agentConfigFor(template, flows)! };
}

describe("pont PFlow Order (C5)", () => {
  it("client : POST /api/pont, header x-pflow-cle, action, slug et numéro ; texte de PFlow Order", async () => {
    const { appels, bridge } = fauxPont({ suivi: { json: { ok: true, code: "OK", texte: "Votre commande n° 42 est en préparation." } } });
    expect(await bridge({ action: "suivi", slug: "cookies-an-nou", tel: "590690938108" })).toEqual({ ok: true, code: "OK", texte: "Votre commande n° 42 est en préparation." });
    expect(appels[0].url).toBe("https://order.test/api/pont");
    expect(appels[0].headers["x-pflow-cle"]).toBe("cle-du-pont");
    expect(appels[0].body).toEqual({ action: "suivi", slug: "cookies-an-nou", client_tel: "590690938108" });
  });

  it("sans PFLOW_ORDER_PONT_CLE : pas de pont", () => {
    expect(orderBridgeFromEnv({})).toBeUndefined();
    expect(orderBridgeFromEnv({ PFLOW_ORDER_PONT_CLE: "x" })).toBeTypeOf("function");
  });

  it("IA → suivre_commande : la réponse de PFlow Order est envoyée", async () => {
    const { flows, agent } = await bot();
    const { appels, bridge } = fauxPont({ suivi: { json: { ok: true, code: "OK", texte: "Votre commande n° 42 chez Cookies An Nou (8 €) est en préparation." } } });
    const ai = async () => ({ decision: { action: "fonction" as const, fonction: "suivre_commande", texte: "" }, usage: { inputTokens: 1, outputTokens: 1 } });
    const r = await runEngine(
      {
        now: new Date("2026-11-07T15:00:00Z"),
        client: { id: "c", nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe" },
        channel: { id: "ch", clientId: "c", triggerMode: "toujours", ...DEFAULT_CHANNEL_SETTINGS },
        flows,
        infoSheet: { horaires: [] },
        contact: { id: "590690938108", pause: null, aiUsage: { day: "", calls: 0 }, lastInboundAt: "2026-11-07T14:50:00Z" },
        session: null,
        message: { kind: "text", text: "elle arrive quand ma commande ?" },
        agent,
      },
      { ai, orderBridge: bridge },
    );
    expect(r.outgoing).toEqual([{ kind: "text", text: "Votre commande n° 42 chez Cookies An Nou (8 €) est en préparation." }]);
    expect(appels.map((a) => a.body.action)).toEqual(["suivi"]);
    expect(r.events).toContainEqual({ type: "order_action", action: "suivi", ok: true, code: "OK" });
  });

  it("IA → annuler_commande : confirmation d'abord ; « Non » n'appelle jamais PFlow Order ; « Oui » annule", async () => {
    const { flows, agent } = await bot();
    const { appels, bridge } = fauxPont({
      suivi: { json: { ok: true, trouve: true, statut: "en_preparation", numero: 42, texte: "Votre commande n° 42 est en préparation." } },
      annulation: { json: { ok: true, code: "ANNULATION_ANNULEE", texte: "Votre commande n° 42 est annulée." } },
    });
    const ai = async () => ({ decision: { action: "fonction" as const, fonction: "annuler_commande", texte: "" }, usage: { inputTokens: 1, outputTokens: 1 } });
    const base = {
      now: new Date("2026-11-07T15:00:00Z"),
      client: { id: "c", nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe" },
      channel: { id: "ch", clientId: "c", triggerMode: "toujours" as const, ...DEFAULT_CHANNEL_SETTINGS },
      flows,
      infoSheet: { horaires: [] },
      agent,
    };
    const contact = { id: "590690938108", pause: null, aiUsage: { day: "", calls: 0 }, lastInboundAt: "2026-11-07T14:50:00Z" };
    const r1 = await runEngine({ ...base, contact, session: null, message: { kind: "text", text: "je veux annuler ma commande" } }, { ai, orderBridge: bridge });
    const question = r1.outgoing[0];
    if (question.kind !== "buttons") throw new Error("confirmation attendue");
    expect(question.text).toContain("Vous voulez vraiment annuler votre commande n° 42 ?");
    // Seule la vérification (suivi) a été faite : rien n'est annulé avant la confirmation.
    expect(appels.map((a) => a.body.action)).toEqual(["suivi"]);
    const non = await runEngine({ ...base, contact: r1.contact, session: r1.session, message: { kind: "button_reply", id: question.buttons[1].id, title: "↩️ Non, la garder" } }, { ai, orderBridge: bridge });
    expect(non.outgoing).toEqual([{ kind: "text", text: "C'est noté, votre commande continue 😊" }]);
    expect(appels.map((a) => a.body.action)).toEqual(["suivi"]);
    const oui = await runEngine({ ...base, contact: r1.contact, session: r1.session, message: { kind: "button_reply", id: question.buttons[0].id, title: "✅ Oui, annuler" } }, { ai, orderBridge: bridge });
    expect(oui.outgoing).toEqual([{ kind: "text", text: "Votre commande n° 42 est annulée." }]);
    expect(appels.map((a) => a.body)).toEqual([
      { action: "suivi", slug: "cookies-an-nou", client_tel: "590690938108" },
      { action: "annulation", slug: "cookies-an-nou", client_tel: "590690938108" },
    ]);
  });

  it("annuler_commande sans commande annulable : la raison tout de suite, sans confirmation ni annulation", async () => {
    const { flows, agent } = await bot();
    const ai = async () => ({ decision: { action: "fonction" as const, fonction: "annuler_commande", texte: "" }, usage: { inputTokens: 1, outputTokens: 1 } });
    const run = async (suivi: unknown) => {
      const { appels, bridge } = fauxPont({ suivi: { json: suivi }, annulation: { json: { ok: true, texte: "NE DOIT PAS ARRIVER" } } });
      const r = await runEngine(
        {
          now: new Date("2026-11-07T15:00:00Z"),
          client: { id: "c", nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe" },
          channel: { id: "ch", clientId: "c", triggerMode: "toujours", ...DEFAULT_CHANNEL_SETTINGS },
          flows,
          infoSheet: { horaires: [] },
          contact: { id: "590690938108", pause: null, aiUsage: { day: "", calls: 0 }, lastInboundAt: "2026-11-07T14:50:00Z" },
          session: null,
          message: { kind: "text", text: "je veux annuler ma commande" },
          agent,
        },
        { ai, orderBridge: bridge },
      );
      expect(appels.map((a) => a.body.action)).toEqual(["suivi"]);
      expect(r.outgoing).toHaveLength(1);
      expect(r.session).toBeNull();
      return r.outgoing[0].kind === "text" ? r.outgoing[0].text : "";
    };
    expect(await run({ ok: true, code: "AUCUNE_COMMANDE", trouve: false, texte: "Je ne vois pas de commande récente à votre nom chez Cookies An Nou. Vous voulez en passer une ?" })).toBe(
      "Je ne vois pas de commande récente à votre nom chez Cookies An Nou. Vous voulez en passer une ?",
    );
    expect(await run({ ok: true, trouve: true, statut: "prete", numero: 42, texte: "x" })).toContain("n° 42 est déjà prête : elle ne peut plus être annulée");
    expect(await run({ ok: true, trouve: true, statut: "annulee", numero: 42, texte: "x" })).toBe("Votre commande n° 42 est déjà annulée.");
    expect(await run({ ok: true, trouve: true, statut: "terminee", numero: 42, texte: "x" })).toContain("déjà terminée");
  });

  it("pont absent, sans slug, ou en erreur : texte de repli, jamais d'exception", async () => {
    const flow: Flow = {
      id: "f",
      name: "Suivi",
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { keywords: ["suivi"] } },
        { id: "c", type: "commande", position: { x: 0, y: 0 }, data: { action: "suivi" } },
      ],
      edges: [{ id: "e", source: "t", target: "c" }],
    };
    const input = (orderSlug: string) => ({
      now: new Date("2026-11-07T15:00:00Z"),
      client: { id: "c", nomResto: "X", orderSlug, timezone: "America/Guadeloupe" },
      channel: { id: "ch", clientId: "c", triggerMode: "toujours" as const, ...DEFAULT_CHANNEL_SETTINGS },
      flows: [flow],
      infoSheet: { horaires: [] },
      contact: { id: "590690000001", pause: null, aiUsage: { day: "", calls: 0 } },
      session: null,
      message: { kind: "text" as const, text: "suivi" },
    });
    const repli = /Je ne peux pas consulter votre commande/;
    const sansPont = await runEngine(input("x"));
    expect(sansPont.outgoing[0]).toMatchObject({ kind: "text", text: expect.stringMatching(repli) });
    const calls: OrderBridgeRequest[] = [];
    const sansSlug = await runEngine(input(""), { orderBridge: async (r) => (calls.push(r), { ok: true, texte: "x" }) });
    expect(sansSlug.outgoing[0]).toMatchObject({ text: expect.stringMatching(repli) });
    expect(calls).toHaveLength(0);
    const erreur = await runEngine(input("x"), { orderBridge: async () => { throw new Error("injoignable"); } });
    expect(erreur.outgoing[0]).toMatchObject({ text: expect.stringMatching(repli) });
    expect(erreur.events).toContainEqual({ type: "error", message: "PFlow Order : injoignable" });
  });
});
