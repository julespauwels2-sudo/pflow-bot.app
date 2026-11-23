import { describe, expect, it, vi } from "vitest";
import type { OutgoingMessage } from "@/engine";
import { createMemoryChannelStore } from "../../core/memory-store";
import type { Canal, ChannelSender, TemplateMessage } from "../../core/types";
import { createGraphClient, GraphError, toTemplatePayload } from "../../whatsapp/graph";
import { handleLivraisonEvent, livraisonPayloadSchema, type LivraisonPayload } from "../livraison-events";
import { signOrderPayload } from "../order-events";

const NOW = new Date("2026-11-30T12:00:00Z");
const RESTO = "f610eae4-84f4-4a81-bccf-9963a65e0bf7";
const TEL = "590690938108";
const JETON = "0b6f2c1e-1111-4222-8333-444455556666";

function canal(etat: Canal["etat"], over: Partial<Canal> = {}): Canal {
  return {
    id: `c-${etat}`, restaurantId: RESTO, role: "resto", plateforme: "whatsapp", accountId: "1482722121584900", wabaId: "1440", messagingAccountId: "1511",
    triggerMode: "toujours", coexistence: false, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat, testNumeros: [TEL], ...over,
  };
}

type Envoi = { account: string; to: string; message?: OutgoingMessage; template?: TemplateMessage; options?: unknown };

async function setup(canaux: Canal[], lastInboundMinutesAgo: number | null = null, fail: { libre?: GraphError; modele?: GraphError } = {}) {
  const store = createMemoryChannelStore(canaux, { now: () => NOW });
  const c = canaux[0];
  if (c && lastInboundMinutesAgo !== null) {
    const contact = await store.getOrCreateContact(c.id, TEL, "Léa");
    await store.saveContact({ ...contact, state: { ...contact.state, lastInboundAt: new Date(NOW.getTime() - lastInboundMinutesAgo * 60_000).toISOString() } });
  }
  const sent: Envoi[] = [];
  const graph: ChannelSender = {
    async send(account, to, message, options) {
      if (fail.libre) throw fail.libre;
      sent.push({ account, to, message, options });
      return `wamid.${sent.length}`;
    },
    async sendTemplate(account, to, template, options) {
      if (fail.modele) throw fail.modele;
      sent.push({ account, to, template, options });
      return `wamid.${sent.length}`;
    },
    async markRead() {},
  };
  return { store, sent, deps: { store, graph, now: () => NOW } };
}

const corps = (over: Partial<LivraisonPayload> = {}): LivraisonPayload =>
  livraisonPayloadSchema.parse({
    type: "livraison",
    version: 1,
    idempotence: "pflow-livraison-notif-4821",
    notification_id: 4821,
    evenement: "livreur_arrive",
    restaurant_id: RESTO,
    slug: "bokit-an-nou",
    commande_id: "3f0e0000-0000-4000-8000-000000000000",
    commande_numero: "1042",
    canal_commande: "web",
    delivery_id: "7d2a0000-0000-4000-8000-000000000000",
    client_tel: TEL,
    texte: "Chez Bokit An Nou, le livreur de votre commande n° 1042 est arrivé à votre adresse. Les informations de remise sont affichées sur la page de suivi, accessible avec le bouton ci-dessous.",
    bouton: { texte: "Suivre ma livraison", url: `https://order.pflow.fr/suivi/${JETON}` },
    modele: { nom: "pflow_livraison_livreur_arrive_v2", langue: "fr", variables: ["Bokit An Nou", "1042"], bouton_url_suffixe: JETON },
    contient_code: false,
    ...over,
  });

