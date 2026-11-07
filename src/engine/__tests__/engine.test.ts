import { describe, expect, it } from "vitest";
import { decodeReplyId, encodeReplyId } from "../reply-id";
import { runEngine, TEXTS, MAX_STEPS_PER_MESSAGE } from "../run";
import type { AgentConfig, EngineInput, EngineResult, Flow } from "../types";
import {
  NOW,
  addMinutes,
  ask,
  say,
  agneau,
  channel,
  client,
  edge,
  fakeAi,
  flows,
  freshContact,
  input,
  node,
} from "./fixtures";

/** Enchaîne un message après un résultat précédent (même contact, même session). */
function next(prev: EngineResult, overrides: Partial<EngineInput>): EngineInput {
  return input({ contact: prev.contact, session: prev.session, ...overrides });
}

const texts = (r: EngineResult) => r.outgoing.flatMap((m) => (m.kind === "typing" ? [] : [m.text]));

describe("ordre de traitement d'un message entrant", () => {
  it("5. mode mots-clés : un message sans mot-clé ni session ne déclenche rien", async () => {
    const ai = fakeAi({ action: "repondre", texte: "Bonjour" });
    const r = await runEngine(input({ message: { kind: "text", text: "Salut, tu viens ce soir ?" } }), { ai: ai.port });
    expect(r.outgoing).toEqual([]);
    expect(r.session).toBeNull();
    expect(r.events).toEqual([{ type: "ignored", reason: "aucun_declencheur" }]);
    expect(ai.calls).toHaveLength(0);
  });

  it("3. un mot-clé lance le flux (casse, accents et ponctuation ignorés)", async () => {
    const r = await runEngine(input({ message: { kind: "text", text: "COMMANDER svp !!" } }));
    expect(r.outgoing[0]).toEqual({ kind: "text", text: "Bonjour Jules 👋 Bienvenue chez Mexico !" });
    expect(r.outgoing[1]).toMatchObject({ kind: "buttons", text: "Que souhaitez-vous faire ?" });
    expect(r.session).toMatchObject({ flowId: "f_accueil", nodeId: "b" });
    expect(r.events).toContainEqual({ type: "flow_started", flowId: "f_accueil", via: "mot_cle" });
  });

  it("3. un mot-clé avec accent correspond au texte sans accent", async () => {
    const r = await runEngine(input({ message: { kind: "text", text: "reservation" } }));
    expect(texts(r)).toEqual(["Pour combien de personnes ?"]);
  });

  it("3. un mot-clé ne correspond qu'à des mots entiers", async () => {
    const r = await runEngine(input({ message: { kind: "text", text: "je veux recommander" } }));
    expect(r.outgoing).toEqual([]);
  });

  it("4. mode toujours : un message sans mot-clé passe à l'IA", async () => {
    const ai = fakeAi({ action: "repondre", texte: "Oui, le dimanche de 11h à 15h." });
    const r = await runEngine(
      input({
        channel: { ...channel, triggerMode: "toujours" },
        message: { kind: "text", text: "vous êtes ouverts dimanche ?" },
      }),
      { ai: ai.port },
    );
    expect(texts(r)).toEqual(["Oui, le dimanche de 11h à 15h."]);
    expect(ai.calls[0].message).toBe("vous êtes ouverts dimanche ?");
    expect(ai.calls[0].client).toEqual({
      nomResto: "Mexico",
      timezone: "America/Guadeloupe",
      maintenantLocal: "2026-11-03 12:00",
      lienCommande: "https://order.pflow.fr/c/mexico",
      prenomContact: "Jules",
    });
    // Sans agent : pas de fonctions, pas de consigne, pas d'historique.
    expect(ai.calls[0].functions).toEqual([]);
    expect(ai.calls[0].consigne).toBe("");
    expect(ai.calls[0].history).toEqual([]);
    expect(r.session).toBeNull();
    expect(r.contact.aiUsage).toEqual({ day: "2026-11-03", calls: 1 });
  });

  it("4. mode toujours : un mot-clé reste prioritaire sur l'IA", async () => {
    const ai = fakeAi({ action: "repondre", texte: "?" });
    const r = await runEngine(
      input({ channel: { ...channel, triggerMode: "toujours" }, message: { kind: "text", text: "agneau" } }),
      { ai: ai.port },
    );
    expect(ai.calls).toHaveLength(0);
    expect(r.events).toContainEqual({ type: "flow_started", flowId: "f_agneau", via: "mot_cle" });
  });

  it("met à jour la date du dernier message reçu (fenêtre de 24 h)", async () => {
    const r = await runEngine(input());
    expect(r.contact.lastInboundAt).toBe(NOW.toISOString());
  });
});

