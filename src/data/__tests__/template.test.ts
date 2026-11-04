import { describe, expect, it } from "vitest";
import { DEFAULT_CHANNEL_SETTINGS, findTrigger, runEngine, type Flow, type InfoSheet } from "@/engine";
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
  it("crée la trame : 3 dossiers dans l'ordre, 11 flux publiés", async () => {
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
    expect(byFolder("Commande")).toEqual(["Commande - Paiement validé", "Panier abandonné", "Statut - En préparation", "Statut - Prête"]);
    expect(flows).toHaveLength(11);
    expect(flows.every((f) => f.ownerKind === "template" && f.version === 1)).toBe(true);
  });

  it("est idempotent : un seul modèle maître", async () => {
    const repos = setup();
    const a = await createMasterTemplate(repos);
    const b = await createMasterTemplate(repos);
    expect(b.id).toBe(a.id);
    expect(await repos.templates.list()).toHaveLength(1);
  });

  it("aucun problème de vérification sur la trame (ni erreur ni avertissement) ; rien de propre à un client", async () => {
    const repos = setup();
    const template = await createMasterTemplate(repos);
    const flows = await repos.flows.listByOwner(template.id);
    const ctxFlows = flows.map((f) => ({ id: f.id, name: f.name, event: findTrigger({ id: f.id, name: f.name, ...f.draft })?.data.event }));
    for (const flow of flows) {
      // Ni erreur ni avertissement : le modèle de référence doit être impeccable.
      const issues = lintFlow(flow.draft, { flowId: flow.id, flows: ctxFlows, orderSlug: "slug-du-client", triggerMode: "toujours" });
      expect(issues, flow.name).toEqual([]);
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

  it("Infos pratiques > Livraison : tournées à venir (planning automatique), points de vente, et pas de titre vide", async () => {
    const repos = setup();
    const template = await createMasterTemplate(repos);
    const flows = (await repos.flows.listByOwner(template.id)).map(toEngineFlow).filter((f): f is Flow => f !== null);
    const livraison = async (infoSheet: InfoSheet) => {
      const base = {
        now: new Date("2026-11-03T16:00:00Z"),
        client: { id: "c", nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe" },
        channel: { id: "ch", clientId: "c", triggerMode: "mots_cles_uniquement" as const, ...DEFAULT_CHANNEL_SETTINGS },
        flows,
        infoSheet,
        contact: { id: "x", pause: null, aiUsage: { day: "", calls: 0 } },
        session: null,
      };
      const r1 = await runEngine({ ...base, message: { kind: "text", text: "livraison" } });
      const buttons = r1.outgoing[0];
      if (buttons.kind !== "buttons") throw new Error("boutons attendus");
      const r2 = await runEngine({ ...base, contact: r1.contact, session: r1.session, message: { kind: "button_reply", id: buttons.buttons[1].id, title: "🛵 Livraison" } });
      return r2.outgoing.flatMap((m) => (m.kind === "text" ? [m.text] : []));
    };
    // Comme Cookies An Nou : zones lues dans le CRM, tournées et points de vente saisis côté bot, mode non choisi.
    const cookies: InfoSheet = {
      horaires: [],
      livraison: true,
      zonesLivraison: "• Jarry : livraison offerte",
      tournees: [{ id: "t1", date: "2026-11-05", de: "11:00", a: "13:00", lieux: "Jarry (entreprises)" }],
      pointsDeVente: "• Station Vito, Le Gosier",
    };
    expect(await livraison(cookies)).toEqual([
      "🛵 *Livraison*\n• *Jeudi 5 novembre* (11h – 13h) : Jarry (entreprises)\n\n🏪 *Points de vente*\n• Station Vito, Le Gosier",
    ]);
    // Sans points de vente : le titre « Points de vente » n'est pas envoyé.
    expect(await livraison({ ...cookies, pointsDeVente: undefined })).toEqual(["🛵 *Livraison*\n• *Jeudi 5 novembre* (11h – 13h) : Jarry (entreprises)"]);
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

  it("compléter un modèle existant : ajoute seulement les flux manquants, sans toucher aux autres", async () => {
    const repos = setup();
    const template = await createMasterTemplate(repos);
    const flows = await repos.flows.listByOwner(template.id);
    // Comme un modèle créé en M3b : sans les flux de commande, et un flux déjà modifié.
    for (const f of flows.filter((f) => f.name.startsWith("Statut") || f.name.startsWith("Commande") || f.name === "Panier abandonné")) {
      await repos.flows.delete(f.id);
    }
    const accueil = flows.find((f) => f.name === "Accueil")!;
    await repos.flows.update(accueil.id, { description: "Ma version" });
    const { completeMasterTemplate, missingSeedFlows } = await import("../template-seed");
    expect(missingSeedFlows((await repos.flows.listByOwner(template.id)).map((f) => f.name))).toHaveLength(4);
    const added = await completeMasterTemplate(repos, template.id);
    expect(added.sort()).toEqual(["Commande - Paiement validé", "Panier abandonné", "Statut - En préparation", "Statut - Prête"]);
    expect((await repos.flows.get(accueil.id))?.description).toBe("Ma version");
    expect(await completeMasterTemplate(repos, template.id)).toEqual([]);
  });

  it("commande validée payée en ligne, déjà prête : confirmation puis « prête » (via Aller à un flux)", async () => {
    const repos = setup();
    const template = await createMasterTemplate(repos);
    const flows = (await repos.flows.listByOwner(template.id)).map(toEngineFlow).filter((f): f is Flow => f !== null);
    const r = await runEngine({
      now: new Date("2026-11-03T16:00:00Z"),
      client: { id: "c", nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe" },
      channel: { id: "ch", clientId: "c", triggerMode: "mots_cles_uniquement", ...DEFAULT_CHANNEL_SETTINGS },
      flows,
      infoSheet: { horaires: [] },
      contact: { id: "x", pause: null, aiUsage: { day: "", calls: 0 }, lastInboundAt: "2026-11-03T15:50:00Z" },
      session: null,
      message: {
        kind: "event",
        event: "commande_validee",
        data: { client_nom: "Léa", commande_numero: "1042", commande_mode: "retrait", commande_recap: "• 2 × Cookies Nutella", commande_total: "8 €", paiement_mode: "en_ligne", commande_statut: "prete" },
      },
    });
    const texts = r.outgoing.map((m) => (m.kind === "typing" ? "" : m.text));
    expect(texts[0]).toBe(
      "✅ *Paiement validé !*\nMerci Léa 🙏 Votre paiement est bien confirmé.\n\n🧾 *Commande #1042* — retrait\n• 2 × Cookies Nutella\n\n💰 *Total : 8 €*\n\nOn vous prévient ici dès que votre commande avance 😊",
    );
    expect(texts[1]).toBe("✅ *Votre commande est prête !*\n\nBonne nouvelle Léa 🎉 Votre commande #1042 est prête.\n\nVous pouvez venir la récupérer 😊");
    expect(texts).toHaveLength(2);
  });

  it("panier abandonné : bulle avec bouton lien « Reprendre », puis bulle « Laisser tomber »", async () => {
    const repos = setup();
    const template = await createMasterTemplate(repos);
    const flows = (await repos.flows.listByOwner(template.id)).map(toEngineFlow).filter((f): f is Flow => f !== null);
    const r = await runEngine({
      now: new Date("2026-11-03T16:00:00Z"),
      client: { id: "c", nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe" },
      channel: { id: "ch", clientId: "c", triggerMode: "mots_cles_uniquement", ...DEFAULT_CHANNEL_SETTINGS },
      flows,
      infoSheet: { horaires: [] },
      contact: { id: "x", pause: null, aiUsage: { day: "", calls: 0 }, lastInboundAt: "2026-11-03T15:30:00Z" },
      session: null,
      message: { kind: "event", event: "panier_abandonne", data: { panier_recap: "• 2 × Cookies Kinder", panier_total: "8 €" } },
    });
    expect(r.outgoing[0]).toMatchObject({ kind: "link", buttonLabel: "🛒 Reprendre", url: "https://order.pflow.fr/c/cookies-an-nou" });
    expect(r.outgoing[1]).toMatchObject({ kind: "buttons", text: "Pas envie ?" });
  });
});