describe("PFlow Order → PFlow Bots : messages de suivi de livraison", () => {
  it("fenêtre de 24 h OUVERTE : message libre avec le bouton « Suivre ma livraison », depuis le numéro du resto", async () => {
    const { sent, store, deps } = await setup([canal("actif")], 30);
    const r = await handleLivraisonEvent(corps(), deps);
    expect(r).toEqual({ pris: true, etat: "envoye", via: "libre", message_id: "wamid.1" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ account: "1482722121584900", to: TEL, options: { messagingAccountId: "1511" } });
    expect(sent[0].message).toEqual({ kind: "link", text: corps().texte, url: `https://order.pflow.fr/suivi/${JETON}`, buttonLabel: "Suivre ma livraison" });
    // Gardé dans l'historique de la conversation du resto, comme un message du bot.
    const contact = (await store.listContacts("c-actif"))[0];
    const [msg] = await store.listMessages(contact.id);
    expect(msg).toMatchObject({ sens: "sortant", auteur: "bot", wamid: "wamid.1", type: "link", statut: "envoye" });
  });

  it("fenêtre FERMÉE (commande sur le mini-site) : le modèle, nom logique du CRM traduit vers sa version _v2", async () => {
    const { sent, store, deps } = await setup([canal("actif")], null);
    const r = await handleLivraisonEvent(corps({ modele: { nom: "pflow_livraison_livreur_arrive", langue: "fr", variables: ["Bokit An Nou", "1042"], bouton_url_suffixe: JETON } }), deps);
    expect(r).toEqual({ pris: true, etat: "envoye", via: "modele", message_id: "wamid.1" });
    expect(sent[0].template).toEqual({ name: "pflow_livraison_livreur_arrive_v2", language: "fr", variables: ["Bokit An Nou", "1042"], urlSuffix: JETON });
    // Le client est ajouté aux conversations du resto (pour qu'une réponse de sa part soit traitée), message en historique.
    const contact = (await store.listContacts("c-actif"))[0];
    expect(contact.waId).toBe(TEL);
    expect((await store.listMessages(contact.id))[0]).toMatchObject({ type: "template", contenu: { kind: "link", modele: "pflow_livraison_livreur_arrive_v2" } });
  });

  it("fenêtre ouverte depuis plus de 24 h : le modèle", async () => {
    const { sent, deps } = await setup([canal("actif")], 25 * 60);
    expect(await handleLivraisonEvent(corps(), deps)).toMatchObject({ pris: true, via: "modele" });
    expect(sent[0].template?.name).toBe("pflow_livraison_livreur_arrive_v2");
  });

  it("« Noter ma livraison » (qg110) : bouton du message libre et modèle pflow_livraison_noter", async () => {
    const noter = {
      evenement: "livree_noter",
      texte: "Chez Bokit An Nou, votre commande n° 1042 a bien été livrée. Bon appétit ! Comment s'est passée la livraison ? Donnez votre note avec le bouton ci-dessous (2 minutes, facultatif).",
      bouton: { texte: "Noter ma livraison", url: `https://order.pflow.fr/suivi/${JETON}` },
      modele: { nom: "pflow_livraison_noter", langue: "fr", variables: ["Bokit An Nou", "1042"], bouton_url_suffixe: JETON },
    };
    const ouvert = await setup([canal("actif")], 5);
    await handleLivraisonEvent(corps(noter), ouvert.deps);
    expect(ouvert.sent[0].message).toMatchObject({ kind: "link", buttonLabel: "Noter ma livraison" });
    const ferme = await setup([canal("actif")], null);
    await handleLivraisonEvent(corps(noter), ferme.deps);
    expect(ferme.sent[0].template?.name).toBe("pflow_livraison_noter");
  });

  it("JAMAIS un autre numéro : canal en test, coupé, numéro PFlow, autre resto → pas_de_canal, rien envoyé", async () => {
    for (const canaux of [
      [canal("test")],
      [canal("coupe")],
      [canal("actif", { role: "pflow", restaurantId: "" })],
      [canal("actif", { restaurantId: "00000000-0000-4000-8000-000000000000" })],
      [canal("actif", { plateforme: "instagram" })],
    ]) {
      const { sent, deps } = await setup(canaux, 10);
      expect(await handleLivraisonEvent(corps(), deps)).toEqual({ pris: false, raison: "pas_de_canal" });
      expect(sent).toEqual([]);
    }
  });

  it("version inconnue : refusée sans rien envoyer", async () => {
    const { sent, deps } = await setup([canal("actif")], 10);
    expect(await handleLivraisonEvent(corps({ version: 2 }), deps)).toEqual({ pris: false, raison: "version_inconnue" });
    expect(sent).toEqual([]);
  });

  it("modèle inconnu (événement ajouté plus tard par PFlow Order) hors fenêtre : modele_absent, rien envoyé", async () => {
    const { sent, deps } = await setup([canal("actif")], null);
    expect(await handleLivraisonEvent(corps({ modele: { nom: "pflow_livraison_nouveau", variables: [] } }), deps)).toMatchObject({ pris: false, raison: "modele_absent" });
    expect(sent).toEqual([]);
  });

  it("refus de Meta : modèle pas approuvé (132001) → modele_absent ; numéro sans WhatsApp (131026) → numero_invalide ; panne → erreur_meta, sans numéro", async () => {
    const absent = await setup([canal("actif")], null, { modele: new GraphError("Meta a refusé l'envoi (404) : Template name does not exist", 404, 132001) });
    expect(await handleLivraisonEvent(corps(), absent.deps)).toMatchObject({ pris: false, raison: "modele_absent" });
    const invalide = await setup([canal("actif")], 10, { libre: new GraphError("Meta a refusé l'envoi (400) : Message undeliverable", 400, 131026) });
    expect(await handleLivraisonEvent(corps(), invalide.deps)).toMatchObject({ pris: false, raison: "numero_invalide" });
    const panne = await setup([canal("actif")], 10, { libre: new GraphError(`Meta injoignable : délai dépassé pour ${TEL}`, 0) });
    const r = await handleLivraisonEvent(corps(), panne.deps);
    expect(r).toMatchObject({ pris: false, raison: "erreur_meta" });
    expect(JSON.stringify(r)).not.toContain(TEL);
  });

  it("Meta dit que la fenêtre est fermée (131047) alors qu'on la croyait ouverte : le modèle part dans le même appel", async () => {
    const { store, deps } = await setup([canal("actif")], 10);
    const sent: Envoi[] = [];
    deps.graph = {
      async send() {
        throw new GraphError("Meta a refusé l'envoi (400) : Re-engagement message", 400, 131047);
      },
      async sendTemplate(account, to, template) {
        sent.push({ account, to, template });
        return "wamid.t";
      },
      async markRead() {},
    };
    expect(await handleLivraisonEvent(corps(), { ...deps, store })).toEqual({ pris: true, etat: "envoye", via: "modele", message_id: "wamid.t" });
    expect(sent).toHaveLength(1);
  });

  it("idempotence : un renvoi d'un message parti reçoit la même réponse, sans nouvel envoi", async () => {
    const { sent, deps } = await setup([canal("actif")], 10);
    const premier = await handleLivraisonEvent(corps(), deps);
    const renvoi = await handleLivraisonEvent(corps(), deps);
    expect(renvoi).toEqual(premier);
    expect(sent).toHaveLength(1);
    // Autre message (autre clé) : envoyé.
    await handleLivraisonEvent(corps({ idempotence: "pflow-livraison-notif-4822" }), deps);
    expect(sent).toHaveLength(2);
  });

  it("idempotence : après un échec, l'essai suivant (même clé) refait l'envoi", async () => {
    const { sent, store, deps } = await setup([canal("actif")], null, { modele: new GraphError("Meta a refusé l'envoi (404) : Template name does not exist", 404, 132001) });
    expect(await handleLivraisonEvent(corps(), deps)).toMatchObject({ pris: false, raison: "modele_absent" });
    // Le modèle est approuvé entre-temps.
    deps.graph = { ...deps.graph, sendTemplate: async (account, to, template) => (sent.push({ account, to, template }), "wamid.ok") };
    expect(await handleLivraisonEvent(corps(), { ...deps, store })).toEqual({ pris: true, etat: "envoye", via: "modele", message_id: "wamid.ok" });
    expect(sent).toHaveLength(1);
  });

  it("idempotence : un essai encore en cours (appels simultanés) → en_cours, pas de second envoi", async () => {
    const { sent, store, deps } = await setup([canal("actif")], 10);
    await store.claimEvent("pflow_order", "livraison:pflow-livraison-notif-4821", {});
    expect(await handleLivraisonEvent(corps(), deps)).toEqual({ pris: false, raison: "en_cours" });
    expect(sent).toEqual([]);
  });

  it("le journal des événements ne garde ni le texte, ni les variables, ni le numéro en clair", async () => {
    const { store, deps } = await setup([canal("actif")], 10);
    await handleLivraisonEvent(corps(), deps);
    const journal = JSON.stringify([...store.events.values()]);
    expect(journal).not.toContain("Bokit An Nou");
    expect(journal).not.toContain(TEL);
    expect(journal).not.toContain(JETON);
  });
});