describe("boutons et listes", () => {
  it("un clic sur un bouton suit la bonne sortie et envoie le lien de commande", async () => {
    const r1 = await runEngine(input({ message: { kind: "text", text: "bonjour" } }));
    const buttons = r1.outgoing[1];
    if (buttons.kind !== "buttons") throw new Error("boutons attendus");
    expect(buttons.buttons.map((b) => b.title)).toEqual(["Commander", "Nos horaires", "Une question"]);
    expect(decodeReplyId(buttons.buttons[0].id)).toEqual({ flowId: "f_accueil", nodeId: "b", handle: "cmd" });

    const r2 = await runEngine(
      next(r1, { message: { kind: "button_reply", id: buttons.buttons[0].id, title: "Commander" } }),
    );
    expect(r2.outgoing).toEqual([
      { kind: "link", text: TEXTS.orderLink, url: "https://order.pflow.fr/c/mexico", buttonLabel: "Commander" },
      { kind: "text", text: "Bon appétit !" },
    ]);
    expect(r2.session).toBeNull();
    expect(r2.events).toContainEqual({ type: "flow_ended", flowId: "f_accueil" });
  });

  it("le titre du bouton tapé au clavier fonctionne aussi", async () => {
    const r1 = await runEngine(input({ message: { kind: "text", text: "menu" } }));
    const r2 = await runEngine(next(r1, { message: { kind: "text", text: "nos horaires" } }));
    expect(texts(r2)).toEqual(["Nous sommes ouverts du mardi au dimanche."]);
  });

  it("le numéro du bouton tapé au clavier fonctionne aussi", async () => {
    const r1 = await runEngine(input({ message: { kind: "text", text: "menu" } }));
    const r2 = await runEngine(next(r1, { message: { kind: "text", text: "2" } }));
    expect(texts(r2)).toEqual(["Nous sommes ouverts du mardi au dimanche."]);
  });

  it("une réponse hors boutons passe à l'IA puis repose les boutons", async () => {
    const ai = fakeAi({ action: "repondre", texte: "Oui, on livre à Pointe-à-Pitre." });
    const r1 = await runEngine(input({ message: { kind: "text", text: "menu" } }));
    const r2 = await runEngine(next(r1, { message: { kind: "text", text: "vous livrez à Pap ?" } }), { ai: ai.port });
    expect(r2.outgoing[0]).toEqual({ kind: "text", text: "Oui, on livre à Pointe-à-Pitre." });
    expect(r2.outgoing[1]).toMatchObject({ kind: "buttons" });
    expect(r2.session).toMatchObject({ flowId: "f_accueil", nodeId: "b" });
  });

  it("sans IA disponible, une réponse hors boutons repose les boutons", async () => {
    const r1 = await runEngine(input({ message: { kind: "text", text: "menu" } }));
    const r2 = await runEngine(next(r1, { message: { kind: "text", text: "euh" } }));
    expect(r2.outgoing[0]).toEqual({ kind: "text", text: TEXTS.chooseOption });
    expect(r2.outgoing[1]).toMatchObject({ kind: "buttons" });
    expect(r2.events).toContainEqual({ type: "ai_unavailable" });
  });

  it("dans une session, le mot-clé d'un autre flux lance cet autre flux", async () => {
    const ai = fakeAi({ action: "repondre", texte: "?" });
    const r1 = await runEngine(input({ message: { kind: "text", text: "menu" } }));
    const r2 = await runEngine(next(r1, { message: { kind: "text", text: "de l'agneau ?" } }), { ai: ai.port });
    expect(ai.calls).toHaveLength(0);
    expect(r2.events).toContainEqual({ type: "flow_started", flowId: "f_agneau", via: "mot_cle" });
  });

  it("dans une session, un mot-clé perdu dans une phrase longue ne lance pas son flux : l'IA répond", async () => {
    const ai = fakeAi({ action: "repondre", texte: "Oui, il y a de l'agneau ce midi." });
    const r1 = await runEngine(input({ message: { kind: "text", text: "menu" } }));
    const r2 = await runEngine(next(r1, { message: { kind: "text", text: "est-ce qu'il y a de l'agneau ce midi ?" } }), { ai: ai.port });
    expect(ai.calls).toHaveLength(1);
    expect(r2.events).toContainEqual({ type: "keyword_skipped", flowId: "f_agneau", keyword: "agneau" });
    expect(r2.events).not.toContainEqual(expect.objectContaining({ type: "flow_started", flowId: "f_agneau" }));
  });

  it("un ancien bouton reste cliquable après expiration de la session", async () => {
    const id = encodeReplyId({ flowId: "f_accueil", nodeId: "b", handle: "hor" });
    const r = await runEngine(input({ message: { kind: "button_reply", id, title: "Nos horaires" } }));
    expect(texts(r)).toEqual(["Nous sommes ouverts du mardi au dimanche."]);
    expect(r.events).toContainEqual({ type: "flow_started", flowId: "f_accueil", via: "bouton" });
  });

  it("une liste fonctionne comme des boutons", async () => {
    const carte: Flow = {
      id: "f_carte",
      name: "Carte",
      nodes: [
        node("t", "trigger", { keywords: ["carte"] }),
        node("l", "list", {
          text: "Que voulez-vous voir ?",
          buttonLabel: "Voir",
          items: [
            { id: "tacos", title: "Tacos" },
            { id: "burritos", title: "Burritos" },
          ],
        }),
        say("m", "Nos burritos sont à la page 2."),
      ],
      edges: [edge("t", "l"), edge("l", "m", "burritos")],
    };
    const r1 = await runEngine(input({ flows: [carte], message: { kind: "text", text: "la carte" } }));
    const list = r1.outgoing[0];
    if (list.kind !== "list") throw new Error("liste attendue");
    const r2 = await runEngine(
      next(r1, { flows: [carte], message: { kind: "list_reply", id: list.items[1].id, title: "Burritos" } }),
    );
    expect(texts(r2)).toEqual(["Nos burritos sont à la page 2."]);
  });
});

describe("questions", () => {
  it("stocke les réponses valides dans des variables", async () => {
    const r1 = await runEngine(input({ message: { kind: "text", text: "réserver" } }));
    const r2 = await runEngine(next(r1, { message: { kind: "text", text: "4" } }));
    expect(texts(r2)).toEqual(["Votre numéro ?"]);
    const r3 = await runEngine(next(r2, { message: { kind: "text", text: "0690 12 34 56" } }));
    expect(texts(r3)).toEqual(["C'est noté : 4 personnes, on vous rappelle au 0690123456."]);
    expect(r3.session).toBeNull();
  });

  it("une réponse invalide est redemandée, puis la sortie « échec » est suivie", async () => {
    const r1 = await runEngine(input({ message: { kind: "text", text: "réserver" } }));
    const r2 = await runEngine(next(r1, { message: { kind: "text", text: "beaucoup" } }));
    expect(texts(r2)).toEqual([TEXTS.questionError.nombre, "Pour combien de personnes ?"]);
    const r3 = await runEngine(next(r2, { message: { kind: "text", text: "plein" } }));
    expect(r3.session?.retries).toBe(2);
    const r4 = await runEngine(next(r3, { message: { kind: "text", text: "toujours pas" } }));
    expect(texts(r4)).toEqual(["Je passe la main à l'équipe."]);
    expect(r4.contact.pause?.reason).toBe("transfert_humain");
  });
});

