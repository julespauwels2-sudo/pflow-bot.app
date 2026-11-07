import { describe, expect, it } from "vitest";
import { runEngine, type AiRequest } from "@/engine";
import { agentConfigFor, aiDailyLimit, checkAgent, DEFAULT_CONSIGNE, defaultAgent } from "../agent";
import { createLocalRepositories } from "../local/repositories";
import { createMemoryStore } from "../local/store";
import { resolveBot } from "../resolve";
import { createMasterTemplate } from "../template-seed";

const NOW = new Date("2026-11-03T16:00:00Z");

function setup() {
  let n = 0;
  return createLocalRepositories(createMemoryStore(), { newId: () => `id${++n}`, now: () => NOW });
}

describe("agent IA du modèle maître", () => {
  it("le modèle maître est créé avec la consigne PFlow et les 5 fonctions reliées à leurs flux", async () => {
    const repos = setup();
    const template = await createMasterTemplate(repos);
    const flows = await repos.flows.listByOwner(template.id);
    const nameOf = (id: string) => flows.find((f) => f.id === id)?.name;
    expect(template.agent?.consigne).toBe(DEFAULT_CONSIGNE);
    expect(template.agent?.functions?.map((f) => [f.name, nameOf(f.flowId), f.aiText])).toEqual([
      ["lancer_commande", "IA - Lancer commande", "silence"],
      ["proposer_commande", "IA - Proposer commande", "variable"],
      ["parler_equipe", "IA - Parler équipe", "silence"],
      ["suivre_commande", "IA - Suivre commande", "silence"],
      ["annuler_commande", "IA - Annuler commande", "silence"],
    ]);
    expect(checkAgent(template.agent!, flows)).toEqual([]);
  });

  it("la consigne par défaut ne contient rien de propre à un client", () => {
    for (const word of ["Cookies An Nou", "Jarry", "Dothémare", "comptoir"]) expect(DEFAULT_CONSIGNE).not.toContain(word);
    expect(DEFAULT_CONSIGNE).toContain("{{nom_resto}}");
  });

  it("refuse un agent invalide (nom, doublon, flux manquant, description vide)", async () => {
    const repos = setup();
    const template = await createMasterTemplate(repos);
    const flowId = template.agent!.functions![0].flowId;
    const bad = async (fn: { name: string; flowId: string; description: string }) =>
      repos.templates.updateAgent(template.id, { functions: [fn] });
    await expect(bad({ name: "Lancer Commande", flowId, description: "x" })).rejects.toThrow("minuscules");
    await expect(bad({ name: "ok", flowId: "inconnu", description: "x" })).rejects.toThrow("choisissez le flux");
    await expect(bad({ name: "ok", flowId, description: " " })).rejects.toThrow("description");
    await expect(
      repos.templates.updateAgent(template.id, {
        functions: [
          { name: "a", flowId, description: "x" },
          { name: "a", flowId, description: "y" },
        ],
      }),
    ).rejects.toThrow("Deux fonctions");
  });

  it("un flux non publié donne un avertissement (non bloquant)", () => {
    const issues = checkAgent({ consigne: "x", functions: [{ name: "a", flowId: "f", description: "x" }] }, [{ id: "f", name: "Brouillon", published: null }]);
    expect(issues).toEqual([{ level: "warning", message: expect.stringContaining("n'est pas publié") }]);
  });

  it("un bot lié reçoit l'agent ; les fonctions des flux inactifs sont retirées", async () => {
    const repos = setup();
    const template = await createMasterTemplate(repos);
    const client = await repos.clients.create({ nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou" });
    const linked = await repos.bots.link(client.id, template.id);
    const templateFlows = await repos.flows.listByOwner(template.id);
    const { flows } = resolveBot({ client: linked, templateFlows, clientFlows: [] });
    const agent = agentConfigFor(template, flows)!;
    expect(agent.functions.map((f) => f.name)).toEqual(["lancer_commande", "proposer_commande", "parler_equipe", "suivre_commande", "annuler_commande"]);
    expect(agentConfigFor(template, flows.filter((f) => f.name !== "IA - Parler équipe"))!.functions.map((f) => f.name)).toEqual([
      "lancer_commande",
      "proposer_commande",
      "suivre_commande",
      "annuler_commande",
    ]);
    expect(agentConfigFor(null, flows)).toBeUndefined();
    expect(aiDailyLimit(template)).toBe(20);

    // De bout en bout : « j'ai faim » → l'IA appelle lancer_commande → bouton « Je commande ».
    const calls: AiRequest[] = [];
    const result = await runEngine(
      {
        now: NOW,
        client: { id: client.id, nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe" },
        channel: { id: "c", clientId: client.id, triggerMode: "mots_cles_uniquement", echoPauseHours: 12, handoffPauseHours: 24, sessionTimeoutMinutes: 30, aiDailyLimitPerContact: 20 },
        flows,
        infoSheet: { horaires: [] },
        contact: { id: "x", pause: null, aiUsage: { day: "", calls: 0 } },
        session: null,
        message: { kind: "start_flow", flowId: flows.find((f) => f.name === "IA - Recommandation")!.id },
        agent,
      },
      {},
    );
    expect(result.session?.nodeId).toBe("ia");
    const next = await runEngine(
      {
        now: NOW,
        client: { id: client.id, nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe" },
        channel: { id: "c", clientId: client.id, triggerMode: "mots_cles_uniquement", echoPauseHours: 12, handoffPauseHours: 24, sessionTimeoutMinutes: 30, aiDailyLimitPerContact: 20 },
        flows,
        infoSheet: { horaires: [] },
        contact: result.contact,
        session: result.session,
        message: { kind: "text", text: "plutôt du chocolat" },
        agent,
      },
      {
        ai: async (req) => {
          calls.push(req);
          return { decision: { action: "fonction", fonction: "proposer_commande", texte: "Le *Tout choco* est fait pour vous 🍫" }, usage: { inputTokens: 1, outputTokens: 1 } };
        },
      },
    );
    expect(calls[0].consigne).toContain("Tu es l'assistant WhatsApp officiel de Cookies An Nou.");
    expect(calls[0].instructions).toContain("proposer_commande");
    const texts = next.outgoing.flatMap((m) => (m.kind === "text" || m.kind === "link" ? [m.text] : []));
    expect(texts[0]).toBe("Le *Tout choco* est fait pour vous 🍫");
    expect(next.outgoing.some((m) => m.kind === "link" && m.url === "https://order.pflow.fr/c/cookies-an-nou")).toBe(true);
  });

  it("agent par défaut : seules les fonctions dont le flux existe", () => {
    expect(defaultAgent([{ id: "f1", name: "IA - Lancer commande" }]).functions?.map((f) => f.name)).toEqual(["lancer_commande"]);
  });
});

describe("journal des appels IA", () => {
  it("ajoute, liste du plus récent au plus ancien, efface, et suit la suppression du client", async () => {
    const repos = setup();
    const a = await repos.clients.create({ nomResto: "A", orderSlug: "a" });
    const b = await repos.clients.create({ nomResto: "B", orderSlug: "b" });
    const log = (clientId: string, message: string) =>
      repos.aiCalls.add({ clientId, at: NOW.toISOString(), source: "simulateur", message, usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.000002 });
    await log(a.id, "1");
    await log(a.id, "2");
    await log(b.id, "3");
    expect((await repos.aiCalls.listByClient(a.id)).map((c) => c.message)).toEqual(["2", "1"]);
    await repos.aiCalls.clearByClient(a.id);
    expect(await repos.aiCalls.listByClient(a.id)).toEqual([]);
    await repos.clients.delete(b.id);
    expect((await repos.workspace.exportAll()).aiCalls).toEqual([]);
  });

  it("mise à niveau : un agent resté par défaut (version précédente) reçoit les nouvelles fonctions et textes ; un texte modifié n'est jamais touché", async () => {
    const { upgradeAgent, textFingerprint, PREVIOUS_DEFAULTS } = await import("../agent");
    const flows = [
      { id: "f1", name: "IA - Lancer commande" },
      { id: "f2", name: "IA - Proposer commande" },
      { id: "f3", name: "IA - Parler équipe" },
      { id: "f4", name: "IA - Suivre commande" },
      { id: "f5", name: "IA - Annuler commande" },
    ];
    // Empreintes des textes par défaut de la version précédente (ceux de la production le 7 novembre).
    expect(PREVIOUS_DEFAULTS.consigne).toEqual(["d48c88eb:4709"]);
    expect(textFingerprint("abc")).toMatch(/^[0-9a-f]{8}:3$/);
    const old = { consigne: "Ma consigne à moi", functions: [{ name: "parler_equipe", flowId: "f3", description: "Ma description", aiText: "silence" as const }] };
    const up = upgradeAgent(old, flows)!;
    expect(up.agent.consigne).toBe("Ma consigne à moi");
    expect(up.agent.functions![0].description).toBe("Ma description");
    expect(up.agent.functions!.map((f) => f.name)).toEqual(["parler_equipe", "lancer_commande", "proposer_commande", "suivre_commande", "annuler_commande"]);
    expect(up.changes).toContain("fonction suivre_commande ajoutée");
    expect(upgradeAgent(up.agent, flows)).toBeNull();
  });
});
