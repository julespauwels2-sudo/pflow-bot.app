import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { AiRequest, InfoSheet } from "@/engine";
import { askClaude, buildClaudeParams } from "../claude";
import { buildKnowledgeBase, missingKnowledge } from "../knowledge";
import { costUsd, formatUsd } from "../models";
import { buildPrompt, decisionJsonSchema, demoRules, formatLocalNow } from "../prompt";
import { aiRequestSchema } from "../schemas";
import { httpAiPort } from "../http-port";

const sheet: InfoSheet = {
  horaires: [
    { jour: 2, plages: [{ de: "08:00", a: "12:00" }] },
    { jour: 3, plages: [{ de: "08:00", a: "12:00" }] },
  ],
  livraison: true,
  livraisonMode: "planning",
  tournees: [{ id: "r1", date: "2026-11-05", de: "11:00", a: "13:00", lieux: "Jarry (entreprises)" }],
  retrait: false,
  pointsDeVente: "Station Vito Le Gosier",
  modesPaiement: "Espèces, carte",
  resumeCarte: "• Cookies Nutella : 4 €",
  faq: "Q : Vous faites des box ? R : Oui, 6, 10 ou 15 cookies.",
  reglesSpeciales: "Retrait possible seulement en station, quantité limitée.",
};

const request: AiRequest = {
  message: "Vous livrez quand ?",
  history: [],
  client: {
    nomResto: "Cookies An Nou",
    timezone: "America/Guadeloupe",
    maintenantLocal: "2026-11-03 12:00",
    lienCommande: "https://order.pflow.fr/c/cookies-an-nou",
    prenomContact: "Léa",
  },
  consigne: "Tu es l'assistant de Cookies An Nou.",
  infoSheet: sheet,
  functions: [
    { name: "lancer_commande", description: "Le client veut commander" },
    { name: "parler_equipe", description: "Le client veut parler à quelqu'un" },
  ],
  instructions: "Recommande 2 produits.",
};

describe("base de connaissances", () => {
  it("reprend la fiche d'infos, la carte, la FAQ et les règles spéciales", () => {
    const kb = buildKnowledgeBase({ nomResto: "Cookies An Nou", infoSheet: sheet, lienCommande: "https://x" });
    expect(kb).toContain("# Cookies An Nou");
    expect(kb).toContain("Mardi et mercredi : 8h – 12h");
    expect(kb).toContain("Retrait sur place : non.");
    expect(kb).toContain("Jarry (entreprises)");
    expect(kb).toContain("Ne propose jamais une autre date");
    expect(kb).toContain("## Carte\n• Cookies Nutella : 4 €");
    expect(kb).toContain("## Questions fréquentes");
    expect(kb).toContain("quantité limitée");
    // L'adresse de la page de commande n'est jamais donnée à l'IA : le bouton s'en charge.
    expect(kb).not.toContain("https://x");
    expect(kb).toContain("bouton « Commander »");
  });

  it("jours fixes par zone : annoncés chaque semaine, les tournées datées en plus", () => {
    const kb = buildKnowledgeBase({
      nomResto: "X",
      infoSheet: { ...sheet, livraisonMode: undefined, zonesLivraison: "• Jarry : livraison offerte", joursLivraison: [{ id: "j", zone: "Jarry", jours: [2, 5] }] },
      lienCommande: "",
    });
    expect(kb).toContain("## Jours de livraison (chaque semaine)\n• *Jarry* : mardi et vendredi (livraison offerte)");
    expect(kb).toContain("## Livraisons exceptionnelles");
    expect(kb).not.toContain("Aucune tournée");
  });

  it("dit clairement quand aucune tournée n'est prévue", () => {
    const kb = buildKnowledgeBase({ nomResto: "X", infoSheet: { ...sheet, tournees: [] }, lienCommande: "" });
    expect(kb).toContain("Aucune tournée de livraison n'est prévue");
  });

  it("liste ce qui manque à l'IA dans la fiche", () => {
    expect(missingKnowledge({ horaires: [] })).toEqual(["horaires", "carte", "moyens de paiement", "modes de service (livraison, retrait)"]);
    expect(missingKnowledge(sheet)).toEqual([]);
  });
});