describe("conditions et fuseau horaire du client", () => {
  // Vendredi 6 novembre 2026, 21:00 en Guadeloupe = samedi 7 novembre, 01:00 UTC.
  const vendredi21hGuadeloupe = new Date("2026-11-07T01:00:00Z");
  // Samedi 7 novembre 2026, 10:00 en Guadeloupe = 14:00 UTC.
  const samedi10hGuadeloupe = new Date("2026-11-07T14:00:00Z");

  it("« dispo le week-end » est fermé le vendredi à 21h heure de Guadeloupe", async () => {
    const r = await runEngine(input({ now: vendredi21hGuadeloupe, message: { kind: "text", text: "agneau" } }));
    expect(texts(r)).toEqual(["L'agneau n'est disponible que le week-end."]);
  });

  it("« dispo le week-end » est ouvert le samedi à 10h heure de Guadeloupe", async () => {
    const r = await runEngine(input({ now: samedi10hGuadeloupe, message: { kind: "text", text: "agneau" } }));
    expect(texts(r)).toEqual(["Oui, l'agneau est dispo aujourd'hui !"]);
  });

  it("le fuseau compte : le même instant à Paris serait déjà samedi", async () => {
    const r = await runEngine(
      input({
        now: vendredi21hGuadeloupe,
        client: { ...client, timezone: "Europe/Paris" },
        message: { kind: "text", text: "agneau" },
      }),
    );
    expect(texts(r)).toEqual(["Oui, l'agneau est dispo aujourd'hui !"]);
  });

  it("condition sur une variable et sur l'ouverture d'après la fiche d'infos", async () => {
    const flow: Flow = {
      id: "f_test",
      name: "Test",
      nodes: [
        node("t", "trigger", { keywords: ["test"] }),
        node("c", "condition", { rules: [{ kind: "ouvert_maintenant" }] }),
        say("o", "ouvert"),
        say("f", "fermé"),
      ],
      edges: [edge("t", "c"), edge("c", "o", "vrai"), edge("c", "f", "faux")],
    };
    const mardiMidi = await runEngine(input({ flows: [flow], message: { kind: "text", text: "test" } }));
    expect(texts(mardiMidi)).toEqual(["ouvert"]);
    // Samedi 01:00 en Guadeloupe : encore dans la plage du vendredi 18:00 → 02:00.
    const samediNuit = await runEngine(
      input({ flows: [flow], now: new Date("2026-11-07T05:00:00Z"), message: { kind: "text", text: "test" } }),
    );
    expect(texts(samediNuit)).toEqual(["ouvert"]);
    const lundi = await runEngine(
      input({ flows: [flow], now: new Date("2026-11-09T16:00:00Z"), message: { kind: "text", text: "test" } }),
    );
    expect(texts(lundi)).toEqual(["fermé"]);
  });
});

describe("pause, coexistence et transfert humain", () => {
  it("1. un contact en pause ne reçoit rien", async () => {
    const r = await runEngine(
      input({
        contact: freshContact({ pause: { reason: "manuel", until: null } }),
        message: { kind: "text", text: "commander" },
      }),
    );
    expect(r.outgoing).toEqual([]);
    expect(r.events).toEqual([{ type: "ignored", reason: "pause" }]);
  });

  it("une pause expirée est levée et le message est traité", async () => {
    const r = await runEngine(
      input({
        contact: freshContact({ pause: { reason: "echo_gerant", until: addMinutes(NOW, -1).toISOString() } }),
        message: { kind: "text", text: "commander" },
      }),
    );
    expect(r.contact.pause).toBeNull();
    expect(r.events[0]).toEqual({ type: "pause_expired" });
    expect(r.outgoing.length).toBeGreaterThan(0);
  });

  it("un message du gérant (echo) met le bot en pause 12 h pour ce contact", async () => {
    const r1 = await runEngine(input({ message: { kind: "text", text: "menu" } }));
    const r2 = await runEngine(next(r1, { message: { kind: "echo", text: "Je m'en occupe !" } }));
    expect(r2.session).toBeNull();
    expect(r2.outgoing).toEqual([]);
    expect(r2.contact.pause).toEqual({ reason: "echo_gerant", until: addMinutes(NOW, 12 * 60).toISOString() });

    const r3 = await runEngine(next(r2, { now: addMinutes(NOW, 11 * 60), message: { kind: "text", text: "commander" } }));
    expect(r3.outgoing).toEqual([]);

    const r4 = await runEngine(next(r3, { now: addMinutes(NOW, 13 * 60), message: { kind: "text", text: "commander" } }));
    expect(r4.outgoing.length).toBeGreaterThan(0);
  });

  it("un echo ne raccourcit pas une pause plus longue", async () => {
    const r = await runEngine(
      input({ contact: freshContact({ pause: { reason: "manuel", until: null } }), message: { kind: "echo" } }),
    );
    expect(r.contact.pause).toEqual({ reason: "echo_gerant", until: null });
  });

  it("l'IA peut demander un transfert humain : pause et alerte", async () => {
    const ai = fakeAi({ action: "transfert_humain" });
    const r = await runEngine(
      input({ channel: { ...channel, triggerMode: "toujours" }, message: { kind: "text", text: "j'ai un souci avec ma commande" } }),
      { ai: ai.port },
    );
    expect(texts(r)).toEqual([TEXTS.handoff]);
    expect(r.contact.pause).toEqual({ reason: "transfert_humain", until: addMinutes(NOW, 24 * 60).toISOString() });
    expect(r.events).toContainEqual({ type: "handoff", source: "ia", message: "j'ai un souci avec ma commande" });
  });
});

