import { describe, expect, it } from "vitest";
import { edge, flows as engineFlows, infoSheet, node, say, client } from "@/engine/__tests__/fixtures";
import type { Flow } from "@/engine";
import { formatLocal, zonedToUtc } from "../clock";
import { advanceTime, newSimulation, playTurn, type Bot } from "../session";

const NOW = new Date("2026-11-03T16:00:00Z"); // mardi 12:00 en Guadeloupe

const prete: Flow = {
  id: "f_prete",
  name: "Statut - Prête",
  nodes: [node("t", "trigger", { keywords: [], event: "commande_prete" }), say("m", "Commande #{{commande_numero}} prête")],
  edges: [edge("t", "m")],
};
const defaut: Flow = {
  id: "f_defaut",
  name: "Accueil par défaut",
  nodes: [node("t", "trigger", { keywords: [], isDefault: true }), say("m", "Bienvenue")],
  edges: [edge("t", "m")],
};

const bot = (triggerMode: Bot["triggerMode"] = "mots_cles_uniquement", extra: Flow[] = []): Bot => ({
  client,
  flows: [...engineFlows, ...extra],
  infoSheet,
  triggerMode,
});
const texts = (lines: { text: string }[]) => lines.map((l) => l.text);

describe("horloge du simulateur", () => {
  it("convertit l'heure locale du client en instant UTC", () => {
    expect(zonedToUtc("2026-11-06", "21:00", "America/Guadeloupe").toISOString()).toBe("2026-11-07T01:00:00.000Z");
    expect(zonedToUtc("2026-07-14", "12:00", "Europe/Paris").toISOString()).toBe("2026-07-14T10:00:00.000Z");
    expect(formatLocal(NOW, "America/Guadeloupe")).toBe("mardi 3 novembre à 12:00");
  });
});