describe("prompt", () => {
  it("met les règles, la consigne et la base en cache, puis le contexte du message", () => {
    const prompt = buildPrompt(request);
    expect(prompt.system.map((b) => b.title)).toEqual(["Règles PFlow", "Consigne de l'agent", "Base de connaissances", "Contexte"]);
    expect(prompt.system.findIndex((b) => b.cache)).toBe(2);
    const context = prompt.system[3].text;
    expect(context).toContain("mardi 3 novembre 2026, 12:00");
    expect(context).toContain("Prénom du client : Léa.");
    expect(context).toContain("- lancer_commande : Le client veut commander");
    expect(context).toContain("Recommande 2 produits.");
    expect(prompt.messages).toEqual([{ role: "user", content: "Vous livrez quand ?" }]);
  });

  it("les règles PFlow interdisent les liens et les nouvelles salutations", () => {
    const rules = buildPrompt(request).system[0].text;
    expect(rules).toContain("N'écris JAMAIS de lien");
    expect(rules).toContain("proposer_commande");
    expect(rules).toContain("Ne dis jamais « Bonjour »");
  });

  it("ajoute l'historique du bloc IA en alternant client et IA", () => {
    const prompt = buildPrompt({
      ...request,
      history: [
        { role: "client", text: "du sucré" },
        { role: "assistant", text: "Le Nutella !" },
      ],
    });
    expect(prompt.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("sans fonctions, l'action « fonction » est interdite par le schéma", () => {
    const schema = decisionJsonSchema([]) as { properties: { action: { enum: string[] } } };
    expect(schema.properties.action.enum).toEqual(["repondre", "transfert_humain"]);
    const prompt = buildPrompt({ ...request, functions: [] });
    expect(prompt.system[3].text).toContain("Aucune");
  });

  it("formate la date locale en français", () => {
    expect(formatLocalNow("2026-11-08 09:05")).toBe("dimanche 8 novembre 2026, 09:05");
  });
});

describe("appel à Claude", () => {
  function fakeClient(reply: Partial<Anthropic.Message> & { text?: string }) {
    const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client = {
      messages: {
        create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
          calls.push(params);
          return {
            model: params.model,
            stop_reason: "end_turn",
            content: [{ type: "text", text: reply.text ?? "" }],
            usage: { input_tokens: 400, output_tokens: 60, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
            ...reply,
          };
        },
      },
    } as unknown as Pick<Anthropic, "messages">;
    return { client, calls };
  }

  it("envoie le prompt avec cache, sorties structurées et sans réflexion (Haiku)", async () => {
    const { client, calls } = fakeClient({ text: JSON.stringify({ action: "fonction", fonction: "lancer_commande", texte: "" }) });
    const result = await askClaude(client, request);
    const params = calls[0];
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.thinking).toEqual({ type: "disabled" });
    expect(params).not.toHaveProperty("temperature");
    const system = params.system as Anthropic.TextBlockParam[];
    expect(system[2].cache_control).toEqual({ type: "ephemeral" });
    expect(system[3].cache_control).toBeUndefined();
    expect(params.output_config?.format?.type).toBe("json_schema");

    expect(result.decision).toEqual({ action: "fonction", fonction: "lancer_commande", texte: "" });
    expect(result.usage).toEqual({ inputTokens: 400, outputTokens: 60, cacheReadTokens: 2000, cacheWriteTokens: 0 });
    // 400 × 0,10 + 60 × 0,50 + 2000 × 0,01 = 90 $ par million
    expect(result.costUsd).toBeCloseTo(0.00009, 8);
  });

  it("tolère une réponse sans le champ « fonction »", async () => {
    const { client } = fakeClient({ text: JSON.stringify({ action: "repondre", texte: "Oui !" }) });
    expect((await askClaude(client, request)).decision).toEqual({ action: "repondre", texte: "Oui !" });
  });

  it("utilise le modèle choisi dans l'agent", () => {
    expect(buildClaudeParams({ ...request, model: "claude-sonnet-5-5" }, "claude-sonnet-5-5").thinking).toEqual({ type: "between_tools" });
  });

  it("refus, réponse coupée ou JSON invalide : erreur (le moteur passe la main à l'équipe)", async () => {
    await expect(askClaude(fakeClient({ stop_reason: "refusal" }).client, request)).rejects.toThrow("refusé");
    await expect(askClaude(fakeClient({ stop_reason: "max_tokens" }).client, request)).rejects.toThrow("trop longue");
    await expect(askClaude(fakeClient({ text: "Bonjour !" }).client, request)).rejects.toThrow("JSON invalide");
    await expect(askClaude(fakeClient({ text: '{"action":"danser"}' }).client, request)).rejects.toThrow("mauvais format");
  });
});

describe("validation et coût", () => {
  it("la requête du moteur passe la validation de la route", () => {
    expect(aiRequestSchema.safeParse(request).success).toBe(true);
    expect(aiRequestSchema.safeParse({ ...request, message: "x".repeat(2001) }).success).toBe(false);
    expect(aiRequestSchema.safeParse({ ...request, functions: [{ name: "Lancer Commande", description: "" }] }).success).toBe(false);
  });

  it("calcule le coût, cache compris, et l'affiche en dollars", () => {
    expect(costUsd("claude-haiku-5-5", { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.1);
    expect(costUsd("claude-haiku-5-5", { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 })).toBeCloseTo(0.125);
    expect(costUsd("modele-inconnu", { inputTokens: 1, outputTokens: 1 })).toBeNull();
    expect(formatUsd(0.00009)).toBe("0,0001 $");
    expect(formatUsd(1.5)).toBe("1,50 $");
  });

  it("le port HTTP renvoie le message d'erreur du serveur", async () => {
    const port = httpAiPort("/api/ai", async () => new Response(JSON.stringify({ error: "Clé API absente" }), { status: 503 }));
    await expect(port(request)).rejects.toThrow("Clé API absente");
  });
});

describe("démo sur le numéro PFlow : règles de l'IA", () => {
  const demoRequest = (sansCarte: boolean): AiRequest => ({
    ...request,
    client: { ...request.client, nomResto: "Gwada food", lienCommande: "", demo: { sansCarte } },
    infoSheet: sansCarte ? { horaires: [] } : sheet,
  });
  const systemText = (req: AiRequest) => buildPrompt(req).system.map((b) => b.text).join("\n\n");

  it("sans carte : aucun produit ni prix, réponse « c'est une démo », boutons Obtenir / Tester ; avant la base (en cache)", () => {
    const prompt = buildPrompt(demoRequest(true));
    const text = systemText(demoRequest(true));
    expect(text).toContain("# Démonstration PFlow (règles prioritaires)");
    expect(text).toContain("La carte de Gwada food n'a pas encore été ajoutée à cette démo : tu ne connais AUCUN produit, AUCUN prix");
    expect(text).toContain("Ne cite jamais un produit, un plat, une boisson, un prix");
    expect(text).toContain("« Obtenir ma démo »");
    expect(text).toContain("« Tester la démo »");
    // Base de connaissances sans section Carte ; les règles de démo sont avant elle (même préfixe en cache).
    const titles = prompt.system.map((b) => b.title);
    expect(titles.indexOf("Démonstration")).toBeLessThan(titles.indexOf("Base de connaissances"));
    expect(prompt.system.find((b) => b.title === "Base de connaissances")!.text).not.toContain("## Carte");
  });

  it("démo avec carte : seulement le rappel « démonstration » ; hors démo : rien", () => {
    const withMenu = systemText(demoRequest(false));
    expect(withMenu).toContain("Cette conversation est une démonstration de PFlow préparée pour Gwada food");
    expect(withMenu).not.toContain("AUCUN produit");
    expect(systemText(request)).not.toContain("Démonstration PFlow");
    expect(demoRules("X", false)).not.toContain("Obtenir ma démo");
  });

  it("la route /api/ai garde le champ démo (sinon les règles seraient perdues côté simulateur)", () => {
    const parsed = aiRequestSchema.parse(demoRequest(true));
    expect(parsed.client.demo).toEqual({ sansCarte: true });
  });
});