describe("IA de secours : garde-fous", () => {
  const toujours = { ...channel, triggerMode: "toujours" as const };

  const agent: AgentConfig = {
    consigne: "Tu es l'assistant de {{nom_resto}}.",
    functions: [
      { name: "reserver", flowId: "f_resa", description: "Le client veut réserver", aiText: "silence" },
      { name: "proposer", flowId: "f_propose", description: "Proposer de commander", aiText: "variable" },
      { name: "agneau", flowId: "f_agneau", description: "Questions sur l'agneau", aiText: "avant" },
      { name: "fantome", flowId: "f_supprime", description: "Flux supprimé", aiText: "silence" },
    ],
  };
  const propose: Flow = {
    id: "f_propose",
    name: "Proposer",
    nodes: [node("t", "trigger", { keywords: [] }), say("m", "{{ia_reponse}}"), say("m2", "Ça vous tente ?")],
    edges: [edge("t", "m"), edge("m", "m2")],
  };
  const withPropose = [...flows, propose];

  it("l'IA reçoit la consigne rendue et seulement les fonctions dont le flux existe", async () => {
    const ai = fakeAi({ action: "repondre", texte: "ok" });
    await runEngine(input({ channel: toujours, agent, flows: withPropose, message: { kind: "text", text: "?" } }), { ai: ai.port });
    expect(ai.calls[0].consigne).toBe("Tu es l'assistant de Mexico.");
    expect(ai.calls[0].functions.map((f) => f.name)).toEqual(["reserver", "proposer", "agneau"]);
  });

  it("fonction « silence » : l'IA se tait, le flux répond seul", async () => {
    const ai = fakeAi({ action: "fonction", fonction: "reserver", texte: "Je regarde…" });
    const r = await runEngine(input({ channel: toujours, agent, message: { kind: "text", text: "une table pour ce soir" } }), {
      ai: ai.port,
    });
    expect(texts(r)).toEqual(["Pour combien de personnes ?"]);
    expect(r.events).toContainEqual({ type: "flow_started", flowId: "f_resa", via: "ia" });
  });

  it("fonction « variable » : la réponse de l'IA est passée au flux dans {{ia_reponse}}", async () => {
    const ai = fakeAi({ action: "fonction", fonction: "proposer", texte: "Le burrito poulet est parfait 🌯" });
    const r = await runEngine(input({ channel: toujours, agent, flows: withPropose, message: { kind: "text", text: "un conseil ?" } }), {
      ai: ai.port,
    });
    expect(texts(r)).toEqual(["Le burrito poulet est parfait 🌯", "Ça vous tente ?"]);
  });

  it("fonction « avant » : le texte de l'IA part, puis le flux", async () => {
    const ai = fakeAi({ action: "fonction", fonction: "agneau", texte: "Bonne question !" });
    const r = await runEngine(input({ channel: toujours, agent, message: { kind: "text", text: "un plat du week-end ?" } }), { ai: ai.port });
    expect(texts(r)[0]).toBe("Bonne question !");
    expect(r.events).toContainEqual({ type: "flow_started", flowId: "f_agneau", via: "ia" });
  });

  it("une fonction inconnue (ou dont le flux n'existe plus) donne un transfert humain", async () => {
    for (const fonction of ["inventee", "fantome"]) {
      const ai = fakeAi({ action: "fonction", fonction });
      const r = await runEngine(input({ channel: toujours, agent, message: { kind: "text", text: "?" } }), { ai: ai.port });
      expect(r.contact.pause?.reason).toBe("transfert_humain");
      expect(r.events).toContainEqual({ type: "error", message: `IA : fonction inconnue « ${fonction} »` });
    }
  });

  it("garde-fou : un lien dans la réponse est retiré et la réponse passe par proposer_commande (bouton garanti)", async () => {
    const ai = fakeAi({ action: "repondre", texte: "Bonjour !\nLe burrito est top 🌯 Commandez ici : https://order.pflow.fr/c/mexico" });
    const withProposeOrder: AgentConfig = {
      ...agent,
      functions: [...agent.functions, { name: "proposer_commande", flowId: "f_propose", description: "Proposer de commander", aiText: "variable" }],
    };
    const r = await runEngine(input({ channel: toujours, agent: withProposeOrder, flows: withPropose, message: { kind: "text", text: "un conseil ?" } }), {
      ai: ai.port,
    });
    expect(texts(r)).toEqual(["Le burrito est top 🌯 Commandez ici", "Ça vous tente ?"]);
    expect(r.events).toContainEqual({
      type: "ai_text_cleaned",
      removedLinks: ["https://order.pflow.fr/c/mexico"],
      removedGreeting: true,
      fallback: "proposer_commande",
    });
    expect(r.events).toContainEqual({ type: "flow_started", flowId: "f_propose", via: "ia" });
    expect(r.outgoing.some((m) => m.kind === "text" && m.text.includes("http"))).toBe(false);
  });

  it("garde-fou sans proposer_commande : lien retiré, bouton « Commander » natif ajouté", async () => {
    const ai = fakeAi({ action: "repondre", texte: "Tout est sur www.order.pflow.fr/c/mexico" });
    const r = await runEngine(input({ channel: toujours, message: { kind: "text", text: "la carte ?" } }), { ai: ai.port });
    expect(r.outgoing).toEqual([
      { kind: "text", text: "Tout est sur" },
      { kind: "link", text: TEXTS.orderLink, url: "https://order.pflow.fr/c/mexico", buttonLabel: TEXTS.orderButton },
    ]);
  });

  it("garde-fou : un lien dans {{ia_reponse}} est aussi retiré", async () => {
    const ai = fakeAi({ action: "fonction", fonction: "proposer", texte: "Le burrito 🌯 https://order.pflow.fr/c/mexico" });
    const r = await runEngine(input({ channel: toujours, agent, flows: withPropose, message: { kind: "text", text: "?" } }), { ai: ai.port });
    expect(texts(r)).toEqual(["Le burrito 🌯", "Ça vous tente ?"]);
  });

  it("le texte d'un transfert demandé par l'IA est envoyé au client", async () => {
    const ai = fakeAi({ action: "transfert_humain", texte: "Je préviens l'équipe 🙏" });
    const r = await runEngine(input({ channel: toujours, message: { kind: "text", text: "?" } }), { ai: ai.port });
    expect(texts(r)).toEqual(["Je préviens l'équipe 🙏"]);
  });

  it("une réponse vide de l'IA donne un transfert humain", async () => {
    const ai = fakeAi({ action: "repondre", texte: "  " });
    const r = await runEngine(input({ channel: toujours, message: { kind: "text", text: "?" } }), { ai: ai.port });
    expect(r.contact.pause?.reason).toBe("transfert_humain");
  });

  it("une erreur de l'IA donne un transfert humain", async () => {
    const r = await runEngine(input({ channel: toujours, message: { kind: "text", text: "?" } }), {
      ai: async () => {
        throw new Error("timeout");
      },
    });
    expect(r.events).toContainEqual({ type: "error", message: "IA : timeout" });
    expect(r.events).toContainEqual({ type: "handoff", source: "erreur_ia", message: "?" });
  });

  it("au-delà de la limite quotidienne, l'IA n'est plus appelée", async () => {
    const ai = fakeAi({ action: "repondre", texte: "ok" });
    const r = await runEngine(
      input({
        channel: toujours,
        contact: freshContact({ aiUsage: { day: "2026-11-03", calls: 20 } }),
        message: { kind: "text", text: "?" },
      }),
      { ai: ai.port },
    );
    expect(ai.calls).toHaveLength(0);
    expect(r.events).toContainEqual({ type: "handoff", source: "limite_ia", message: "?" });
  });

  it("le compteur repart à zéro le lendemain, à minuit heure du resto", async () => {
    const ai = fakeAi({ action: "repondre", texte: "ok" });
    // 3 novembre 23:30 UTC = 19:30 en Guadeloupe : toujours le 3 novembre.
    const sameDay = await runEngine(
      input({
        channel: toujours,
        now: new Date("2026-11-03T23:30:00Z"),
        contact: freshContact({ aiUsage: { day: "2026-11-03", calls: 20 } }),
        message: { kind: "text", text: "?" },
      }),
      { ai: ai.port },
    );
    expect(ai.calls).toHaveLength(0);
    expect(sameDay.contact.pause?.reason).toBe("transfert_humain");

    const nextDay = await runEngine(
      input({
        channel: toujours,
        now: new Date("2026-11-04T04:30:00Z"),
        contact: freshContact({ aiUsage: { day: "2026-11-03", calls: 20 } }),
        message: { kind: "text", text: "?" },
      }),
      { ai: ai.port },
    );
    expect(ai.calls).toHaveLength(1);
    expect(nextDay.contact.aiUsage).toEqual({ day: "2026-11-04", calls: 1 });
  });

  it("dans un bloc IA, l'IA reçoit les consignes du bloc et la conversation continue", async () => {
    const ai = fakeAi({ action: "repondre", texte: "On est au 12 rue Frébault." });
    const r1 = await runEngine(input({ message: { kind: "text", text: "menu" } }));
    const r2 = await runEngine(next(r1, { message: { kind: "text", text: "3" } }));
    expect(texts(r2)).toEqual(["Posez-moi votre question 🙂"]);
    expect(r2.session?.nodeId).toBe("ia");

    const r3 = await runEngine(next(r2, { message: { kind: "text", text: "vous êtes où ?" } }), { ai: ai.port });
    expect(texts(r3)).toEqual(["On est au 12 rue Frébault."]);
    expect(ai.calls[0].instructions).toBe("Sois bref.");
    expect(r3.session?.nodeId).toBe("ia");
  });
});