describe("journal : pourquoi le bot a réagi ou non", () => {
  it("mot-clé reconnu, blocs exécutés, attente d'une réponse", async () => {
    const { state } = await playTurn(newSimulation(NOW), bot(), { kind: "text", text: "Je veux commander" });
    const lines = texts(state.turns[0].lines);
    expect(lines[0]).toBe("Mot-clé « commander » reconnu → flux « Accueil »");
    expect(lines[1]).toMatch(/^Blocs exécutés \(Accueil\) : Déclencheur → Message « Bonjour \{\{prenom\}\} 👋 .+… » → Message « Que souhaitez-vous faire \? »$/);
    expect(lines.at(-1)).toMatch(/^En attente d'une réponse : Message « Que souhaitez-vous faire \? » \(Accueil\), expire à 12:30$/);
    expect(state.turns[0].steps.map((s) => s.nodeId)).toEqual(["t", "m", "b"]);
    expect(state.chat.map((c) => c.from)).toEqual(["client", "bot", "bot"]);
  });

  it("ignoré car mode mots-clés ; flux par défaut en mode « toujours »", async () => {
    const quiet = await playTurn(newSimulation(NOW), bot("mots_cles_uniquement", [defaut]), { kind: "text", text: "coucou" });
    expect(texts(quiet.state.turns[0].lines)).toEqual(["Ignoré : aucun mot-clé reconnu, et le canal est en mode « mots-clés uniquement »"]);
    const open = await playTurn(newSimulation(NOW), bot("toujours", [defaut]), { kind: "text", text: "coucou" });
    expect(texts(open.state.turns[0].lines)[0]).toBe("Flux « Accueil par défaut » lancé (salutation ou premier contact : flux par défaut)");
  });

  it("événement ignoré car fenêtre de 24 h fermée, puis envoyé quand le client a écrit", async () => {
    const closed = await playTurn(newSimulation(NOW), bot("mots_cles_uniquement", [prete]), { kind: "event", event: "commande_prete", data: { commande_numero: "7" } });
    expect(texts(closed.state.turns[0].lines)).toEqual(["Événement ignoré : fenêtre de 24 h fermée (le client n'a jamais écrit au bot)"]);
    const wrote = await playTurn(newSimulation(NOW), bot("mots_cles_uniquement", [prete]), { kind: "text", text: "merci" });
    const later = advanceTime(wrote.state, 60);
    const sent = await playTurn(later, bot("mots_cles_uniquement", [prete]), { kind: "event", event: "commande_prete", data: { commande_numero: "7" } });
    expect(sent.result.outgoing).toEqual([{ kind: "text", text: "Commande #7 prête" }]);
    const tooLate = await playTurn(advanceTime(wrote.state, 25 * 60), bot("mots_cles_uniquement", [prete]), { kind: "event", event: "commande_prete", data: {} });
    expect(texts(tooLate.state.turns.at(-1)!.lines)[0]).toMatch(/^Événement ignoré : fenêtre de 24 h fermée \(dernier message du client : mar\. 3 nov\., 12:00\)$/);
  });

  it("avancer le temps : expiration de la session", async () => {
    const r1 = await playTurn(newSimulation(NOW), bot(), { kind: "text", text: "menu" });
    const r2 = await playTurn(advanceTime(r1.state, 31), bot(), { kind: "text", text: "2" });
    expect(texts(r2.state.turns[1].lines)).toEqual([
      "Conversation expirée (délai d'inactivité dépassé) dans « Accueil »",
      "Ignoré : aucun mot-clé reconnu, et le canal est en mode « mots-clés uniquement »",
    ]);
  });

  it("le gérant répond : pause de 12 h, levée en avançant le temps", async () => {
    const r1 = await playTurn(newSimulation(NOW), bot(), { kind: "echo", text: "Je m'en occupe" });
    expect(texts(r1.state.turns[0].lines)).toEqual(["Bot en pause pour ce contact (le gérant a répondu) jusqu'à mer. 4 nov., 00:00"]);
    expect(r1.state.chat[0]).toMatchObject({ from: "gerant", text: "Je m'en occupe" });
    const r2 = await playTurn(r1.state, bot(), { kind: "text", text: "commander" });
    expect(texts(r2.state.turns[1].lines)[0]).toBe("Ignoré : le bot est en pause pour ce contact jusqu'à mer. 4 nov., 00:00");
    const r3 = await playTurn(advanceTime(r2.state, 13 * 60), bot(), { kind: "text", text: "commander" });
    expect(texts(r3.state.turns[2].lines)[0]).toBe("La pause du bot pour ce contact est terminée");
  });

  it("IA désactivée : le journal l'indique", async () => {
    const r1 = await playTurn(newSimulation(NOW), bot("toujours"), { kind: "text", text: "vous êtes ouverts ?" });
    expect(texts(r1.state.turns[0].lines)).toContain("IA non appelée : l'option « IA réelle » est décochée (ou la clé API manque)");
  });

  it("IA réelle : le journal donne la décision, les tokens et le coût", async () => {
    const r1 = await playTurn(newSimulation(NOW), bot("toujours"), { kind: "text", text: "vous êtes ouverts ?" }, undefined, {
      ai: async () => ({
        decision: { action: "repondre", texte: "Oui, jusqu'à 22h 🙂" },
        usage: { inputTokens: 300, outputTokens: 40, cacheReadTokens: 2500 },
        model: "claude-haiku-5-5",
        costUsd: 0.000075,
      }),
    });
    // Les nombres en français utilisent une espace insécable : on la normalise.
    expect(texts(r1.state.turns[0].lines).map((t) => t.replace(/\s/g, " "))).toContain("IA (Claude Haiku 5.5) : répond elle-même — 2 800 tokens lus dont 2 500 en cache, 40 écrits · 0,0001 $");
    expect(r1.state.chat.at(-1)).toMatchObject({ from: "bot", message: { kind: "text", text: "Oui, jusqu'à 22h 🙂" } });
  });
});
