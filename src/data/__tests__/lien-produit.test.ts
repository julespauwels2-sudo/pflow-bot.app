/**
 * Lien direct vers un produit (22 novembre 2026) : quand l'IA ou « Me conseiller » recommande un produit, le bouton
 * « Commander » ouvre la page de commande sur ce produit : paramètre produit=<id du produit> ajouté au lien actuel
 * (via=wa et wa=… gardés). Nom inconnu, aucun produit, ou démo : le lien ne change pas.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CHANNEL_SETTINGS, runEngine, type AiDecision, type EngineResult, type InfoSheet, type OutgoingMessage } from "@/engine";
import { loadBotFromWorkspace } from "@/channels/core/bot-loader";
import { createLocalRepositories } from "../local/repositories";
import { createMemoryStore } from "../local/store";
import { createMasterTemplate } from "../template-seed";

const NOW = new Date("2026-11-22T22:00:00Z");
const QUERY = "via=wa&wa=jeton123";
const BASE = "https://order.pflow.fr/c/mexico";
const PRODUITS = [
  { id: "p-burrito-poulet", nom: "Burrito Poulet" },
  { id: "p-bowl-boeuf", nom: "Bowl Bœuf" },
];

async function bot(sheet: Partial<InfoSheet> = {}) {
  const repos = createLocalRepositories(createMemoryStore());
  const template = await createMasterTemplate(repos);
  const client = await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
  await repos.bots.link(client.id, template.id);
  await repos.infoSheets.save(client.id, { horaires: [], resumeCarte: "== Burritos ==\n• Burrito Poulet : 11 €\n• Bowl Bœuf : 12 €", produits: PRODUITS, ...sheet });
  return loadBotFromWorkspace(await repos.workspace.exportAll(), client.id)!;
}

async function ask(text: string, decision: AiDecision, opts: { demo?: boolean } = {}) {
  const b = await bot();
  const r = await runEngine(
    {
      now: NOW,
      client: { ...b.client, ...(opts.demo ? { demo: { sansCarte: false, ficheVide: false, boutons: [] } } : {}) },
      channel: { id: "ch", clientId: b.client.id, triggerMode: "toujours", ...DEFAULT_CHANNEL_SETTINGS },
      flows: b.flows,
      infoSheet: b.infoSheet,
      agent: b.agent,
      contact: { id: "x", profileName: "Naomi", pause: null, aiUsage: { day: "", calls: 0 }, lastInboundAt: "2026-11-22T21:59:00Z" },
      session: null,
      message: { kind: "text", text },
      orderLinkQuery: QUERY,
    },
    { ai: async () => ({ decision, usage: { inputTokens: 1, outputTokens: 1 } }) },
  );
  return links(r);
}
const links = (r: EngineResult) => r.outgoing.filter((m): m is Extract<OutgoingMessage, { kind: "link" }> => m.kind === "link").map((m) => m.url);

describe("lien direct vers le produit recommandé", () => {
  it("l'IA recommande (proposer_commande) : produit=<id> ajouté, via=wa et wa=… gardés", async () => {
    const urls = await ask("Vous me conseillez quoi ?", { action: "fonction", fonction: "proposer_commande", texte: "Le *Burrito Poulet* (11 €) 😋", sujet: "carte", produit: "Burrito Poulet" });
    expect(urls).toEqual([`${BASE}?${QUERY}&produit=p-burrito-poulet`]);
  });

  it("réponse sur la carte (bouton Commander ajouté) : idem ; accents et majuscules du nom ignorés", async () => {
    const urls = await ask("Vous avez du bœuf ?", { action: "repondre", texte: "Oui, le *Bowl Bœuf* à 12 € 😋", sujet: "carte", produit: "bowl boeuf" });
    expect(urls).toEqual([`${BASE}?${QUERY}&produit=p-bowl-boeuf`]);
  });

  it("produit inconnu, ou aucun produit : le lien actuel, sans paramètre", async () => {
    expect(await ask("Et des pizzas ?", { action: "repondre", texte: "Pas de pizza, mais des burritos 😋", sujet: "carte", produit: "Pizza 4 fromages" })).toEqual([`${BASE}?${QUERY}`]);
    expect(await ask("La carte ?", { action: "fonction", fonction: "proposer_commande", texte: "Voici la carte 👇", sujet: "carte", produit: "" })).toEqual([`${BASE}?${QUERY}`]);
  });

  it("démo (numéro PFlow) : jamais de paramètre produit", async () => {
    const urls = await ask("Vous me conseillez quoi ?", { action: "repondre", texte: "Le Burrito Poulet 😋", sujet: "carte", produit: "Burrito Poulet" }, { demo: true });
    expect(urls.every((u) => !u.includes("produit="))).toBe(true);
  });
});
