import { describe, expect, it } from "vitest";
import { runEngine, type ContactState } from "@/engine";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import { loadBotFromWorkspace } from "@/channels/core/bot-loader";
import { checkDemoKeyword, demoOrderUrl, normalizeKeyword, uniqueKeyword } from "../keyword";
import { pflowBaseBot, PFLOW_TEXTS } from "../pflow-bot";
import { nextContactDemo, routePflowMessage, type DemoDirectoryEntry } from "../router";

const NOW = new Date("2026-11-10T15:00:00Z");
const demo = (clientId: string, keyword: string, extra: Partial<DemoDirectoryEntry> = {}): DemoDirectoryEntry => ({
  clientId,
  keyword,
  nomResto: keyword,
  days: 5,
  startedAt: "2026-11-08T10:00:00Z",
  expiresAt: "2026-11-13T10:00:00Z",
  ...extra,
});
const text = (t: string) => ({ kind: "text" as const, text: t });

describe("mots-clés de démo", () => {
  it("normalisés : casse, accents, ponctuation, espaces", () => {
    expect(normalizeKeyword("  Byron's  BÛRGER ! ")).toBe("byron s burger");
    expect(normalizeKeyword("Pâtes & Co")).toBe(normalizeKeyword("pates co"));
  });
  it("uniques : le nom, puis « nom 2 »…", () => {
    expect(uniqueKeyword("Byron", ["byron", "BYRON 2"])).toBe("Byron 3");
    expect(uniqueKeyword("Mexico", ["byron"])).toBe("Mexico");
  });
  it("contrôles de forme", () => {
    expect(checkDemoKeyword("ab")).toEqual({ ok: false, error: expect.stringContaining("trop court") });
    expect(checkDemoKeyword("  Byron  Burger ")).toEqual({ ok: true, keyword: "Byron Burger" });
  });
  it("page de commande de démo seulement avec un vrai code du CRM", () => {
    expect(demoOrderUrl("0123456789abcdef0123")).toBe("https://order.pflow.fr/demo/commande?d=0123456789abcdef0123");
    expect(demoOrderUrl("pas-un-code")).toBeUndefined();
    expect(demoOrderUrl(undefined)).toBeUndefined();
  });
});

describe("aiguillage du numéro PFlow", () => {
  const demos = [demo("b", "Byron"), demo("bb", "Byron Burger"), demo("m", "Mexico"), demo("old", "Gwada Food", { expiresAt: "2026-11-09T10:00:00Z" })];
  const route = (t: string, current?: { clientId: string; lastAt: string; visited: string[] }) =>
    routePflowMessage({ message: text(t), demos, current, now: NOW, sessionMinutes: 30 });

  it("sans mot-clé : bot PFlow de base", () => {
    expect(route("bonjour")).toEqual({ kind: "pflow" });
  });
  it("mot-clé de démo, sans casse ni accents ; le plus long gagne ; « Bonjour Byron » hors démo", () => {
    expect(route("BYRON")).toEqual({ kind: "demo", clientId: "b", entered: true });
    expect(route("byron burger !")).toEqual({ kind: "demo", clientId: "bb", entered: true });
    expect(route("Bonjour Byron")).toEqual({ kind: "demo", clientId: "b", entered: true });
    expect(route("démo mexico")).toEqual({ kind: "demo", clientId: "m", entered: true });
  });
  it("nom de démo en plusieurs mots : casse, accents, espaces et ponctuation ignorés (bug du 7 novembre)", () => {
    const gwada = [demo("g", "Gwada food")];
    const r = (t: string) => routePflowMessage({ message: text(t), demos: gwada, current: undefined, now: NOW, sessionMinutes: 30 });
    for (const t of ["gwada food", "GWADA FOOD", "  Gwada   Food ! ", "Gwadà Food", "Démo Gwada Food", "Bonjour gwada food"]) {
      expect(r(t), t).toEqual({ kind: "demo", clientId: "g", entered: true });
    }
  });
  it("la conversation reste dans la démo jusqu'à la fin de la session, ou un autre mot-clé", () => {
    const current = { clientId: "b", lastAt: "2026-11-10T14:50:00Z", visited: ["b"] };
    expect(route("vous livrez où ?", current)).toEqual({ kind: "demo", clientId: "b", entered: false });
    // Dans une démo, un mot-clé au milieu d'une phrase ne fait pas changer de démo.
    expect(route("je viens de chez mexico", current)).toEqual({ kind: "demo", clientId: "b", entered: false });
    expect(route("Mexico", current)).toEqual({ kind: "demo", clientId: "m", entered: true });
    expect(route("bonjour", { ...current, lastAt: "2026-11-10T14:00:00Z" })).toEqual({ kind: "pflow" });
  });
  it("démo expirée : message poli (même si le contact y était)", () => {
    expect(route("gwada food")).toEqual({ kind: "ended", clientId: "old", nomResto: "Gwada Food" });
    expect(route("menu", { clientId: "old", lastAt: "2026-11-10T14:59:00Z", visited: ["old"] })).toEqual({ kind: "pflow" });
  });
  it("les boutons restent dans la démo en cours", () => {
    const current = { clientId: "b", lastAt: "2026-11-10T14:59:00Z", visited: ["b"] };
    expect(routePflowMessage({ message: { kind: "button_reply", id: "infos", title: "Infos" }, demos, current, now: NOW, sessionMinutes: 30 })).toEqual({
      kind: "demo",
      clientId: "b",
      entered: false,
    });
  });
  it("démo en cours du contact : démos visitées comptées une fois", () => {
    let c = nextContactDemo(undefined, { kind: "demo", clientId: "b", entered: true }, NOW);
    c = nextContactDemo(c, { kind: "demo", clientId: "b", entered: false }, NOW);
    c = nextContactDemo(c, { kind: "demo", clientId: "m", entered: true }, NOW);
    expect(c).toEqual({ clientId: "m", lastAt: NOW.toISOString(), visited: ["b", "m"] });
    expect(nextContactDemo(c, { kind: "pflow" }, NOW)?.clientId).toBe("");
  });
});

