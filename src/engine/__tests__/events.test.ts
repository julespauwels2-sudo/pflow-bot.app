import { describe, expect, it } from "vitest";
import { exampleEventData } from "../events";
import { runEngine } from "../run";
import type { Flow } from "../types";
import { NOW, addMinutes, channel, edge, freshContact, input, node, say } from "./fixtures";

const prete: Flow = {
  id: "f_prete",
  name: "Statut - Prête",
  nodes: [node("t", "trigger", { keywords: [], event: "commande_prete" }), say("m", "✅ Bonne nouvelle {{client_nom}} ! Votre commande #{{commande_numero}} est prête.")],
  edges: [edge("t", "m")],
};
const panier: Flow = {
  id: "f_panier",
  name: "Panier abandonné",
  nodes: [
    node("t", "trigger", { keywords: [], event: "panier_abandonne" }),
    node("m", "message", {
      bubbles: [{ id: "b1", text: "🛒 Votre panier vous attend : {{panier_total}}", buttons: [{ id: "l", kind: "link", title: "🛒 Reprendre", url: "{{lien_panier}}" }] }],
    }),
  ],
  edges: [edge("t", "m")],
};

/** Contact qui a écrit au bot il y a `minutes` minutes. */
const wroteAgo = (minutes: number, overrides = {}) => freshContact({ lastInboundAt: addMinutes(NOW, -minutes).toISOString(), ...overrides });
const event = (name: "commande_prete" | "panier_abandonne" | "commande_validee", data: Record<string, string> = {}) =>
  ({ kind: "event", event: name, data }) as const;

describe("événements PFlow Order", () => {
  it("fenêtre de 24 h ouverte : le flux de l'événement part avec ses variables", async () => {
    const r = await runEngine(input({ flows: [prete], contact: wroteAgo(30), message: event("commande_prete", { client_nom: "Léa", commande_numero: "1042" }) }));
    expect(r.outgoing).toEqual([{ kind: "text", text: "✅ Bonne nouvelle Léa ! Votre commande #1042 est prête." }]);
    expect(r.events).toContainEqual({ type: "flow_started", flowId: "f_prete", via: "evenement" });
  });

  it("fenêtre fermée (plus de 24 h) : rien n'est envoyé", async () => {
    const r = await runEngine(input({ flows: [prete], contact: wroteAgo(24 * 60 + 1), message: event("commande_prete") }));
    expect(r.outgoing).toEqual([]);
    expect(r.events).toEqual([{ type: "ignored", reason: "fenetre_fermee" }]);
  });

  it("client qui n'a jamais écrit au bot (arrivé directement sur le mini-site) : rien n'est envoyé", async () => {
    const r = await runEngine(input({ flows: [prete], contact: freshContact(), message: event("commande_prete") }));
    expect(r.outgoing).toEqual([]);
    expect(r.events).toEqual([{ type: "ignored", reason: "fenetre_fermee" }]);
  });

  it("un événement ne compte pas comme un message du client (la fenêtre ne s'allonge pas)", async () => {
    const contact = wroteAgo(60);
    const r = await runEngine(input({ flows: [prete], contact, message: event("commande_prete") }));
    expect(r.contact.lastInboundAt).toBe(contact.lastInboundAt);
  });

  it("envoyé même si le contact est en pause, sans lever la pause", async () => {
    const pause = { reason: "transfert_humain" as const, until: addMinutes(NOW, 600).toISOString() };
    const r = await runEngine(input({ flows: [prete], contact: wroteAgo(30, { pause }), message: event("commande_prete", { client_nom: "Léa", commande_numero: "7" }) }));
    expect(r.outgoing).toHaveLength(1);
    expect(r.contact.pause).toEqual(pause);
    // Le message suivant du client est toujours ignoré : le bot n'est pas relancé.
    const r2 = await runEngine(input({ flows: [prete], contact: r.contact, session: r.session, message: { kind: "text", text: "merci" } }));
    expect(r2.outgoing).toEqual([]);
  });

  it("sans relancer le bot : une conversation en cours reprend ensuite telle quelle", async () => {
    const r1 = await runEngine(input({ message: { kind: "text", text: "réserver" } })); // attend « combien de personnes »
    const r2 = await runEngine(input({ flows: [...input().flows, prete], contact: r1.contact, session: r1.session, message: event("commande_prete") }));
    expect(r2.session).toEqual(r1.session);
    const r3 = await runEngine(input({ contact: r2.contact, session: r2.session, message: { kind: "text", text: "4" } }));
    expect(r3.outgoing.map((m) => (m.kind === "text" ? m.text : m.kind))).toEqual(["Votre numéro ?"]);
  });

  it("aucun flux pour cet événement : ignoré", async () => {
    const r = await runEngine(input({ flows: [prete], contact: wroteAgo(5), message: event("commande_validee") }));
    expect(r.events).toEqual([{ type: "ignored", reason: "aucun_flux_evenement" }]);
  });

  it("panier abandonné : sans lien de panier fourni, le lien de commande est utilisé", async () => {
    const r = await runEngine(input({ flows: [panier], contact: wroteAgo(20), message: event("panier_abandonne", { panier_total: "8 €" }) }));
    expect(r.outgoing[0]).toEqual({ kind: "link", text: "🛒 Votre panier vous attend : 8 €", url: "https://order.pflow.fr/c/mexico", buttonLabel: "🛒 Reprendre" });
    const r2 = await runEngine(input({ flows: [panier], contact: wroteAgo(20), message: event("panier_abandonne", exampleEventData("panier_abandonne")) }));
    expect(r2.outgoing[0]).toMatchObject({ url: "https://order.pflow.fr/c/exemple?panier=abc" });
  });

  it("un flux d'événement ne se lance jamais sur un message, même par mot-clé ou par défaut", async () => {
    const tricky: Flow = { ...prete, nodes: [node("t", "trigger", { keywords: ["prête"], isDefault: true, event: "commande_prete" }), prete.nodes[1]] };
    const r = await runEngine(input({ flows: [tricky], channel: { ...channel, triggerMode: "toujours" }, message: { kind: "text", text: "elle est prête ?" } }));
    expect(r.events.some((e) => e.type === "flow_started")).toBe(false);
  });
});
