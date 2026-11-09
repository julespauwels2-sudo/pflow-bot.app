/** Boîte de réception sur téléphone : ordre, non lus, mise en forme WhatsApp, heure. */
import { describe, expect, it } from "vitest";
import type { InboxCanal, InboxConversation } from "@/channels/core/inbox";
import { isUnread, markSeen, plainExtract, shortTime, sortConversations, waSegments, type SeenState } from "../inbox-view";

const conv = (id: string, at: string, extra: Partial<InboxConversation> = {}): InboxConversation => ({
  contactId: id,
  waId: "590690000000",
  pause: null,
  fenetreOuverte: true,
  transfertOuvert: false,
  updatedAt: at,
  dernierMessage: { texte: "Bonjour", sens: "entrant", at },
  ...extra,
});
const canal = (conversations: InboxConversation[], id = "c"): InboxCanal => ({ canalId: id, restaurantId: "", plateforme: "whatsapp", nomResto: id, etat: "actif", conversations });

describe("boîte de réception (téléphone)", () => {
  it("celles qui attendent Jules d'abord, puis de la plus récente à la plus ancienne, tous canaux confondus", () => {
    const rows = sortConversations([
      canal([conv("a", "2026-11-09T10:00:00Z"), conv("b", "2026-11-09T12:00:00Z")], "pflow"),
      canal([conv("c", "2026-11-09T08:00:00Z", { transfertOuvert: true }), conv("d", "2026-11-09T11:00:00Z")], "resto"),
    ]);
    expect(rows.map((r) => r.conv.contactId)).toEqual(["c", "b", "d", "a"]);
  });

  it("non lu : dernier message du client, arrivé après la dernière ouverture sur cet appareil", () => {
    const state: SeenState = { initAt: "2026-11-09T09:00:00Z", seen: {} };
    expect(isUnread(conv("a", "2026-11-09T08:00:00Z"), state)).toBe(false); // avant le premier passage
    expect(isUnread(conv("a", "2026-11-09T10:00:00Z"), state)).toBe(true);
    expect(isUnread(conv("a", "2026-11-09T10:00:00Z", { dernierMessage: { texte: "ok", sens: "sortant", at: "2026-11-09T10:00:00Z" } }), state)).toBe(false);
    const after = markSeen(state, "a", "2026-11-09T10:00:00Z");
    expect(isUnread(conv("a", "2026-11-09T10:00:00Z"), after)).toBe(false);
    expect(isUnread(conv("a", "2026-11-09T10:05:00Z"), after)).toBe(true);
    // Jamais en arrière.
    expect(markSeen(after, "a", "2026-11-09T09:30:00Z")).toBe(after);
  });

  it("mise en forme WhatsApp dans les bulles, extrait sans les marques", () => {
    expect(waSegments("*Étape 1/3* : passez _vite_ ~pas~ ici")).toEqual([
      { text: "Étape 1/3", style: "bold" },
      { text: " : passez " },
      { text: "vite", style: "italic" },
      { text: " " },
      { text: "pas", style: "strike" },
      { text: " ici" },
    ]);
    expect(waSegments("2 * 3 = 6, prix * total")).toEqual([{ text: "2 * 3 = 6, prix * total" }]);
    expect(plainExtract("*Étape 1/3* :\npassez commande")).toBe("Étape 1/3 : passez commande");
  });

  it("heure façon WhatsApp", () => {
    const now = new Date(2026, 10, 9, 15, 0);
    expect(shortTime(new Date(2026, 10, 9, 14, 5).toISOString(), now)).toBe("14:05");
    expect(shortTime(new Date(2026, 10, 8, 20, 0).toISOString(), now)).toBe("Hier");
    expect(shortTime(new Date(2026, 10, 2, 9, 0).toISOString(), now)).toBe("02/11");
  });
});

describe("boîte de réception : messages du bot avec boutons", () => {
  it("boutons, lien et liste reconnus dans le contenu enregistré ; texte simple sinon", async () => {
    const { interactiveContent } = await import("@/components/message-content");
    expect(interactiveContent({ kind: "buttons", text: "Bienvenue", buttons: [{ id: "demo", title: "Tester la démo" }] })).toMatchObject({ kind: "buttons" });
    expect(interactiveContent({ kind: "link", text: "Étape 1/3", url: "https://order.pflow.fr/demo/commande?r=pflow", buttonLabel: "Je commande" })).toMatchObject({ kind: "link", buttonLabel: "Je commande" });
    expect(interactiveContent({ kind: "list", text: "Choisissez", buttonLabel: "Voir", items: [] })).toMatchObject({ kind: "list" });
    expect(interactiveContent({ kind: "text", text: "Bonjour" })).toBeNull();
    expect(interactiveContent({ texte: "Tester la démo", reponse: "demo" })).toBeNull(); // réponse du client à un bouton : sa bulle
    expect(interactiveContent(null)).toBeNull();
  });
});