const contact = (): ContactState => ({ id: "c", profileName: "Léa", pause: null, aiUsage: { day: "", calls: 0 } });
const channel = { id: "pflow", clientId: "pflow", triggerMode: "toujours" as const, echoPauseHours: 12, handoffPauseHours: 24, sessionTimeoutMinutes: 30, aiDailyLimitPerContact: 0 };

describe("bot PFlow de base (figé)", () => {
  it("présente PFlow et propose la démo ; « Obtenir ma démo » passe la main à Jules", async () => {
    const bot = pflowBaseBot();
    const base = { now: NOW, client: bot.client, channel, flows: bot.flows, infoSheet: bot.infoSheet };
    const first = await runEngine({ ...base, contact: contact(), session: null, message: text("salut") }, {});
    expect(first.outgoing.some((m) => m.kind === "text" && m.text.includes("Ici *PFlow*"))).toBe(true);
    const buttons = first.outgoing.find((m) => m.kind === "buttons");
    expect(buttons?.kind === "buttons" && buttons.buttons.map((b) => b.title)).toEqual(["😋 Tester la démo", "🍔 Découvrir PFlow", "🎁 Obtenir ma démo"]);
    const ask = await runEngine({ ...base, contact: first.contact, session: first.session, message: { kind: "button_reply", id: "demo", title: "🎁 Obtenir ma démo" } }, {});
    expect(ask.outgoing.some((m) => m.kind === "text" && m.text === PFLOW_TEXTS.demoRequest)).toBe(true);
    expect(ask.events.some((e) => e.type === "handoff")).toBe(true);
  });
});

describe("bot d'une démo", () => {
  it("bouton « Commander » : page de démonstration du CRM, jamais le vrai slug ; sans code, pas de bouton", async () => {
    const repos = createLocalRepositories(createMemoryStore());
    const template = await createMasterTemplate(repos);
    const client = await repos.clients.create({ nomResto: "Byron", orderSlug: "byron" });
    await repos.bots.link(client.id, template.id);
    const data = await repos.workspace.exportAll();
    const withCode = { ...data, clients: data.clients.map((c) => ({ ...c, demoCode: "0123456789abcdef0123" })) };

    const run = async (ws: typeof data) => {
      const bot = loadBotFromWorkspace(ws, client.id, { demo: true })!;
      return runEngine({ now: NOW, client: bot.client, channel, flows: bot.flows, infoSheet: bot.infoSheet, contact: contact(), session: null, message: text("Byron") }, {});
    };
    const links = (await run(withCode)).outgoing.filter((m) => m.kind === "link");
    expect(links.map((m) => m.kind === "link" && m.url)).toEqual(["https://order.pflow.fr/demo/commande?d=0123456789abcdef0123"]);
    const none = await run(data);
    expect(none.outgoing.some((m) => m.kind === "link")).toBe(false);
    expect(JSON.stringify(none.outgoing)).not.toContain("/c/byron");
  });
});