describe("canal WhatsApp : retour de commande et lien « Commander »", () => {
  it("« ✅ Commande n° 42 passée » : ni accueil, ni IA", async () => {
    const ai = fakeAi({ action: "repondre", texte: "?" });
    for (const text of ["✅ Commande n° 42 passée", "Commande n°7 passée", "commande n° 1234 passée !"]) {
      const r = await runEngine(input({ channel: { ...channel, triggerMode: "toujours" }, message: { kind: "text", text } }), { ai: ai.port });
      expect(r.outgoing).toEqual([]);
      expect(r.events).toEqual([{ type: "ignored", reason: "retour_commande" }]);
    }
    expect(ai.calls).toHaveLength(0);
  });

  it("le bouton « Commander » porte les paramètres du canal (via=wa, jeton) ; le simulateur non", async () => {
    const link = async (orderLinkQuery?: string) => {
      const r1 = await runEngine(input({ orderLinkQuery, message: { kind: "text", text: "commander" } }));
      const r2 = await runEngine(next(r1, { orderLinkQuery, message: { kind: "text", text: "1" } }));
      return r2.outgoing.find((m) => m.kind === "link");
    };
    expect(await link("via=wa&wa=JETON")).toMatchObject({ url: "https://order.pflow.fr/c/mexico?via=wa&wa=JETON" });
    expect(await link()).toMatchObject({ url: "https://order.pflow.fr/c/mexico" });
  });
});

describe("bloc IA (agent)", () => {
  const toujours = { ...channel, triggerMode: "toujours" as const };
  const agent: AgentConfig = {
    consigne: "",
    inactivityMinutes: 10,
    functions: [
      { name: "reserver", flowId: "f_resa", description: "Réserver", aiText: "silence" },
      { name: "agneau", flowId: "f_agneau", description: "Agneau", aiText: "silence" },
    ],
  };
  const reco = (data: Partial<import("../types").NodeDataMap["ai"]> = {}): Flow => ({
    id: "f_reco",
    name: "Reco",
    nodes: [node("t", "trigger", { keywords: ["conseil"] }), node("ia", "ai", { intro: "Qu'est-ce qui vous ferait plaisir ?", ...data })],
    edges: [edge("t", "ia")],
  });

  it("garde en mémoire les échanges précédents du bloc IA", async () => {
    const ai = fakeAi((req) => ({ action: "repondre", texte: `réponse ${req.history.length / 2 + 1}` }));
    const flowsReco = [...flows, reco()];
    const r1 = await runEngine(input({ agent, flows: flowsReco, message: { kind: "text", text: "conseil" } }), { ai: ai.port });
    expect(ai.calls).toHaveLength(0);
    const r2 = await runEngine(next(r1, { agent, flows: flowsReco, message: { kind: "text", text: "du sucré" } }), { ai: ai.port });
    const r3 = await runEngine(next(r2, { agent, flows: flowsReco, message: { kind: "text", text: "et moins cher ?" } }), { ai: ai.port });
    expect(texts(r3)).toEqual(["réponse 2"]);
    expect(ai.calls[1].history).toEqual([
      { role: "client", text: "du sucré" },
      { role: "assistant", text: "réponse 1" },
    ]);
    expect(r3.session?.aiHistory).toHaveLength(4);
  });

  it("n'autorise que les fonctions cochées dans le bloc", async () => {
    const ai = fakeAi({ action: "repondre", texte: "ok" });
    const flowsReco = [...flows, reco({ functions: ["agneau"] })];
    const r1 = await runEngine(input({ agent, flows: flowsReco, message: { kind: "text", text: "conseil" } }));
    await runEngine(next(r1, { agent, flows: flowsReco, message: { kind: "text", text: "?" } }), { ai: ai.port });
    expect(ai.calls[0].functions.map((f) => f.name)).toEqual(["agneau"]);
  });

  it("texte d'entrée : l'IA est appelée tout de suite, avec les variables et la consigne du bloc", async () => {
    const ai = fakeAi({ action: "repondre", texte: "Je vous conseille le burrito 🌯" });
    const flowsReco = [...flows, reco({ input: "Le client {{prenom}} veut un conseil.", instructions: "Propose 2 plats." })];
    const r = await runEngine(input({ agent, channel: toujours, flows: flowsReco, message: { kind: "text", text: "conseil" } }), {
      ai: ai.port,
    });
    expect(texts(r)).toEqual(["Qu'est-ce qui vous ferait plaisir ?", "Je vous conseille le burrito 🌯"]);
    expect(ai.calls[0].message).toBe("Le client Jules veut un conseil.");
    expect(ai.calls[0].instructions).toBe("Propose 2 plats.");
    expect(r.session?.nodeId).toBe("ia");
  });

  it("une fonction appelée depuis le bloc IA remplace le bloc (l'agent s'arrête)", async () => {
    const ai = fakeAi({ action: "fonction", fonction: "reserver" });
    const flowsReco = [...flows, reco()];
    const r1 = await runEngine(input({ agent, flows: flowsReco, message: { kind: "text", text: "conseil" } }));
    const r2 = await runEngine(next(r1, { agent, flows: flowsReco, message: { kind: "text", text: "je veux réserver" } }), { ai: ai.port });
    expect(texts(r2)).toEqual(["Pour combien de personnes ?"]);
    expect(r2.session?.flowId).toBe("f_resa");
    expect(r2.session?.aiHistory).toBeUndefined();
  });

  it("délai d'inactivité : celui du bloc, sinon celui de l'agent", async () => {
    const r1 = await runEngine(input({ agent, flows: [...flows, reco()], message: { kind: "text", text: "conseil" } }));
    expect(r1.session?.expiresAt).toBe(addMinutes(NOW, 10).toISOString());
    const r2 = await runEngine(input({ agent, flows: [...flows, reco({ inactivityMinutes: 3 })], message: { kind: "text", text: "conseil" } }));
    expect(r2.session?.expiresAt).toBe(addMinutes(NOW, 3).toISOString());
    const r3 = await runEngine(next(r2, { agent, flows: [...flows, reco({ inactivityMinutes: 3 })], now: addMinutes(NOW, 4), message: { kind: "text", text: "?" } }));
    expect(r3.events).toContainEqual({ type: "session_expired", flowId: "f_reco" });
  });
});

