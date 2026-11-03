import { describe, expect, it } from "vitest";
import { decodeReplyId, encodeReplyId } from "../reply-id";
import { runEngine, TEXTS, MAX_STEPS_PER_MESSAGE } from "../run";
import type { EngineInput, EngineResult, Flow } from "../types";
import {
  NOW,
  addMinutes,
  agneau,
  channel,
  client,
  edge,
  fakeAi,
  freshContact,
  input,
  node,
} from "./fixtures";

/** Enchaîne un message après un résultat précédent (même contact, même session). */
function next(prev: EngineResult, overrides: Partial<EngineInput>): EngineInput {
  return input({ contact: prev.contact, session: prev.session, ...overrides });
}

const texts = (r: EngineResult) => r.outgoing.map((m) => m.text);

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
    });
    expect(ai.calls[0].flows.map((f) => f.id)).toEqual(["f_accueil", "f_agneau", "f_resa", "f_aide"]);
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
    const r2 = await runEngine(next(r1, { message: { kind: "text", text: "il y a de l'agneau ?" } }), { ai: ai.port });
    expect(ai.calls).toHaveLength(0);
    expect(r2.events).toContainEqual({ type: "flow_started", flowId: "f_agneau", via: "mot_cle" });
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
        node("m", "message", { text: "Nos burritos sont à la page 2." }),
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
        node("o", "message", { text: "ouvert" }),
        node("f", "message", { text: "fermé" }),
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

  it("l'IA peut envoyer vers un flux", async () => {
    const ai = fakeAi({ action: "aller_au_flux", flux_id: "f_resa" });
    const r = await runEngine(input({ channel: toujours, message: { kind: "text", text: "une table pour ce soir" } }), {
      ai: ai.port,
    });
    expect(texts(r)).toEqual(["Pour combien de personnes ?"]);
    expect(r.events).toContainEqual({ type: "flow_started", flowId: "f_resa", via: "ia" });
  });

  it("un flux inconnu proposé par l'IA donne un transfert humain", async () => {
    const ai = fakeAi({ action: "aller_au_flux", flux_id: "f_invente" });
    const r = await runEngine(input({ channel: toujours, message: { kind: "text", text: "?" } }), { ai: ai.port });
    expect(r.contact.pause?.reason).toBe("transfert_humain");
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