describe("envoi d'un modèle par l'API Graph", () => {
  it("corps du modèle : variables du corps, puis le suffixe de l'URL du bouton (index 0)", () => {
    expect(toTemplatePayload(TEL, { name: "pflow_livraison_en_route_v2", language: "fr", variables: ["Bokit An Nou", "1042", "12h45"], urlSuffix: JETON })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: TEL,
      type: "template",
      template: {
        name: "pflow_livraison_en_route_v2",
        language: { code: "fr" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "Bokit An Nou" }, { type: "text", text: "1042" }, { type: "text", text: "12h45" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: JETON }] },
        ],
      },
    });
  });

  it("sendTemplate : compte de messagerie du canal, wamid renvoyé, code d'erreur de Meta gardé", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const ok = createGraphClient({
      token: "t", base: "https://graph.test", version: "v24.0",
      fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ messages: [{ id: "wamid.T" }] }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await ok.sendTemplate("1482", TEL, { name: "pflow_livraison_annulee", language: "fr", variables: ["A", "1"] }, { messagingAccountId: "1511" })).toBe("wamid.T");
    expect(calls[0].url).toBe("https://graph.test/v24.0/1482/messages");
    expect(calls[0].body).toMatchObject({ type: "template", messaging_account_id: "1511" });

    const ko = createGraphClient({
      token: "t", base: "https://graph.test", version: "v24.0",
      fetch: (async () => new Response(JSON.stringify({ error: { message: "Template name does not exist in the translation", code: 132001 } }), { status: 404 })) as unknown as typeof fetch,
    });
    const err = await ko.sendTemplate("1482", TEL, { name: "x", language: "fr", variables: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect(err.code).toBe(132001);
  });
});

