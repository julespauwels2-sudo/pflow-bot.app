import { describe, expect, it } from "vitest";
import { DEFAULT_CHANNEL_SETTINGS, runEngine, type Flow } from "@/engine";
import { lintFlow } from "@/editor/lint";
import { createLocalRepositories } from "../local/repositories";
import { createMemoryStore } from "../local/store";
import { MASTER_TEMPLATE_NAME, TEMPLATE_FOLDERS, createMasterTemplate } from "../template-seed";
import { toEngineFlow } from "../types";

function setup() {
  let n = 0;
  return createLocalRepositories(createMemoryStore(), { newId: () => `id${++n}`, now: () => new Date("2026-11-03T16:00:00Z") });
}

describe("modèle maître", () => {
  it("crée la trame : 3 dossiers dans l'ordre, 7 flux publiés, « Commande » vide pour l'instant", async () => {
    const repos = setup();
    const template = await createMasterTemplate(repos);
    expect(template.name).toBe(MASTER_TEMPLATE_NAME);
    const folders = await repos.folders.listByOwner(template.id);
    expect(folders.map((f) => f.name)).toEqual([...TEMPLATE_FOLDERS]);
    const flows = await repos.flows.listByOwner(template.id);
    const byFolder = (name: string) =>
      flows.filter((f) => f.folderId === folders.find((d) => d.name === name)!.id).map((f) => f.name).sort();
    expect(byFolder("Principales PFlow Order")).toEqual(["Accueil", "CTA - Commander", "Infos pratiques"]);
    expect(byFolder("Fonctions IA")).toEqual(["IA - Lancer commande", "IA - Parler équipe", "IA - Proposer commande", "IA - Recommandation"]);
    expect(byFolder("Commande")).toEqual([]);
    expect(flows.every((f) => f.ownerKind === "template" && f.version === 1)).toBe(true);
  });

  it("est idempotent : un seul modèle maître", async () => {
    const repos = setup();
    const a = await createMasterTemplate(repos);
    const b = await createMasterTemplate(repos);
    expect(b.id).toBe(a.id);
    expect(await repos.templates.list()).toHaveLength(1);
  });

  it("aucune erreur de vérification sur la trame ; rien de propre à un client", async () => {
    const repos = setup();
    const template = await createMasterTemplate(repos);
    const flows = await repos.flows.listByOwner(template.id);
    const ctxFlows = flows.map((f) => ({ id: f.id, name: f.name }));
    for (const flow of flows) {
      const errors = lintFlow(flow.draft, { flowId: flow.id, flows: ctxFlows, orderSlug: "slug-du-client", triggerMode: "toujours" }).filter(
        (i) => i.level === "error",
      );
      expect(errors, flow.name).toEqual([]);
      const json = JSON.stringify(flow.draft);
      expect(json, flow.name).not.toMatch(/Cookies An Nou|Jarry|Dothémare|resto-demo/);
    }
  });

  it("tourne dans le moteur avec les infos d'un client", async () => {
    const repos = setup();
    const template = await createMasterTemplate(repos);
    const flows = (await repos.flows.listByOwner(template.id)).map(toEngineFlow).filter((f): f is Flow => f !== null);
    const base = {
      now: new Date("2026-11-03T16:00:00Z"),
      client: { id: "c", nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe" },
      channel: { id: "ch", clientId: "c", triggerMode: "toujours" as const, ...DEFAULT_CHANNEL_SETTINGS },
      flows,
      infoSheet: { horaires: [{ jour: 2 as const, plages: [{ de: "08:00", a: "12:00" }] }], modesPaiement: "Espèces" },
      contact: { id: "x", profileName: "Léa Martin", pause: null, aiUsage: { day: "", calls: 0 } },
      session: null,
    };
    // Accueil = flux par défaut : n'importe quel message le lance.
    const r = await runEngine({ ...base, message: { kind: "text", text: "yo" } });
    expect(r.outgoing[0]).toMatchObject({
      kind: "link",
      text: "👋 Hello Léa ! Bienvenue chez Cookies An Nou 🍔 Une petite faim ? Composez votre commande en quelques clics 👇",
      url: "https://order.pflow.fr/c/cookies-an-nou",
    });
    expect(r.outgoing[1]).toMatchObject({ kind: "buttons" });

    // Infos pratiques → Paiement → CTA - Commander.
    const r2 = await runEngine({ ...base, message: { kind: "text", text: "paiement ?" } });
    const buttons = r2.outgoing[0];
    if (buttons.kind !== "buttons") throw new Error("boutons attendus");
    const r3 = await runEngine({ ...base, contact: r2.contact, session: r2.session, message: { kind: "button_reply", id: buttons.buttons[2].id, title: "💳 Paiement" } });
    expect(r3.outgoing[0]).toEqual({ kind: "text", text: "💳 *Paiement*\nEspèces" });
    expect(r3.outgoing[1]).toMatchObject({ kind: "link", buttonLabel: "😋 Je commande" });
  });

  it("IA - Proposer commande sans réponse de l'IA : seule la bulle « Je commande » part", async () => {
    const repos = setup();
    const template = await createMasterTemplate(repos);
    const stored = (await repos.flows.listByOwner(template.id)).find((f) => f.name === "IA - Proposer commande")!;
    const flow = toEngineFlow(stored)!;
    // On lance le flux comme le fera l'IA (A6), ici via un mot-clé de test.
    const withKeyword: Flow = { ...flow, nodes: flow.nodes.map((n) => (n.type === "trigger" ? { ...n, data: { keywords: ["test"] } } : n)) };
    const r = await runEngine({
      now: new Date(),
      client: { id: "c", nomResto: "X", orderSlug: "x", timezone: "America/Guadeloupe" },
      channel: { id: "ch", clientId: "c", triggerMode: "mots_cles_uniquement", ...DEFAULT_CHANNEL_SETTINGS },
      flows: [withKeyword],
      infoSheet: { horaires: [] },
      contact: { id: "x", pause: null, aiUsage: { day: "", calls: 0 } },
      session: null,
      message: { kind: "text", text: "test" },
    });
    expect(r.outgoing).toHaveLength(1);
    expect(r.outgoing[0]).toMatchObject({ kind: "link", buttonLabel: "😋 Je commande" });
  });

  it("dossiers étanches : un flux de client ne va pas dans un dossier du modèle", async () => {
    const repos = setup();
    const template = await createMasterTemplate(repos);
    const client = await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
    const [folder] = await repos.folders.listByOwner(template.id);
    const f = await repos.flows.create({ ownerId: client.id, name: "Accueil" });
    await expect(repos.flows.update(f.id, { folderId: folder.id })).rejects.toThrow("autre client ou au modèle");
    await expect(repos.flows.create({ ownerKind: "template", ownerId: "inconnu", name: "x" })).rejects.toThrow("Modèle introuvable");
  });
});
