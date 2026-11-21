/**
 * Réglage des réponses de l'IA des restos (21 novembre 2026) : réponses courtes, jour et heure jamais annoncés,
 * et après une réponse sur la carte, le message pour commander à la place de « Besoin d'un petit coup de main ? ».
 * Cas réel : Mexico, un samedi soir, « Vous avez de l'agneau ce soir » pendant que l'Accueil attend un clic.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CHANNEL_SETTINGS, runEngine, type AiDecision, type AiRequest, type Flow, type EngineResult } from "@/engine";
import { buildPrompt, decisionJsonSchema, RESTO_STYLE_RULES } from "@/ai/prompt";
import { createLocalRepositories } from "../local/repositories";
import { createMemoryStore } from "../local/store";
import { createMasterTemplate } from "../template-seed";
import { toEngineFlow } from "../types";

const SAMEDI_SOIR = new Date("2026-11-21T23:00:00Z"); // samedi 21 novembre, 19 h en Guadeloupe
const MARDI_SOIR = new Date("2026-11-24T23:00:00Z"); // mardi 24 novembre, 19 h
const COUP_DE_MAIN = "✨ Besoin d'un petit coup de main ?";
const MEXICO_URL = "https://order.pflow.fr/c/mexico";

async function masterFlows(): Promise<Flow[]> {
  const repos = createLocalRepositories(createMemoryStore());
  const template = await createMasterTemplate(repos);
  return (await repos.flows.listByOwner(template.id)).map(toEngineFlow).filter((f): f is Flow => f !== null);
}

/** « bonjour » (Accueil, qui attend un clic) puis la question ; l'IA renvoie `decision`. */
async function scenario(question: string, decision: AiDecision, opts: { now?: Date; demo?: boolean } = {}) {
  const flows = await masterFlows();
  const now = opts.now ?? SAMEDI_SOIR;
  const requests: AiRequest[] = [];
  const ai = async (req: AiRequest) => {
    requests.push(req);
    return { decision, usage: { inputTokens: 1, outputTokens: 1 } };
  };
  const base = {
    now,
    client: {
      id: "mx",
      nomResto: "Mexico",
      orderSlug: "mexico",
      timezone: "America/Guadeloupe",
      ...(opts.demo ? { demo: { sansCarte: false, ficheVide: false, boutons: [] } } : {}),
    },
    channel: { id: "ch", clientId: "mx", triggerMode: "toujours" as const, ...DEFAULT_CHANNEL_SETTINGS },
    flows,
    infoSheet: { horaires: [], livraison: false, retrait: true, emojiAccueil: "🌯" },
  };
  const contact = { id: "c", profileName: "Jules", pause: null, aiUsage: { day: "", calls: 0 } };
  const hello = await runEngine({ ...base, contact, session: null, message: { kind: "text", text: "bonjour" } }, { ai });
  expect(hello.session).not.toBeNull(); // l'Accueil attend un clic
  const r = await runEngine({ ...base, contact: hello.contact, session: hello.session, message: { kind: "text", text: question } }, { ai });
  return { r, request: requests[0], sent: r.outgoing.filter((m) => m.kind !== "typing") };
}

const textOf = (m: EngineResult["outgoing"][number]) => ("text" in m ? m.text : "");
const AGNEAU = "Oui ! L'agneau est dispo du vendredi au dimanche, en bowl, burrito et quesadillas 😋";

