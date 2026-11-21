import { describe, expect, it } from "vitest";
import { applyInboxAction, InboxSendError, listInbox, mapLimit, messageText } from "../inbox";
import { createMemoryChannelStore } from "../memory-store";
import type { Canal } from "../types";

const NOW = new Date("2026-11-05T15:00:00Z");
const canal: Canal = {
  id: "c1", restaurantId: "r1", plateforme: "whatsapp", accountId: "111", wabaId: "w", triggerMode: "toujours", coexistence: false,
  echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [],
};
const workspace = { clients: [{ id: "r1", nomResto: "Cookies An Nou" }] } as never;

async function setup(lastInboundAt = "2026-11-05T14:00:00Z") {
  const store = createMemoryChannelStore([canal], { now: () => NOW });
  const contact = await store.getOrCreateContact("c1", "590690000001", "Léa");
  await store.saveContact({ ...contact, state: { ...contact.state, lastInboundAt } });
  await store.addMessage({ canalId: "c1", contactId: contact.id, sens: "entrant", type: "text", contenu: { texte: "je veux parler à quelqu'un" } });
  const sent: { to: string; text: string }[] = [];
  const graph = { send: async (_p: string, to: string, m: { kind: string; text?: string }) => (sent.push({ to, text: m.text ?? "" }), "wamid.x") };
  return { store, contactId: contact.id, sent, graph: graph as never };
}

describe("boîte de réception", () => {
  it("liste : par dernier message, un état unique par conversation, pauses expirées ignorées, numéros de test Meta signalés", async () => {
    const { store, contactId } = await setup();
    const lea = (await store.getContact(contactId))!;
    await store.saveContact({ ...lea, state: { ...lea.state, pause: { reason: "transfert_humain", until: "2026-11-06T14:00:00Z" } } });
    await store.addTransfert({ canalId: "c1", contactId, source: "ia", dernierMessage: "?" });
    const add = async (waId: string, nom: string, at: string, extra: Record<string, unknown> = {}) => {
      const c = await store.getOrCreateContact("c1", waId, nom);
      const m = await store.addMessage({ canalId: "c1", contactId: c.id, sens: "entrant", type: "text", contenu: { texte: "salut" }, at, ...extra });
      return { c, m };
    };
    const max = await add("590690000002", "Max", "2026-11-05T14:50:00Z");
    await store.noteMessage(max.m.id, "ignore:aucun_declencheur");
    const ana = await add("590690000003", "Ana", "2026-11-05T14:55:00Z");
    // Pause « l'équipe a répondu » terminée depuis 1 h : le bot répond de nouveau, la conversation n'est plus en pause.
    await store.saveContact({ ...ana.c, state: { ...ana.c.state, pause: { reason: "echo_gerant", until: "2026-11-05T14:00:00Z" } } });
    const tom = await add("590690000004", "Tom", "2026-11-05T14:40:00Z");
    await store.saveContact({ ...tom.c, state: { ...tom.c.state, pause: { reason: "echo_gerant", until: "2026-11-06T02:40:00Z" } } });
    const [inbox] = await listInbox(store, workspace, NOW);
    expect(inbox.nomResto).toBe("Cookies An Nou");
    expect(inbox.testMeta).toBe(false);
    expect(inbox.conversations.map((c) => [c.nom, c.etat.code])).toEqual([
      ["Léa", "transfert"], // dernier message à 15 h (NOW)
      ["Ana", "actif"],
      ["Max", "ignore"],
      ["Tom", "equipe"],
    ]);
    expect(inbox.conversations[0]).toMatchObject({ transfertOuvert: true, fenetreOuverte: true, dernierMessage: { texte: "je veux parler à quelqu'un" } });
    expect(inbox.conversations[1]!.pause).toBeNull();
    expect(inbox.conversations[2]!.dernierMessage?.note).toBe("ignore:aucun_declencheur");

    const test = createMemoryChannelStore([{ ...canal, numeroAffiche: "+1 555 186 2679 (numéro de test Meta)" }], { now: () => NOW });
    expect((await listInbox(test, workspace, NOW))[0]!.testMeta).toBe(true);
  });

  it("reprendre la main : bot en pause sans fin ; rendre au bot : pause levée et transfert traité", async () => {
    const { store, contactId, graph } = await setup();
    await store.addTransfert({ canalId: "c1", contactId, source: "bloc" });
    await store.saveSession(contactId, { flowId: "f", nodeId: "n", vars: {}, retries: 0, startedAt: "x", expiresAt: "y" }, null);
    await applyInboxAction({ store, senders: { whatsapp: graph }, now: NOW }, contactId, { type: "reprendre" });
    expect((await store.getContact(contactId))?.state.pause).toEqual({ reason: "manuel", until: null });
    expect(await store.getSession(contactId)).toBeNull();
    await applyInboxAction({ store, senders: { whatsapp: graph }, now: NOW }, contactId, { type: "relancer" });
    expect((await store.getContact(contactId))?.state.pause).toBeNull();
    expect((await store.listTransferts("c1"))[0].resoluLe).toBeTruthy();
  });

  it("répondre : envoyé par Meta, noté « Équipe », bot en pause 12 h ; refusé si la fenêtre de 24 h est fermée", async () => {
    const { store, contactId, sent, graph } = await setup();
    await applyInboxAction({ store, senders: { whatsapp: graph }, now: NOW }, contactId, { type: "repondre", texte: "Bonjour, je regarde ça !" });
    expect(sent).toEqual([{ to: "590690000001", text: "Bonjour, je regarde ça !" }]);
    expect((await store.listMessages(contactId)).at(-1)).toMatchObject({ sens: "sortant", auteur: "humain", statut: "envoye" });
    expect((await store.getContact(contactId))?.state.pause).toEqual({ reason: "echo_gerant", until: "2026-11-06T03:00:00.000Z" });

    const closed = await setup("2026-11-03T10:00:00Z");
    await expect(applyInboxAction({ store: closed.store, senders: { whatsapp: closed.graph }, now: NOW }, closed.contactId, { type: "repondre", texte: "?" })).rejects.toThrow("Fenêtre de 24 h fermée");
    expect(closed.sent).toEqual([]);
  });

  it("affiche les messages du bot lisiblement", () => {
    expect(messageText({ type: "buttons", contenu: { kind: "buttons", text: "Choisissez", buttons: [{ id: "a", title: "Oui" }] } })).toBe("Choisissez\n[Oui]");
    expect(messageText({ type: "link", contenu: { kind: "link", text: "Go", url: "https://x", buttonLabel: "Commander" } })).toBe("Go\n[🔗 Commander]");
    expect(messageText({ type: "audio", contenu: {} })).toBe("🎤 Message vocal");
  });
});

