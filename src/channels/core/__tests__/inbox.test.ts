import { describe, expect, it } from "vitest";
import { applyInboxAction, listInbox, messageText } from "../inbox";
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
  it("liste les conversations par resto, transferts en premier", async () => {
    const { store, contactId } = await setup();
    await store.addTransfert({ canalId: "c1", contactId, source: "ia", dernierMessage: "?" });
    const other = await store.getOrCreateContact("c1", "590690000002", "Max");
    await store.addMessage({ canalId: "c1", contactId: other.id, sens: "entrant", type: "text", contenu: { texte: "salut" } });
    const [inbox] = await listInbox(store, workspace, NOW);
    expect(inbox.nomResto).toBe("Cookies An Nou");
    expect(inbox.conversations.map((c) => [c.nom, c.transfertOuvert])).toEqual([["Léa", true], ["Max", false]]);
    expect(inbox.conversations[0]).toMatchObject({ fenetreOuverte: true, dernierMessage: { texte: "je veux parler à quelqu'un" } });
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
    expect((await store.getContact(contactId))?.state.pause).toEqual({ reason: "manuel", until: "2026-11-06T03:00:00.000Z" });

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
