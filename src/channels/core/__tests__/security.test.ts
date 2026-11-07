import { describe, expect, it } from "vitest";
import { tooManyRequests } from "@/lib/request-limit";
import { createMemoryChannelStore } from "../memory-store";
import { maskId } from "../privacy";
import { rateLimit } from "../rate-limit";
import { cronAuthorized } from "@/lib/cron-auth";
import { eventsCutoff, purgeEnabled, retentionCutoff, runRetention } from "../retention";
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

  it("suppression automatique : conversations après 12 mois, journal technique après 30 jours", async () => {
    let clock = new Date("2026-12-01T00:00:00Z");
    const store = createMemoryChannelStore([canal], { now: () => clock });
    const contact = await store.getOrCreateContact("c1", "590690000001");
    await store.claimEvent("whatsapp", "vieux", {});
    await store.addMessage({ canalId: "c1", contactId: contact.id, sens: "entrant", type: "text", contenu: { texte: "vieux" }, statut: "recu" });
    await store.addTransfert({ canalId: "c1", contactId: contact.id, source: "bloc", gerantPrevenu: false });
    clock = new Date("2027-11-15T00:00:00Z");
    await store.claimEvent("whatsapp", "recent", {});
    await store.addMessage({ canalId: "c1", contactId: contact.id, sens: "entrant", type: "text", contenu: { texte: "récent" }, statut: "recu" });

    const now = new Date("2028-01-01T00:00:00Z");
    expect(retentionCutoff(now).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(eventsCutoff(now).toISOString()).toBe("2027-12-02T00:00:00.000Z");
    // Interrupteur d'urgence : rien n'est supprimé.
    expect((await runRetention(store, now, false)).supprimes).toEqual({ messages: 0, transferts: 0, sessions: 0, appelsIa: 0, evenements: 0 });
    expect(await store.listMessages(contact.id)).toHaveLength(2);

    const report = await runRetention(store, now, true);
    expect(report.supprimes).toMatchObject({ messages: 1, transferts: 1, evenements: 2 });
    const restants = await store.listMessages(contact.id);
    expect(restants.map((m) => m.contenu)).toEqual([{ texte: "récent" }]);
    expect(await store.getContact(contact.id)).not.toBeNull(); // la fiche (et un éventuel STOP) est gardée
  });

  it("suppression automatique : active par défaut, suspendue par PURGE_ACTIVE=non", () => {
    const before = process.env.PURGE_ACTIVE;
    delete process.env.PURGE_ACTIVE;
    expect(purgeEnabled()).toBe(true);
    process.env.PURGE_ACTIVE = "non";
    expect(purgeEnabled()).toBe(false);
    if (before === undefined) delete process.env.PURGE_ACTIVE;
    else process.env.PURGE_ACTIVE = before;
  });

  it("tâche planifiée : seul l'appel de Vercel avec CRON_SECRET passe", () => {
    expect(cronAuthorized("Bearer secret-long", undefined)).toBe("not_configured");
    expect(cronAuthorized("Bearer secret-long", "  ")).toBe("not_configured");
    expect(cronAuthorized(null, "secret-long")).toBe("deny");
    expect(cronAuthorized("Bearer autre", "secret-long")).toBe("deny");
    expect(cronAuthorized("Bearer secret-long", "secret-long")).toBe("allow");
  });
});