describe("boîte de réception : rapidité de l'envoi et de la liste", () => {
  it("répondre : une seule fois, message enregistré et renvoyé, pause renvoyée ; contact et numéros fournis : pas relus", async () => {
    const { store, contactId, sent, graph } = await setup();
    const contact = (await store.getContact(contactId))!;
    const canaux = await store.listCanaux();
    let relus = 0;
    const counting = { ...store, getContact: async (id: string) => (relus++, store.getContact(id)), listCanaux: async () => (relus++, store.listCanaux()) };
    const result = await applyInboxAction({ store: counting, senders: { whatsapp: graph }, now: NOW, contact, canaux }, contactId, { type: "repondre", texte: "Bonjour" });
    expect(relus).toBe(0);
    expect(sent).toHaveLength(1);
    expect(result.message).toMatchObject({ sens: "sortant", auteur: "humain", statut: "envoye", wamid: "wamid.x" });
    expect((await store.listMessages(contactId)).at(-1)?.id).toBe(result.message!.id);
    expect(result.pause).toEqual({ reason: "echo_gerant", until: "2026-11-06T03:00:00.000Z" });
  });

  it("échec de Meta : InboxSendError avec la tentative enregistrée, bot pas mis en pause", async () => {
    const { store, contactId } = await setup();
    const failing = { send: async () => { throw new Error("Meta en panne"); } };
    const error = await applyInboxAction({ store, senders: { whatsapp: failing }, now: NOW }, contactId, { type: "repondre", texte: "Bonjour" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InboxSendError);
    expect((error as InboxSendError).stored).toMatchObject({ statut: "echec", erreur: "Meta en panne" });
    expect((await store.getContact(contactId))?.state.pause).toBeFalsy();
  });

  it("mapLimit : ordre gardé, jamais plus de N en cours", async () => {
    let enCours = 0;
    let max = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
      enCours++;
      max = Math.max(max, enCours);
      await new Promise((r) => setTimeout(r, n));
      enCours--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0, 60]);
    expect(max).toBe(3);
  });

  it("liste : beaucoup de conversations, toutes présentes et bien triées", async () => {
    const { store } = await setup();
    for (let i = 0; i < 30; i++) {
      const c = await store.getOrCreateContact("c1", `5906900001${String(i).padStart(2, "0")}`, `C${i}`);
      await store.addMessage({ canalId: "c1", contactId: c.id, sens: "entrant", type: "text", contenu: { texte: `m${i}` }, at: new Date(NOW.getTime() - i * 60_000).toISOString() });
    }
    const [inbox] = await listInbox(store, Promise.resolve(workspace), NOW);
    expect(inbox!.conversations).toHaveLength(31);
    const dates = inbox!.conversations.map((c) => c.updatedAt);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(inbox!.conversations.find((c) => c.nom === "C7")?.dernierMessage?.texte).toBe("m7");
  });
});
