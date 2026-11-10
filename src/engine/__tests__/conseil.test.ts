import { describe, expect, it } from "vitest";
import {
  CONSEIL_SURPRISE,
  CONSEIL_TEXTS,
  conseilChoixDuJour,
  consigneConseil,
  optionsConseil,
  parseConseilChoix,
  titreCourt,
} from "../conseil";
import { decodeReplyId } from "../reply-id";
import { runEngine } from "../run";
import type { EngineInput, EngineResult, Flow, InfoSheet, OutgoingMessage } from "../types";
import { NOW, edge, fakeAi, flows, infoSheet, input, node } from "./fixtures";

/** Familles de Mexico, comme lues dans le CRM : l'agneau seulement du vendredi au dimanche. */
const mexico: InfoSheet = {
  ...infoSheet,
  familles: [{ titre: "Bœuf" }, { titre: "Poulet" }, { titre: "Végan" }, { titre: "Agneau", jours: [5, 6, 7] }],
};

/** Flux « IA - Recommandation » du modèle maître, lancé ici par le mot-clé « conseil ». */
const reco: Flow = {
  id: "f_reco",
  name: "IA - Recommandation",
  nodes: [node("t", "trigger", { keywords: ["conseil"] }), node("ia", "ai", { choixCarte: true })],
  edges: [edge("t", "ia")],
};

/** Samedi 7 novembre 2026, 12:00 en Guadeloupe. */
const SAMEDI = new Date("2026-11-07T16:00:00Z");

const base = (overrides: Partial<EngineInput> = {}) => input({ flows: [...flows, reco], infoSheet: mexico, ...overrides });
const next = (prev: EngineResult, overrides: Partial<EngineInput>) => base({ contact: prev.contact, session: prev.session, ...overrides });
const sent = (r: EngineResult) => r.outgoing.filter((m): m is Exclude<OutgoingMessage, { kind: "typing" }> => m.kind !== "typing");

function choices(r: EngineResult) {
  const m = sent(r).at(-1)!;
  if (m.kind === "list") return m.items;
  if (m.kind === "buttons") return m.buttons;
  throw new Error(`pas de choix : ${m.kind}`);
}
const click = (id: string, title: string, kind: "list_reply" | "button_reply" = "list_reply") => ({ message: { kind, id, title } as const });

describe("conseil : fonctions pures", () => {
  it("lit la liste personnalisée (titre | précision | jours)", () => {
    expect(parseConseilChoix("🥩 Bœuf | plats au bœuf\n\n🐑 Agneau | bowl, burrito | ven, samedi dim\nPoulet")).toEqual([
      { titre: "🥩 Bœuf", precision: "plats au bœuf" },
      { titre: "🐑 Agneau", precision: "bowl, burrito", jours: [5, 6, 7] },
      { titre: "Poulet" },
    ]);
    expect(parseConseilChoix("  ")).toEqual([]);
  });

  it("coupe les titres trop longs", () => {
    expect(titreCourt("Box de 15 cookies au choix", 20)).toHaveLength(20);
    expect(titreCourt("Box de 15 cookies au choix", 20).endsWith("…")).toBe(true);
    expect(titreCourt("Poulet", 20)).toBe("Poulet");
  });

  it("3 choix au plus (Surprenez-moi compris) : boutons ; au-delà : liste", () => {
    const deux = optionsConseil([{ titre: "Cookies" }, { titre: "Box" }]);
    expect(deux.format).toBe("boutons");
    expect(deux.options.map((o) => o.title)).toEqual(["Cookies", "Box", CONSEIL_SURPRISE.titre]);
    const trois = optionsConseil([{ titre: "A" }, { titre: "B" }, { titre: "C" }]);
    expect(trois.format).toBe("liste");
    const douze = optionsConseil(Array.from({ length: 12 }, (_, i) => ({ titre: `Famille numéro ${i} très longue` })));
    expect(douze.options).toHaveLength(10);
    expect(douze.options.every((o) => [...o.title].length <= 24)).toBe(true);
  });

  it("respecte les jours : pas d'agneau un mardi, agneau un samedi", () => {
    expect(conseilChoixDuJour(mexico, NOW, "America/Guadeloupe").map((c) => c.titre)).toEqual(["Bœuf", "Poulet", "Végan"]);
    expect(conseilChoixDuJour(mexico, SAMEDI, "America/Guadeloupe").map((c) => c.titre)).toContain("Agneau");
  });

  it("la liste personnalisée remplace les familles de la carte", () => {
    const sheet = { ...mexico, conseilChoix: "🍪 Cookies à l'unité\n📦 Box | box de 6, 10 ou 15" };
    expect(conseilChoixDuJour(sheet, NOW, "America/Guadeloupe").map((c) => c.titre)).toEqual(["🍪 Cookies à l'unité", "📦 Box"]);
  });

  it("consigne : 2 ou 3 produits, prix, jour, aucune invention", () => {
    const c = consigneConseil({ titre: "Agneau", precision: "bowl, burrito" }, SAMEDI, "America/Guadeloupe");
    expect(c).toContain("« Agneau » (bowl, burrito)");
    expect(c).toContain("prix exact");
    expect(c).toContain("samedi");
    expect(c).toContain("N'invente aucun produit");
  });
});

