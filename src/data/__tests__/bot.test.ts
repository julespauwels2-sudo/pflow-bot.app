import { describe, expect, it } from "vitest";
import { DEFAULT_CHANNEL_SETTINGS, findTrigger, runEngine, type Flow, type FlowNode } from "@/engine";
import { createLocalRepositories } from "../local/repositories";
import { createMemoryStore } from "../local/store";
import { botChecklist, clientTab, resolveBot, type BotInput } from "../resolve";
import { createMasterTemplate } from "../template-seed";
import type { FlowGraph } from "../types";

const NOW = new Date("2026-11-03T16:00:00Z");

async function setup() {
  let n = 0;
  const repos = createLocalRepositories(createMemoryStore(), { newId: () => `id${++n}`, now: () => NOW });
  const template = await createMasterTemplate(repos);
  const client = await repos.clients.create({ nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", triggerMode: "toujours" });
  const load = async (): Promise<BotInput> => {
    const c = (await repos.clients.get(client.id))!;
    return {
      client: c,
      templateFlows: await repos.flows.listByOwner(template.id),
      templateFolders: await repos.folders.listByOwner(template.id),
      clientFlows: await repos.flows.listByOwner(client.id),
      clientFolders: await repos.folders.listByOwner(client.id),
    };
  };
  const templateFlow = async (name: string) => (await repos.flows.listByOwner(template.id)).find((f) => f.name === name)!;
  return { repos, template, client, load, templateFlow };
}

async function say(flows: Flow[], text: string) {
  return runEngine({
    now: NOW,
    client: { id: "c", nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe" },
    channel: { id: "ch", clientId: "c", triggerMode: "toujours", ...DEFAULT_CHANNEL_SETTINGS },
    flows,
    infoSheet: { horaires: [] },
    contact: { id: "x", profileName: "Léa", pause: null, aiUsage: { day: "", calls: 0 }, lastInboundAt: NOW.toISOString() },
    session: null,
    message: { kind: "text", text },
  });
}

const firstText = (graph: FlowGraph, nodeId: string) =>
  (graph.nodes.find((n) => n.id === nodeId) as Extract<FlowNode, { type: "message" }>).data.bubbles[0].text;

describe("bot lié au modèle", () => {
  it("non lié : seulement les flux du client", async () => {
    const { load } = await setup();
    expect(resolveBot(await load()).flows).toEqual([]);
  });

  it("« Créer le bot depuis le modèle » : rien n'est copié, les flux publiés du modèle sont dans le bot", async () => {
    const { repos, template, client, load } = await setup();
    await repos.bots.link(client.id, template.id);
    expect(await repos.flows.listByOwner(client.id)).toEqual([]);
    const { flows, entries } = resolveBot(await load());
    expect(entries.every((e) => e.origin === "modele")).toBe(true);
    expect(flows.map((f) => f.name)).toContain("Accueil");
    const r = await say(flows, "salut");
    expect(r.outgoing[0]).toMatchObject({ kind: "link", url: "https://order.pflow.fr/c/cookies-an-nou" });
  });

  it("modifier et republier le modèle : le client le voit tout de suite", async () => {
    const { repos, template, client, load, templateFlow } = await setup();
    await repos.bots.link(client.id, template.id);
    const accueil = await templateFlow("Accueil");
    const draft = structuredClone(accueil.draft);
    (draft.nodes.find((n) => n.id === "m") as Extract<FlowNode, { type: "message" }>).data.bubbles[0].text = "Nouveau texte {{prenom}}";
    await repos.flows.update(accueil.id, { draft });
    // Brouillon non publié : le client garde l'ancienne version.
    expect(firstText(resolveBot(await load()).flows.find((f) => f.name === "Accueil")!, "m")).toContain("👋 Hello");
    await repos.flows.publish(accueil.id);
    expect(firstText(resolveBot(await load()).flows.find((f) => f.name === "Accueil")!, "m")).toBe("Nouveau texte {{prenom}}");
  });

  it("personnaliser : copie pour ce client seulement, jamais écrasée par une mise à jour du modèle", async () => {
    const { repos, template, client, load, templateFlow } = await setup();
    await repos.bots.link(client.id, template.id);
    const reco = await templateFlow("IA - Recommandation");
    const copy = await repos.bots.personalize(client.id, reco.id);
    expect(copy).toMatchObject({ ownerKind: "client", overridesTemplateFlowId: reco.id, basedOnTemplateVersion: 1, version: 1 });
    // Rangée dans un dossier du client du même nom.
    expect((await repos.folders.listByOwner(client.id)).map((f) => f.name)).toEqual(["Fonctions IA"]);

    // Le client personnalise (boutons Chocolat…).
    const draft: FlowGraph = {
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { keywords: [] } },
        { id: "m", type: "message", position: { x: 0, y: 0 }, data: { bubbles: [{ id: "b", text: "⭐ Chocolat ou spéculoos ?", buttons: [] }] } },
      ],
      edges: [{ id: "e", source: "t", target: "m" }],
    };
    await repos.flows.update(copy.id, { draft });
    await repos.flows.publish(copy.id);

    // Le modèle publie une nouvelle version du même flux.
    await repos.flows.update(reco.id, { description: "v2 du modèle" });
    await repos.flows.publish(reco.id);

    const { entries, flows } = resolveBot(await load());
    const entry = entries.find((e) => e.botId === reco.id)!;
    expect(entry.origin).toBe("personnalise");
    expect(entry.templateChanged).toBe(true);
    const inBot = flows.find((f) => f.id === reco.id)!;
    expect(firstText(inBot, "m")).toBe("⭐ Chocolat ou spéculoos ?");

    // L'Accueil du modèle (bouton « Me conseiller » → Aller à un flux) mène bien à la version personnalisée.
    const accueil = await say(flows, "salut");
    const buttons = accueil.outgoing[1];
    if (buttons.kind !== "buttons") throw new Error("boutons attendus");
    const r = await runEngine({
      now: NOW,
      client: { id: "c", nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe" },
      channel: { id: "ch", clientId: "c", triggerMode: "toujours", ...DEFAULT_CHANNEL_SETTINGS },
      flows,
      infoSheet: { horaires: [] },
      contact: accueil.contact,
      session: accueil.session,
      message: { kind: "button_reply", id: buttons.buttons[0].id, title: "⭐ Me conseiller" },
    });
    expect(r.outgoing[0]).toEqual({ kind: "text", text: "⭐ Chocolat ou spéculoos ?" });
  });

  it("revenir au modèle : la copie disparaît, le flux du modèle reprend", async () => {
    const { repos, template, client, load, templateFlow } = await setup();
    await repos.bots.link(client.id, template.id);
    const reco = await templateFlow("IA - Recommandation");
    const copy = await repos.bots.personalize(client.id, reco.id);
    await expect(repos.bots.personalize(client.id, reco.id)).rejects.toThrow("déjà personnalisé");
    await repos.bots.revert(copy.id);
    expect(resolveBot(await load()).entries.find((e) => e.botId === reco.id)?.origin).toBe("modele");
  });

  it("flux propres au client : ajoutés au modèle, prioritaires en cas de mot-clé identique", async () => {
    const { repos, template, client, load } = await setup();
    await repos.bots.link(client.id, template.id);
    await repos.flows.create({
      ownerId: client.id,
      name: "Horaires spéciaux",
      draft: {
        nodes: [
          { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { keywords: ["horaires"] } },
          { id: "m", type: "message", position: { x: 0, y: 0 }, data: { bubbles: [{ id: "b", text: "Fermé exceptionnellement cette semaine", buttons: [] }] } },
        ],
        edges: [{ id: "e", source: "t", target: "m" }],
      },
    });
    const own = (await repos.flows.listByOwner(client.id))[0];
    await repos.flows.publish(own.id);
    const r = await say(resolveBot(await load()).flows, "horaires ?");
    expect(r.outgoing[0]).toEqual({ kind: "text", text: "Fermé exceptionnellement cette semaine" });
  });

  it("option payante : sans « Relance panier abandonné », le flux est inactif et rien ne part", async () => {
    const { repos, template, client, load } = await setup();
    await repos.bots.link(client.id, template.id);
    const event = { kind: "event" as const, event: "panier_abandonne" as const, data: { panier_total: "8 €" } };
    const run = async () =>
      runEngine({
        now: NOW,
        client: { id: "c", nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe" },
        channel: { id: "ch", clientId: "c", triggerMode: "toujours", ...DEFAULT_CHANNEL_SETTINGS },
        flows: resolveBot(await load()).flows,
        infoSheet: { horaires: [] },
        contact: { id: "x", pause: null, aiUsage: { day: "", calls: 0 }, lastInboundAt: NOW.toISOString() },
        session: null,
        message: event,
      });
    const entry = resolveBot(await load()).entries.find((e) => e.name === "Panier abandonné")!;
    expect(entry).toMatchObject({ active: false, inactiveReason: "Option « Relance panier abandonné » non activée" });
    expect((await run()).outgoing).toEqual([]);

    await repos.clients.update(client.id, { options: { panier_abandonne: true } });
    expect((await run()).outgoing[0]).toMatchObject({ kind: "link", buttonLabel: "🛒 Reprendre" });
  });

  it("détacher : tout est copié chez le client, les « Aller à un flux » visent les copies, le lien est coupé", async () => {
    const { repos, template, client, load, templateFlow } = await setup();
    await repos.bots.link(client.id, template.id);
    const reco = await templateFlow("IA - Recommandation");
    const copy = await repos.bots.personalize(client.id, reco.id);
    await repos.bots.detach(client.id);

    const after = await load();
    expect(after.client.template).toBeUndefined();
    const own = after.clientFlows;
    expect(own).toHaveLength(11);
    expect(own.every((f) => !f.overridesTemplateFlowId && f.version === 1)).toBe(true);
    const ownIds = new Set(own.map((f) => f.id));
    for (const f of own) {
      for (const n of f.draft.nodes) if (n.type === "goto_flow") expect(ownIds.has(n.data.flowId), `${f.name} → ${n.data.flowId}`).toBe(true);
    }
    // La personnalisation est conservée (même id), et l'Accueil y mène.
    const accueil = own.find((f) => f.name === "Accueil")!;
    const gotoReco = accueil.draft.nodes.find((n) => n.id === "g_reco") as Extract<FlowNode, { type: "goto_flow" }>;
    expect(gotoReco.data.flowId).toBe(copy.id);
    // Dossiers recréés chez le client.
    expect((await repos.folders.listByOwner(client.id)).map((f) => f.name).sort()).toEqual(["Commande", "Fonctions IA", "Principales PFlow Order"]);
    // Le bot marche toujours, sans le modèle.
    const { flows } = resolveBot(after);
    expect((await say(flows, "salut")).outgoing[0]).toMatchObject({ kind: "link" });
    // Le modèle n'a pas bougé.
    expect(await repos.flows.listByOwner(template.id)).toHaveLength(11);
  });
});

describe("onglets de la page Clients", () => {
  it("démo → onglet Démos ; signé, actif (ou autre statut avec un bot) → onglet Clients", () => {
    expect(clientTab("demo")).toBe("demos");
    expect(clientTab("signe")).toBe("clients");
    expect(clientTab("actif")).toBe("clients");
    expect(clientTab("perdu")).toBe("clients");
    expect(clientTab(undefined)).toBe("clients");
  });
});

describe("liste de contrôle (onboarding)", () => {
  it("signale les variables vides, le mode mots-clés et l'option non activée", async () => {
    const { repos, template, client, load } = await setup();
    await repos.bots.link(client.id, template.id);
    await repos.clients.update(client.id, { triggerMode: "mots_cles_uniquement" });
    const items = botChecklist(await load(), { horaires: [], modesPaiement: "Espèces" }, NOW);
    const messages = items.map((i) => i.message);
    expect(messages.some((m) => m.startsWith("{{horaires}} est vide dans la fiche d'infos"))).toBe(true);
    expect(messages.some((m) => m.startsWith("{{modes_paiement}}"))).toBe(false);
    expect(messages).toContain(
      "Mode « mots-clés uniquement » : le flux par défaut « Accueil » ne se lance pas sur ce numéro (seuls les mots-clés comptent).",
    );
    expect(messages).toContain("« Panier abandonné » est inactif : Option « Relance panier abandonné » non activée.");
    expect(items.filter((i) => i.level === "error")).toEqual([]);
  });

  it("infos facultatives vides (points de vente, paiement) : simple info, pas un point à vérifier", async () => {
    const { repos, template, client, load } = await setup();
    await repos.bots.link(client.id, template.id);
    const sheet = {
      horaires: [{ jour: 2 as const, plages: [{ de: "08:00", a: "12:00" }] }],
      adresse: "Jarry",
      livraison: true,
      zonesLivraison: "• Jarry",
    };
    const items = botChecklist(await load(), sheet, NOW);
    const points = items.filter((i) => i.message.includes("{{points_de_vente}}"));
    expect(points).toHaveLength(1);
    expect(points[0].level).toBe("info");
    expect(items.find((i) => i.message.includes("{{modes_paiement}}"))?.level).toBe("info");
    expect(items.filter((i) => i.level !== "info").map((i) => i.message)).toEqual([]);
    // Le resto livre mais aucune zone : là, c'est un point à vérifier.
    const noZone = botChecklist(await load(), { ...sheet, zonesLivraison: "" }, NOW);
    expect(noZone.some((i) => i.level === "warning" && i.message.startsWith("{{infos_livraison}}"))).toBe(true);
  });

  it("paiement en ligne sans prestataire prêt : point d'onboarding", async () => {
    const { repos, template, client, load } = await setup();
    await repos.bots.link(client.id, template.id);
    const sheet = { horaires: [], paiementEnLigne: { mode: "non" as const, aConfigurer: true } };
    expect(botChecklist(await load(), sheet, NOW)).toContainEqual({ level: "warning", message: "Paiement en ligne pas encore configuré (SumUp ou Stripe)." });
    const ready = botChecklist(await load(), { ...sheet, paiementEnLigne: { mode: "choix" as const, aConfigurer: false } }, NOW);
    expect(ready.some((i) => i.message.startsWith("Paiement en ligne"))).toBe(false);
  });

  it("sans slug : erreur", async () => {
    const { repos, template, client, load } = await setup();
    await repos.bots.link(client.id, template.id);
    const input = await load();
    const items = botChecklist({ ...input, client: { ...input.client, orderSlug: "" } }, { horaires: [] }, NOW);
    expect(items[0]).toEqual({ level: "error", message: "Pas de slug du mini-site : les boutons « Commander » sont impossibles." });
  });

  it("le bot assemblé reste valide pour l'éditeur (un seul flux par défaut, un flux par événement)", async () => {
    const { repos, template, client, load } = await setup();
    await repos.bots.link(client.id, template.id);
    const { flows } = resolveBot(await load());
    expect(flows.filter((f) => findTrigger(f)?.data.isDefault)).toHaveLength(1);
  });
});