describe("sessions, aller à un flux, garde-fous", () => {
  it("une session expire après 30 minutes d'inactivité", async () => {
    const r1 = await runEngine(input({ message: { kind: "text", text: "menu" } }));
    const r2 = await runEngine(next(r1, { now: addMinutes(NOW, 31), message: { kind: "text", text: "2" } }));
    expect(r2.outgoing).toEqual([]);
    expect(r2.session).toBeNull();
    expect(r2.events).toContainEqual({ type: "session_expired", flowId: "f_accueil" });
  });

  it("« Aller à un flux » enchaîne sur le flux cible", async () => {
    const r = await runEngine(input({ message: { kind: "text", text: "aide" } }));
    expect(texts(r)[0]).toBe("Bonjour Jules 👋 Bienvenue chez Mexico !");
    expect(r.session?.flowId).toBe("f_accueil");
  });

  it("une boucle infinie est interrompue", async () => {
    const a: Flow = {
      id: "a",
      name: "A",
      nodes: [node("t", "trigger", { keywords: ["boucle"] }), node("g", "goto_flow", { flowId: "b" })],
      edges: [edge("t", "g")],
    };
    const b: Flow = {
      id: "b",
      name: "B",
      nodes: [node("t", "trigger", { keywords: [] }), node("g", "goto_flow", { flowId: "a" })],
      edges: [edge("t", "g")],
    };
    const r = await runEngine(input({ flows: [a, b], message: { kind: "text", text: "boucle" } }));
    expect(r.session).toBeNull();
    expect(r.events).toContainEqual({ type: "error", message: "Boucle détectée : exécution interrompue" });
    expect(r.events.filter((e) => e.type === "flow_started").length).toBeLessThanOrEqual(MAX_STEPS_PER_MESSAGE);
  });

  it("un média non géré est ignoré hors session, et redemandé en session", async () => {
    const outside = await runEngine(input({ message: { kind: "unsupported", mediaType: "audio" } }));
    expect(outside.outgoing).toEqual([]);
    expect(outside.events).toEqual([{ type: "ignored", reason: "media_non_gere" }]);

    const r1 = await runEngine(input({ message: { kind: "text", text: "réserver" } }));
    const r2 = await runEngine(next(r1, { message: { kind: "unsupported", mediaType: "audio" } }));
    expect(texts(r2)).toEqual([TEXTS.unsupported, "Pour combien de personnes ?"]);
  });

  it("un flux sans suite se termine proprement", async () => {
    const r = await runEngine(input({ flows: [agneau], message: { kind: "text", text: "agneau" } }));
    expect(r.session).toBeNull();
    expect(r.events.at(-1)).toEqual({ type: "flow_ended", flowId: "f_agneau" });
  });

  it("le moteur ne modifie pas les objets reçus", async () => {
    const contact = freshContact();
    const before = structuredClone(contact);
    await runEngine(input({ contact, message: { kind: "echo" } }));
    expect(contact).toEqual(before);
  });

  it("le lien de commande utilise le slug du client", async () => {
    const id = encodeReplyId({ flowId: "f_accueil", nodeId: "b", handle: "cmd" });
    const r = await runEngine(
      input({ client: { ...client, orderSlug: "chez-paul" }, message: { kind: "button_reply", id, title: "Commander" } }),
    );
    expect(r.outgoing[0]).toMatchObject({ kind: "link", url: "https://order.pflow.fr/c/chez-paul" });
  });
});

describe("flux par défaut", () => {
  const defaut: Flow = {
    id: "f_defaut",
    name: "Par défaut",
    nodes: [
      node("t", "trigger", { keywords: [], isDefault: true }),
      say("m", "Bienvenue ! Tapez « menu » pour commander."),
    ],
    edges: [edge("t", "m")],
  };
  const toujours = { ...channel, triggerMode: "toujours" as const };
  const withDefault = [defaut, ...input().flows];

  it("se lance sur n'importe quel message quand aucun mot-clé ne correspond", async () => {
    const r = await runEngine(input({ channel: toujours, flows: withDefault, message: { kind: "text", text: "yo" } }));
    expect(texts(r)).toEqual(["Bienvenue ! Tapez « menu » pour commander."]);
    expect(r.events).toContainEqual({ type: "flow_started", flowId: "f_defaut", via: "defaut" });
  });

  it("passe avant l'IA de secours", async () => {
    const ai = fakeAi({ action: "repondre", texte: "?" });
    await runEngine(input({ channel: toujours, flows: withDefault, message: { kind: "text", text: "yo" } }), { ai: ai.port });
    expect(ai.calls).toHaveLength(0);
  });

  it("un mot-clé reste prioritaire", async () => {
    const r = await runEngine(input({ channel: toujours, flows: withDefault, message: { kind: "text", text: "agneau" } }));
    expect(r.events).toContainEqual({ type: "flow_started", flowId: "f_agneau", via: "mot_cle" });
  });

  it("une session en cours reste prioritaire", async () => {
    const r1 = await runEngine(input({ channel: toujours, flows: withDefault, message: { kind: "text", text: "réserver" } }));
    const r2 = await runEngine(next(r1, { channel: toujours, flows: withDefault, message: { kind: "text", text: "4" } }));
    expect(texts(r2)).toEqual(["Votre numéro ?"]);
  });

  it("ne se déclenche jamais sur un canal « mots-clés uniquement »", async () => {
    const r = await runEngine(input({ flows: withDefault, message: { kind: "text", text: "coucou c'est maman" } }));
    expect(r.outgoing).toEqual([]);
    expect(r.events).toEqual([{ type: "ignored", reason: "aucun_declencheur" }]);
  });
});