describe("conseil : parcours dans le moteur", () => {
  it("mardi chez Mexico : liste de 4 lignes (Bœuf, Poulet, Végan, Surprenez-moi), sans agneau", async () => {
    const r = await runEngine(base({ message: { kind: "text", text: "conseil" } }), {});
    const m = sent(r).at(-1)!;
    expect(m.kind).toBe("list");
    if (m.kind !== "list") return;
    expect(m.text).toBe(CONSEIL_TEXTS.intro);
    expect(m.buttonLabel).toBe(CONSEIL_TEXTS.listeBouton);
    expect(m.items.map((i) => i.title)).toEqual(["Bœuf", "Poulet", "Végan", "🎲 Surprenez-moi"]);
  });

  it("samedi : la ligne Agneau apparaît", async () => {
    const r = await runEngine(base({ now: SAMEDI, message: { kind: "text", text: "conseil" } }), {});
    expect(choices(r).map((i) => i.title)).toContain("Agneau");
  });

  it("2 familles : boutons de réponse", async () => {
    const sheet = { ...infoSheet, familles: [{ titre: "Cookies" }, { titre: "Box" }] };
    const r = await runEngine(base({ infoSheet: sheet, message: { kind: "text", text: "conseil" } }), {});
    const m = sent(r).at(-1)!;
    expect(m.kind).toBe("buttons");
  });

  it("clic sur un choix : l'IA recommande (consigne dédiée, sans fonction), puis Commander et Autre chose", async () => {
    const r1 = await runEngine(base({ message: { kind: "text", text: "conseil" } }), {});
    const poulet = choices(r1).find((c) => c.title === "Poulet")!;
    const ai = fakeAi({ action: "repondre", texte: "🌯 *Burrito poulet* : 12 €\n🥗 *Bowl poulet* : 13 €" });
    const r2 = await runEngine(next(r1, click(poulet.id, poulet.title)), { ai: ai.port });

    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0].functions).toEqual([]);
    expect(ai.calls[0].instructions).toContain("« Poulet »");
    expect(ai.calls[0].instructions).toContain("mardi");
    expect(r2.events).toContainEqual({ type: "conseil_choisi", titre: "Poulet" });

    const out = sent(r2);
    expect(out[0]).toMatchObject({ kind: "text", text: expect.stringContaining("Burrito poulet") });
    expect(out[1]).toMatchObject({ kind: "link", buttonLabel: "🛒 Commander", url: expect.stringContaining("mexico") });
    expect(out[2]).toMatchObject({ kind: "buttons", text: CONSEIL_TEXTS.autreTexte });
    if (out[2].kind !== "buttons") return;
    expect(out[2].buttons.map((b) => b.title)).toEqual(["🔄 Autre chose"]);

    // « Autre chose » : les choix reviennent.
    const autre = out[2].buttons[0];
    const r3 = await runEngine(next(r2, click(autre.id, autre.title, "button_reply")), { ai: ai.port });
    expect(choices(r3).map((c) => c.title)).toEqual(["Bœuf", "Poulet", "Végan", "🎲 Surprenez-moi"]);
    expect(ai.calls).toHaveLength(1);
  });

  it("Surprenez-moi : consigne « le client te laisse choisir »", async () => {
    const r1 = await runEngine(base({ message: { kind: "text", text: "conseil" } }), {});
    const surprise = choices(r1).at(-1)!;
    expect(decodeReplyId(surprise.id)?.handle).toBe("conseil:surprise");
    const ai = fakeAi({ action: "repondre", texte: "…" });
    await runEngine(next(r1, click(surprise.id, surprise.title)), { ai: ai.port });
    expect(ai.calls[0].instructions).toContain("te laisse choisir");
  });

  it("choix tapé au lieu d'être cliqué (« végan ») : même parcours", async () => {
    const r1 = await runEngine(base({ message: { kind: "text", text: "conseil" } }), {});
    const ai = fakeAi({ action: "repondre", texte: "🥗 *Bowl végan* : 11 €" });
    const r2 = await runEngine(next(r1, { message: { kind: "text", text: "végan" } }), { ai: ai.port });
    expect(ai.calls[0].instructions).toContain("« Végan »");
    expect(sent(r2).map((m) => m.kind)).toEqual(["text", "link", "buttons"]);
  });

  it("une vraie question reste une question libre pour l'IA (pas un choix)", async () => {
    const r1 = await runEngine(base({ message: { kind: "text", text: "conseil" } }), {});
    const ai = fakeAi({ action: "repondre", texte: "Oui, sans gluten : le bowl." });
    await runEngine(next(r1, { message: { kind: "text", text: "vous avez quelque chose sans gluten ?" } }), { ai: ai.port });
    expect(ai.calls[0].instructions).toBeUndefined();
  });

  it("vieux bouton Agneau cliqué un mardi : on repropose les choix du jour, sans appeler l'IA", async () => {
    const r1 = await runEngine(base({ now: SAMEDI, message: { kind: "text", text: "conseil" } }), {});
    const agneau = choices(r1).find((c) => c.title === "Agneau")!;
    const ai = fakeAi({ action: "repondre", texte: "?" });
    const r2 = await runEngine(base({ contact: r1.contact, session: null, now: new Date("2026-11-10T16:00:00Z"), ...click(agneau.id, agneau.title) }), {
      ai: ai.port,
    });
    expect(ai.calls).toHaveLength(0);
    expect(choices(r2).map((c) => c.title)).not.toContain("Agneau");
  });

  it("sans IA : la page de commande et « Autre chose », sans transfert", async () => {
    const r1 = await runEngine(base({ message: { kind: "text", text: "conseil" } }), {});
    const boeuf = choices(r1)[0];
    const r2 = await runEngine(next(r1, click(boeuf.id, boeuf.title)), {});
    expect(sent(r2).map((m) => m.kind)).toEqual(["link", "buttons"]);
    expect(r2.events.some((e) => e.type === "handoff")).toBe(false);
  });

  it("mode mots-clés uniquement : le bouton « Me conseiller » de l'Accueil mène aux choix", async () => {
    const accueil: Flow = {
      id: "f_acc",
      name: "Accueil",
      nodes: [
        node("t", "trigger", { keywords: ["bonjour"] }),
        node("m", "message", { bubbles: [{ id: "m1", text: "Bienvenue", buttons: [{ id: "conseil", kind: "reply", title: "⭐ Me conseiller" }] }] }),
        node("g", "goto_flow", { flowId: "f_reco" }),
      ],
      edges: [edge("t", "m"), edge("m", "g", "conseil")],
    };
    const r1 = await runEngine(base({ flows: [accueil, reco], message: { kind: "text", text: "bonjour" } }), {});
    expect(base().channel.triggerMode).toBe("mots_cles_uniquement");
    const bouton = sent(r1).find((m) => m.kind === "buttons");
    if (bouton?.kind !== "buttons") throw new Error("pas de bouton");
    const r2 = await runEngine(next(r1, { flows: [accueil, reco], ...click(bouton.buttons[0].id, bouton.buttons[0].title, "button_reply") }), {});
    expect(choices(r2).map((c) => c.title)).toEqual(["Bœuf", "Poulet", "Végan", "🎲 Surprenez-moi"]);

    const ai = fakeAi({ action: "repondre", texte: "🥩 *Burrito bœuf* : 12 €" });
    const c = choices(r2)[0];
    const r3 = await runEngine(next(r2, { flows: [accueil, reco], ...click(c.id, c.title) }), { ai: ai.port });
    expect(ai.calls).toHaveLength(1);
    expect(sent(r3).map((m) => m.kind)).toEqual(["text", "link", "buttons"]);
  });
});

describe("conseil : les nouveaux champs survivent à l'enregistrement", () => {
  it("fiche (liste personnalisée, familles) et bloc IA (choixCarte)", async () => {
    const { flowNodeSchema, infoSheetSchema } = await import("@/data/schemas");
    const sheet = infoSheetSchema.parse({ ...mexico, conseilChoix: "🥩 Bœuf | plats au bœuf" });
    expect(sheet.conseilChoix).toBe("🥩 Bœuf | plats au bœuf");
    expect(sheet.familles).toEqual(mexico.familles);
    const ia = flowNodeSchema.parse(reco.nodes[1]);
    expect(ia.data).toEqual({ choixCarte: true });
  });
});
