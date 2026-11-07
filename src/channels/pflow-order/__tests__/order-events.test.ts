import { describe, expect, it } from "vitest";
import type { Flow, OutgoingMessage } from "@/engine";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import { toEngineFlow } from "@/data/types";
import { createMemoryChannelStore } from "../../core/memory-store";
import type { Canal, ChannelSender } from "../../core/types";
import { handleOrderEvent, orderPayloadSchema, signOrderPayload, verifyOrderSignature, type OrderPayload } from "../order-events";

const NOW = new Date("2026-11-07T15:00:00Z");
const RESTO = "f610eae4-84f4-4a81-bccf-9963a65e0bf7";
const TEL = "590690938108";

function canal(etat: Canal["etat"], over: Partial<Canal> = {}): Canal {
  return {
    id: `c-${etat}`, restaurantId: RESTO, role: "resto", plateforme: "whatsapp", accountId: "1482722121584900", wabaId: "1440", messagingAccountId: "1511",
    triggerMode: "toujours", coexistence: false, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat, testNumeros: [TEL], ...over,
  };
}

async function setup(c: Canal, lastInboundMinutesAgo: number | null = 10) {
  const repos = createLocalRepositories(createMemoryStore());
  const template = await createMasterTemplate(repos);
  const flows = (await repos.flows.listByOwner(template.id)).map(toEngineFlow).filter((f): f is Flow => f !== null);
  const store = createMemoryChannelStore([c]);
  if (lastInboundMinutesAgo !== null) {
    const contact = await store.getOrCreateContact(c.id, TEL, "Léa");
    await store.saveContact({ ...contact, state: { ...contact.state, lastInboundAt: new Date(NOW.getTime() - lastInboundMinutesAgo * 60_000).toISOString() } });
  }
  const sent: { to: string; message: OutgoingMessage; options?: unknown }[] = [];
  const graph: ChannelSender = {
    async send(_account, to, message, options) {
      sent.push({ to, message, options });
      return `wamid.${sent.length}`;
    },
    async markRead() {},
  };
  const deps = {
    store,
    graph,
    now: () => NOW,
    loadBot: async (id: string) => (id === RESTO ? { client: { id, nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe" }, flows, infoSheet: { horaires: [] }, aiDailyLimit: 20 } : null),
  };
  return { store, sent, deps };
}

const commande = (over: Partial<Extract<OrderPayload, { type: "commande" }>> = {}): OrderPayload => ({
  type: "commande",
  restaurant_id: RESTO,
  client_tel: TEL,
  commande_id: "cmd-42",
  evenements: [{ pflow_order: "commande", pflow_bots: "commande_validee" }],
  variables: { client_nom: "Léa", commande_numero: "42", commande_mode: "retrait", commande_recap: "2 x Tout choco", commande_total: "8 €", paiement_mode: "sur_place", commande_statut: "recue" },
  ...over,
});

const texts = (sent: { message: OutgoingMessage }[]) => sent.map((s) => ("text" in s.message ? s.message.text : ""));

describe("PFlow Order → PFlow Bots : garde-fou du canal", () => {
  it("canal en TEST : une vraie commande n'est JAMAIS prise (UChat), rien n'est envoyé", async () => {
    const { sent, deps } = await setup(canal("test"));
    expect(await handleOrderEvent(commande(), deps)).toEqual({ pris: false, raison: "canal en test : la vraie commande reste à UChat" });
    expect(await handleOrderEvent({ type: "option", option: "relance", restaurant_id: RESTO, client_tel: TEL, panier: { recap: "x" } }, deps)).toMatchObject({ pris: false });
    expect(sent).toEqual([]);
  });

  it("canal coupé, aucun canal, canal Instagram seul : pas pris", async () => {
    expect(await handleOrderEvent(commande(), (await setup(canal("coupe"))).deps)).toEqual({ pris: false, raison: "canal coupé" });
    expect(await handleOrderEvent(commande({ restaurant_id: "00000000-0000-0000-0000-000000000000" }), (await setup(canal("actif"))).deps)).toEqual({ pris: false, raison: "aucun canal PFlow Bots" });
    expect(await handleOrderEvent(commande(), (await setup(canal("actif", { plateforme: "instagram" }))).deps)).toMatchObject({ pris: false });
  });

  it("SIMULATION (page État) sur un canal en test : seulement vers un numéro de la liste de test", async () => {
    const { sent, deps } = await setup(canal("test"));
    const r = await handleOrderEvent(commande({ simulation: true }), deps);
    expect(r).toEqual({ pris: true, envois: { commande: { etat: "ok", detail: "flux « Commande - Paiement validé » (simulation)" } } });
    expect(texts(sent)[0]).toContain("Commande enregistrée");
    expect(await handleOrderEvent(commande({ simulation: true, client_tel: "590690000000" }), deps)).toEqual({ pris: false, raison: "simulation : numéro hors liste de test" });
  });
});

describe("PFlow Order → PFlow Bots : canal actif", () => {
  it("commande + paiement : un seul message (Paiement validé), compte de messagerie indiqué, variables remplies", async () => {
    const { sent, deps } = await setup(canal("actif"));
    const r = await handleOrderEvent(
      commande({
        evenements: [{ pflow_order: "commande" }, { pflow_order: "paiement" }],
        variables: { client_nom: "Léa", commande_numero: "42", commande_mode: "livraison", commande_recap: "2 x Tout choco", commande_total: "8 €", paiement_mode: "en_ligne", commande_statut: "recue" },
      }),
      deps,
    );
    expect(r).toMatchObject({ pris: true, envois: { commande: { etat: "ok" }, paiement: { etat: "ok" } } });
    expect(sent).toHaveLength(1);
    expect(texts(sent)[0]).toContain("Paiement validé");
    expect(texts(sent)[0]).toContain("Commande #42");
    expect(sent[0].options).toEqual({ messagingAccountId: "1511" });
  });

  it("idempotence : le même événement de la même commande n'est envoyé qu'une fois", async () => {
    const { sent, deps } = await setup(canal("actif"));
    await handleOrderEvent(commande(), deps);
    expect(await handleOrderEvent(commande(), deps)).toEqual({ pris: true, envois: { commande: { etat: "ok", detail: "déjà envoyé" } } });
    expect(sent).toHaveLength(1);
  });

  it("client qui n'a jamais écrit, ou fenêtre de 24 h fermée : pris, ignoré, rien envoyé", async () => {
    const jamais = await setup(canal("actif"), null);
    expect(await handleOrderEvent(commande(), jamais.deps)).toEqual({ pris: true, envois: { commande: { etat: "ignore", detail: "le client n'a jamais écrit au bot (fenêtre de 24 h fermée)" } } });
    expect(await jamais.store.listContacts("c-actif")).toEqual([]);
    const ferme = await setup(canal("actif"), 25 * 60);
    expect(await handleOrderEvent(commande(), ferme.deps)).toEqual({ pris: true, envois: { commande: { etat: "ignore", detail: "fenêtre de 24 h fermée" } } });
    expect(jamais.sent.length + ferme.sent.length).toBe(0);
  });

  it("prête (livraison), relance de panier ; événement inconnu : ignoré, expliqué", async () => {
    const { sent, deps } = await setup(canal("actif"));
    await handleOrderEvent(commande({ commande_id: "c2", evenements: [{ pflow_order: "prete" }], variables: { client_nom: "Léa", commande_numero: "43", commande_mode: "livraison" } }), deps);
    expect(texts(sent)[0]).toContain("part en livraison");
    const relance = await handleOrderEvent({ type: "option", option: "relance", restaurant_id: RESTO, client_tel: TEL, client_nom: "Léa", panier: { recap: "2 x Tout choco", total: "8 €", lien: "https://order.pflow.fr/c/cookies-an-nou?reprise=abc&via=wa" } }, deps);
    expect(relance).toMatchObject({ pris: true, envois: { relance: { etat: "ok" } } });
    expect(sent.some((s) => s.message.kind === "link" && s.message.url === "https://order.pflow.fr/c/cookies-an-nou?reprise=abc&via=wa")).toBe(true);
    expect(await handleOrderEvent(commande({ commande_id: "c3", evenements: [{ pflow_order: "inconnu" }] }), deps)).toEqual({
      pris: true,
      envois: { inconnu: { etat: "ignore", detail: "événement « inconnu » pas encore géré par PFlow Bots" } },
    });
  });

  it("annulée (remboursée intégralement / sans paiement), remboursée, annulation refusée, rappel", async () => {
    const { sent, deps } = await setup(canal("actif"));
    const send = async (id: string, evt: string, variables: Record<string, string>) => {
      const from = sent.length;
      const r = await handleOrderEvent(commande({ commande_id: id, evenements: [{ pflow_order: evt }], variables: { client_nom: "Léa", commande_numero: "42", ...variables } }), deps);
      expect(r).toMatchObject({ pris: true, envois: { [evt]: { etat: "ok" } } });
      return texts(sent.slice(from)).join("\n");
    };
    expect(await send("a1", "annulee", { remboursement: "total", montant_rembourse: "8 €" })).toContain("remboursée intégralement* (8 €)");
    expect(await send("a2", "annulee", { remboursement: "partiel", montant_rembourse: "3 €" })).toContain("Un remboursement de 3 €");
    const simple = await send("a3", "annulee", { remboursement: "" });
    expect(simple).toContain("a été annulée.");
    expect(simple).not.toContain("rembours");
    expect(await send("a4", "remboursee", { remboursement: "partiel", montant_rembourse: "3 €" })).toContain("a été remboursée (3 €)");
    expect(await send("a5", "annulation_refusee", {})).toContain("Annulation impossible");
    expect(await send("a6", "rappel", {})).toContain("vous attend");
  });

  it("événements envoyés même si le bot est en pause (transfert humain), jamais fenêtre fermée", async () => {
    const { store, sent, deps } = await setup(canal("actif"));
    const contact = (await store.listContacts("c-actif"))[0];
    await store.saveContact({ ...contact, state: { ...contact.state, pause: { reason: "transfert_humain", until: null } } });
    expect(await handleOrderEvent(commande({ commande_id: "p1", evenements: [{ pflow_order: "annulee" }], variables: { commande_numero: "42" } }), deps)).toMatchObject({ pris: true, envois: { annulee: { etat: "ok" } } });
    expect(sent).toHaveLength(1);
    expect((await store.getContact(contact.id))?.state.pause).toEqual({ reason: "transfert_humain", until: null });
  });
});

describe("signature et corps", () => {
  it("signature HMAC + horodatage de moins de 5 min, identique au patch 01 de PFlow Order", () => {
    const body = JSON.stringify(commande());
    const ts = "1794063600";
    const sig = signOrderPayload(body, "secret", ts);
    expect(verifyOrderSignature(body, ts, sig, "secret", 1794063600 + 60)).toBe(true);
    expect(verifyOrderSignature(body, ts, sig, "autre", 1794063600)).toBe(false);
    expect(verifyOrderSignature(body + " ", ts, sig, "secret", 1794063600)).toBe(false);
    expect(verifyOrderSignature(body, ts, sig, "secret", 1794063600 + 301)).toBe(false);
    expect(verifyOrderSignature(body, null, sig, "secret")).toBe(false);
  });

  it("corps validé : uuid du resto, numéro en chiffres, au moins un événement", () => {
    expect(orderPayloadSchema.safeParse(commande()).success).toBe(true);
    expect(orderPayloadSchema.safeParse({ ...commande(), restaurant_id: "x" }).success).toBe(false);
    expect(orderPayloadSchema.safeParse({ ...commande(), client_tel: "+590 690" }).success).toBe(false);
    expect(orderPayloadSchema.safeParse({ ...commande(), evenements: [] }).success).toBe(false);
  });
});