describe("route /api/webhooks/pflow-livraison", () => {
  it("signature obligatoire (401), version inconnue en 200, corps invalide en 400", async () => {
    vi.stubEnv("PFLOW_BOTS_SECRET", "secret-de-test");
    vi.stubEnv("WHATSAPP_APP_SECRET", "a");
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "v");
    vi.stubEnv("WHATSAPP_TOKEN", "t");
    vi.stubEnv("CHANNELS_STORE", "memory");
    const { POST } = await import("@/app/api/webhooks/pflow-livraison/route");
    const appel = (body: string, signe = true, horodatage = String(Math.floor(Date.now() / 1000))) =>
      POST(new Request("https://bots.test/api/webhooks/pflow-livraison", {
        method: "POST",
        body,
        headers: { "x-pflow-horodatage": horodatage, "x-pflow-signature": signe ? signOrderPayload(body, "secret-de-test", horodatage) : "sha256=faux" },
      }));
    const body = JSON.stringify(corps());
    expect((await appel(body, false)).status).toBe(401);
    expect((await appel(body, true, String(Math.floor(Date.now() / 1000) - 600))).status).toBe(401);
    const v2 = await appel(JSON.stringify({ ...corps(), version: 2 }));
    expect(v2.status).toBe(200);
    expect(await v2.json()).toEqual({ pris: false, raison: "version_inconnue" });
    expect((await appel(JSON.stringify({ type: "livraison", version: 1 }))).status).toBe(400);
    vi.unstubAllEnvs();
  });
});