describe("bloc Message à plusieurs bulles (façon UChat)", () => {
  /** La trame d'accueil de Jules : bulle 1 + bouton lien, bulle 2 + 2 boutons de réponse. */
  const accueilUChat = (withNext = false): Flow => ({
    id: "f_uchat",
    name: "Accueil",
    nodes: [
      node("t", "trigger", { keywords: ["salut"] }),
      node("m", "message", {
        bubbles: [
          {
            id: "b1",
            text: "👋 Hello {{prenom}} ! Bienvenue chez {{nom_resto}} 🍔",
            buttons: [{ id: "cmd", kind: "link", title: "Commander", orderLink: true }],
          },
          {
            id: "b2",
            text: "✨ Besoin d'un petit coup de main ?",
            buttons: [
              { id: "conseil", kind: "reply", title: "⭐ Me conseiller" },
              { id: "infos", kind: "reply", title: "ℹ️ Infos pratiques" },
            ],
          },
        ],
      }),
      say("c", "Je vous conseille le burger maison !"),
      say("i", "Nous sommes au 12 rue Frébault."),
      say("suite", "Et sinon, voici la suite."),
    ],
    edges: [edge("t", "m"), edge("m", "c", "conseil"), edge("m", "i", "infos"), ...(withNext ? [edge("m", "suite", "next")] : [])],
  });

  it("envoie les bulles dans l'ordre : bouton lien natif puis boutons de réponse", async () => {
    const r = await runEngine(input({ flows: [accueilUChat()], message: { kind: "text", text: "salut" } }));
    expect(r.outgoing[0]).toEqual({
      kind: "link",
      text: "👋 Hello Jules ! Bienvenue chez Mexico 🍔",
      url: "https://order.pflow.fr/c/mexico",
      buttonLabel: "Commander",
    });
    expect(r.outgoing[1]).toMatchObject({ kind: "buttons", text: "✨ Besoin d'un petit coup de main ?" });
    expect(r.outgoing).toHaveLength(2);
  });

  it("étape suivante non reliée : le bot attend le clic", async () => {
    const r = await runEngine(input({ flows: [accueilUChat()], message: { kind: "text", text: "salut" } }));
    expect(r.session?.nodeId).toBe("m");
    const r2 = await runEngine(next(r, { flows: [accueilUChat()], message: { kind: "text", text: "infos pratiques" } }));
    expect(texts(r2)).toEqual(["Nous sommes au 12 rue Frébault."]);
  });

  it("sans réponse reconnue, seules les bulles à boutons de réponse sont renvoyées", async () => {
    const r = await runEngine(input({ flows: [accueilUChat()], message: { kind: "text", text: "salut" } }));
    const r2 = await runEngine(next(r, { flows: [accueilUChat()], message: { kind: "text", text: "euh" } }));
    expect(r2.outgoing.map((m) => m.kind)).toEqual(["text", "buttons"]);
  });

  it("étape suivante reliée : la suite part tout de suite, et les boutons restent cliquables", async () => {
    const flow = accueilUChat(true);
    const r = await runEngine(input({ flows: [flow], message: { kind: "text", text: "salut" } }));
    expect(texts(r).at(-1)).toBe("Et sinon, voici la suite.");
    expect(r.session).toBeNull();
    const buttons = r.outgoing[1];
    if (buttons.kind !== "buttons") throw new Error("boutons attendus");
    const r2 = await runEngine(next(r, { flows: [flow], message: { kind: "button_reply", id: buttons.buttons[0].id, title: "⭐ Me conseiller" } }));
    expect(texts(r2)).toEqual(["Je vous conseille le burger maison !"]);
  });

  it("un bouton d'une bulle précédente garde les variables de la session", async () => {
    const flow: Flow = {
      id: "f_vars",
      name: "Vars",
      nodes: [
        node("t", "trigger", { keywords: ["go"] }),
        ask("m", "Choisissez", [{ id: "a", title: "A" }]),
        node("q", "question", { text: "Votre prénom ?", variable: "nom", validation: "texte" }),
        node("q2", "question", { text: "Votre ville ?", variable: "ville", validation: "texte" }),
        say("ok", "Merci {{nom}}"),
      ],
      edges: [edge("t", "m"), edge("m", "q", "next"), edge("q", "q2"), edge("m", "ok", "a")],
    };
    const r1 = await runEngine(input({ flows: [flow], message: { kind: "text", text: "go" } }));
    expect(r1.session?.nodeId).toBe("q");
    const r2 = await runEngine(next(r1, { flows: [flow], message: { kind: "text", text: "Léa" } }));
    expect(r2.session?.nodeId).toBe("q2");
    const id = encodeReplyId({ flowId: "f_vars", nodeId: "m", handle: "a" });
    const r3 = await runEngine(next(r2, { flows: [flow], message: { kind: "button_reply", id, title: "A" } }));
    expect(texts(r3)).toEqual(["Merci Léa"]);
  });

  it("bouton lien avec URL libre et variables", async () => {
    const flow: Flow = {
      id: "f_url",
      name: "URL",
      nodes: [
        node("t", "trigger", { keywords: ["avis"] }),
        node("m", "message", {
          bubbles: [{ id: "b", text: "Laissez-nous un avis 🙏", buttons: [{ id: "l", kind: "link", title: "Donner mon avis", url: "https://g.page/{{nom_resto}}" }] }],
        }),
      ],
      edges: [edge("t", "m")],
    };
    const r = await runEngine(input({ flows: [flow], message: { kind: "text", text: "avis" } }));
    expect(r.outgoing[0]).toEqual({ kind: "link", text: "Laissez-nous un avis 🙏", url: "https://g.page/Mexico", buttonLabel: "Donner mon avis" });
  });

  it("lien de commande sans slug : la bulle part en texte simple et l'erreur est journalisée", async () => {
    const r = await runEngine(input({ client: { ...client, orderSlug: "" }, flows: [accueilUChat()], message: { kind: "text", text: "salut" } }));
    expect(r.outgoing[0]).toEqual({ kind: "text", text: "👋 Hello Jules ! Bienvenue chez Mexico 🍔" });
    expect(r.events).toContainEqual({ type: "error", message: "Lien de commande : slug du resto manquant" });
  });

  it("une bulle de texte seule continue directement", async () => {
    const r = await runEngine(input({ message: { kind: "text", text: "agneau" } }));
    expect(r.session).toBeNull();
  });
});

