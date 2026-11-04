import { describe, expect, it } from "vitest";
import { tooManyRequests } from "@/lib/request-limit";
import { createMemoryChannelStore } from "../memory-store";
import { maskId } from "../privacy";
import { rateLimit } from "../rate-limit";
import { retentionCutoff, runRetention } from "../retention";
import type { Canal } from "../types";

const canal: Canal = {
  id: "c1", restaurantId: "r1", plateforme: "whatsapp", accountId: "100", triggerMode: "toujours", coexistence: false,
  echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [],
};

describe("sécurité", () => {
  it("limite de débit : au-delà du maximum, refus jusqu'à la fin de la fenêtre", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("test:a", 3, 60_000, t + i)).toBe(true);
    expect(rateLimit("test:a", 3, 60_000, t + 10)).toBe(false);
    expect(rateLimit("test:b", 3, 60_000, t + 10)).toBe(true);
    expect(rateLimit("test:a", 3, 60_000, t + 61_000)).toBe(true);
  });

  it("routes de l'interface : 429 au-delà de la limite, par compte", () => {
    const req = new Request("http://x/api/ai");
    for (let i = 0; i < 2; i++) expect(tooManyRequests("t-ai", req, "user-1", 2)).toBeNull();
    expect(tooManyRequests("t-ai", req, "user-1", 2)?.status).toBe(429);
    expect(tooManyRequests("t-ai", req, "user-2", 2)).toBeNull();
  });

  it("journaux : numéros et identifiants masqués", () => {
    expect(maskId("Envoi à 590690123456 : échec")).toBe("Envoi à 5906•••56 : échec");
    expect(maskId("+33612345678")).toBe("+336•••78");
  });

  it("purge des messages après 12 mois : préparée, ne supprime rien tant qu'elle n'est pas activée", async () => {
    const store = createMemoryChannelStore([canal]);
    const contact = await store.getOrCreateContact("c1", "590690000001");
    await store.addMessage({ canalId: "c1", contactId: contact.id, sens: "entrant", type: "text", contenu: { texte: "vieux" }, statut: "recu" });
    const now = new Date("2028-01-01T00:00:00Z");
    expect(retentionCutoff(now).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(await runRetention(store, now, false)).toEqual({ active: false, cutoff: "2027-01-01T00:00:00.000Z", messagesSupprimes: 0 });
    expect(await store.listMessages(contact.id)).toHaveLength(1);
    expect((await runRetention(store, now, true)).messagesSupprimes).toBe(1);
    expect(await store.listMessages(contact.id)).toHaveLength(0);
  });
});