describe("réponses de l'IA des restos", () => {
  it("agneau un samedi : réponse courte, puis le bouton « Commander » (pas « Besoin d'un petit coup de main ? »)", async () => {
    const { r, request, sent } = await scenario("Vous avez de l'agneau ce soir", { action: "repondre", texte: AGNEAU, sujet: "carte" });
    // L'IA connaît le jour (pour répondre juste) et reçoit la consigne de ne pas l'annoncer.
    const prompt = buildPrompt(request);
    expect(prompt.system.find((b) => b.title === "Contexte")!.text).toContain("samedi 21 novembre 2026, 19:00");
    expect(prompt.system.find((b) => b.title === "Style des réponses")!.text).toBe(RESTO_STYLE_RULES);
    expect(RESTO_STYLE_RULES).toContain("N'annonce jamais le jour");
    expect(RESTO_STYLE_RULES).toContain("1 à 2 phrases");
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ kind: "text", text: AGNEAU });
    expect(sent[1]).toMatchObject({ kind: "link", text: "Pour commander, c'est par ici 👇", buttonLabel: "Commander", url: MEXICO_URL });
    expect(sent.some((m) => textOf(m).startsWith(COUP_DE_MAIN))).toBe(false);
    expect(r.events.some((e) => e.type === "handoff")).toBe(false);
    // L'Accueil reste en attente : ses boutons (Me conseiller, Infos pratiques) marchent toujours.
    expect(r.session).not.toBeNull();
  });

  it("agneau un mardi : l'IA reçoit le bon jour ; réponse sur la carte → bouton « Commander »", async () => {
    const texte = "L'agneau, c'est du vendredi au dimanche : en bowl, burrito et quesadillas 🐑";
    const { request, sent } = await scenario("Vous avez de l'agneau ce soir", { action: "repondre", texte, sujet: "carte" }, { now: MARDI_SOIR });
    expect(buildPrompt(request).system.find((b) => b.title === "Contexte")!.text).toContain("mardi 24 novembre 2026, 19:00");
    expect(sent.map((m) => m.kind)).toEqual(["text", "link"]);
  });

  it("question d'horaires (sujet « autre ») : réponse, puis « Besoin d'un petit coup de main ? » comme avant", async () => {
    const { sent } = await scenario("Vous fermez à quelle heure ?", { action: "repondre", texte: "On ferme à 22h ce soir.", sujet: "autre" });
    expect(sent[0]).toEqual({ kind: "text", text: "On ferme à 22h ce soir." });
    expect(sent.some((m) => m.kind === "link")).toBe(false);
    expect(textOf(sent[sent.length - 1])).toMatch(/^✨ Besoin d'un petit coup de main \?/);
  });

  it("question de prix : bouton « Commander » ; sans « sujet » (ancienne réponse) : comportement d'avant", async () => {
    const prix = await scenario("C'est combien le burrito poulet ?", { action: "repondre", texte: "Le *Burrito Poulet* est à 11 €.", sujet: "carte" });
    expect(prix.sent.map((m) => m.kind)).toEqual(["text", "link"]);
    const sansSujet = await scenario("C'est combien le burrito poulet ?", { action: "repondre", texte: "Le *Burrito Poulet* est à 11 €." });
    expect(textOf(sansSujet.sent[sansSujet.sent.length - 1])).toMatch(/^✨ Besoin d'un petit coup de main/);
  });

  it("transfert vers l'équipe : inchangé (pas de bouton Commander)", async () => {
    const { r, sent } = await scenario("Je veux parler à quelqu'un", { action: "transfert_humain", texte: "", sujet: "autre" });
    expect(r.events.some((e) => e.type === "handoff")).toBe(true);
    expect(sent.some((m) => m.kind === "link")).toBe(false);
  });

  it("démo (PFlow Démo, Mint Bun) : ni bloc de style ni bouton ajouté", async () => {
    const { request, sent } = await scenario("Vous avez de l'agneau ce soir", { action: "repondre", texte: AGNEAU, sujet: "carte" }, { demo: true });
    expect(buildPrompt(request).system.map((b) => b.title)).not.toContain("Style des réponses");
    expect(sent.some((m) => m.kind === "link")).toBe(false);
    expect(textOf(sent[sent.length - 1])).toMatch(/^✨ Besoin d'un petit coup de main/);
  });

  it("le schéma de sortie impose le sujet (carte / autre)", () => {
    const schema = decisionJsonSchema(["proposer_commande"]) as { required: string[]; properties: { sujet: { enum: string[] } } };
    expect(schema.required).toContain("sujet");
    expect(schema.properties.sujet.enum).toEqual(["carte", "autre"]);
  });
});