describe("bloc Délai", () => {
  const flow = (data: { mode: "fixe" | "intelligent"; seconds?: number }, text = "Votre commande est prête !"): Flow => ({
    id: "f_delai",
    name: "Délai",
    nodes: [node("t", "trigger", { keywords: ["test"] }), node("d", "delay", data), say("m", text)],
    edges: [edge("t", "d"), edge("d", "m")],
  });

  it("délai fixe : indicateur « en train d'écrire » avant le message", async () => {
    const r = await runEngine(input({ flows: [flow({ mode: "fixe", seconds: 3 })], message: { kind: "text", text: "test" } }));
    expect(r.outgoing).toEqual([{ kind: "typing", ms: 3000 }, { kind: "text", text: "Votre commande est prête !" }]);
  });

  it("délai fixe borné entre 0,5 s et 10 s", async () => {
    const long = await runEngine(input({ flows: [flow({ mode: "fixe", seconds: 60 })], message: { kind: "text", text: "test" } }));
    expect(long.outgoing[0]).toEqual({ kind: "typing", ms: 10_000 });
  });

  it("délai intelligent : plus le message est long, plus le délai est long (1 à 5 s)", async () => {
    const court = await runEngine(input({ flows: [flow({ mode: "intelligent" }, "Ok")], message: { kind: "text", text: "test" } }));
    const moyen = await runEngine(input({ flows: [flow({ mode: "intelligent" }, "x".repeat(60))], message: { kind: "text", text: "test" } }));
    const long = await runEngine(input({ flows: [flow({ mode: "intelligent" }, "x".repeat(500))], message: { kind: "text", text: "test" } }));
    expect(court.outgoing[0]).toEqual({ kind: "typing", ms: 1000 });
    expect(moyen.outgoing[0]).toEqual({ kind: "typing", ms: 2900 });
    expect(long.outgoing[0]).toEqual({ kind: "typing", ms: 5000 });
  });

  it("un délai qui ne précède aucun message est retiré", async () => {
    const f: Flow = { id: "x", name: "x", nodes: [node("t", "trigger", { keywords: ["test"] }), node("d", "delay", { mode: "fixe", seconds: 2 })], edges: [edge("t", "d")] };
    const r = await runEngine(input({ flows: [f], message: { kind: "text", text: "test" } }));
    expect(r.outgoing).toEqual([]);
  });
});

describe("trace pour le simulateur", () => {
  it("mot-clé reconnu et blocs exécutés sont journalisés", async () => {
    const r = await runEngine(input({ message: { kind: "text", text: "Je veux COMMANDER" } }));
    expect(r.events[0]).toEqual({ type: "keyword_matched", flowId: "f_accueil", keyword: "commander" });
    expect(r.events.filter((e) => e.type === "step").map((e) => (e.type === "step" ? e.nodeId : ""))).toEqual(["t", "m", "b"]);
  });

  it("démarrage manuel d'un flux (sous-flux sans mot-clé)", async () => {
    const r = await runEngine(input({ message: { kind: "start_flow", flowId: "f_agneau" } }));
    expect(r.events).toContainEqual({ type: "flow_started", flowId: "f_agneau", via: "manuel" });
    expect(r.contact.lastInboundAt).toBe(NOW.toISOString());
    const paused = await runEngine(
      input({ contact: freshContact({ pause: { reason: "manuel", until: null } }), message: { kind: "start_flow", flowId: "f_agneau" } }),
    );
    expect(paused.outgoing).toEqual([]);
  });
});

describe("mode toujours : Accueil seulement pour une salutation ou un premier contact", () => {
  const withDefault = flows.map((f) =>
    f.id === "f_accueil" ? { ...f, nodes: f.nodes.map((n) => (n.type === "trigger" ? { ...n, data: { ...n.data, isDefault: true } } : n)) } : f,
  ) as typeof flows;
  const known: ReturnType<typeof freshContact> = { ...freshContact(), lastInboundAt: addMinutes(NOW, -60).toISOString() };
  const base = (text: string, contact = known) =>
    input({ channel: { ...channel, triggerMode: "toujours" }, flows: withDefault, contact, message: { kind: "text", text } });

  it("une vraie question va à l'IA, pas à l'Accueil", async () => {
    const ai = fakeAi({ action: "repondre", texte: "Le cookie triple chocolat !" });
    const r = await runEngine(base("c'est quoi votre meilleur cookie ?"), { ai: ai.port });
    expect(ai.calls).toHaveLength(1);
    expect(texts(r)).toEqual(["Le cookie triple chocolat !"]);
    expect(r.events).not.toContainEqual(expect.objectContaining({ type: "flow_started", flowId: "f_accueil" }));
  });

  it("une salutation lance l'Accueil (flux par défaut), sans IA", async () => {
    const ai = fakeAi({ action: "repondre", texte: "?" });
    for (const text of ["Bonsoir", "salut ça va ?", "Bonjou", "coucou madame"]) {
      const r = await runEngine(base(text), { ai: ai.port });
      expect(r.events).toContainEqual({ type: "flow_started", flowId: "f_accueil", via: "defaut" });
    }
    expect(ai.calls).toHaveLength(0);
  });

  it("premier contact très court (« ok », emoji) : Accueil ; premier contact avec une question : IA", async () => {
    const ai = fakeAi({ action: "repondre", texte: "Oui !" });
    const r1 = await runEngine(base("👍", freshContact()), { ai: ai.port });
    expect(r1.events).toContainEqual({ type: "flow_started", flowId: "f_accueil", via: "defaut" });
    const r2 = await runEngine(base("vous livrez à Baie-Mahault ce soir ?", freshContact()), { ai: ai.port });
    expect(ai.calls).toHaveLength(1);
    expect(texts(r2)).toEqual(["Oui !"]);
  });

  it("sans IA : l'Accueil reste le filet de sécurité", async () => {
    const r = await runEngine(base("c'est quoi votre meilleur cookie ?"));
    expect(r.events).toContainEqual({ type: "flow_started", flowId: "f_accueil", via: "defaut" });
  });

  it("variable nouvelle_conversation : oui au premier message ou après 12 h sans message, sinon non", async () => {
    const flow = {
      id: "f_v",
      name: "V",
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { keywords: ["test"] } },
        { id: "m", type: "message", position: { x: 0, y: 0 }, data: { bubbles: [{ id: "b", text: "nouvelle={{nouvelle_conversation}}", buttons: [] }] } },
      ],
      edges: [{ id: "e", source: "t", target: "m" }],
    } as unknown as (typeof flows)[number];
    const run = (lastInboundAt?: string) => runEngine(input({ flows: [flow], contact: { ...freshContact(), lastInboundAt }, message: { kind: "text", text: "test" } }));
    expect(texts(await run())).toEqual(["nouvelle=oui"]);
    expect(texts(await run(addMinutes(NOW, -13 * 60).toISOString()))).toEqual(["nouvelle=oui"]);
    expect(texts(await run(addMinutes(NOW, -60).toISOString()))).toEqual(["nouvelle=non"]);
  });
});
