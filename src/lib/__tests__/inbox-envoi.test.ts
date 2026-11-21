/** Réponse affichée tout de suite puis confirmée : fusion avec la conversation rechargée (sans doublon ni saut). */
import { describe, expect, it } from "vitest";
import { fusionnerConversation, majConversationListe, mentionEnvoi, nouvelEnvoi, reglerEnvoi, type MessageAffiche } from "../inbox-envoi";
import type { InboxCanal } from "@/channels/core/inbox";

const ctx = { canalId: "c1", contactId: "k1" };
const msg = (id: string, patch: Partial<MessageAffiche> = {}): MessageAffiche => ({
  id, canalId: "c1", contactId: "k1", sens: "entrant", type: "text", contenu: { texte: id }, texte: id, at: "2026-11-21T10:00:00Z", ...patch,
});

describe("envoi optimiste", () => {
  it("au clic : le message apparaît en bas, « envoi… », sous une clé provisoire", () => {
    const e = nouvelEnvoi("Bonjour", new Date("2026-11-21T10:01:00Z"));
    const lignes = fusionnerConversation([msg("m1")], [e], ctx);
    expect(lignes.map((l) => l.cle)).toEqual(["m1", e.tempId]);
    expect(lignes[1]).toMatchObject({ sens: "sortant", auteur: "humain", texte: "Bonjour", envoi: { etat: "envoi" } });
    expect(mentionEnvoi(lignes[1]!)).toBe("envoi…");
  });

  it("confirmé : « envoyé ✓ » ; un rechargement parti avant l'enregistrement ne le fait pas disparaître", () => {
    const e = nouvelEnvoi("Bonjour");
    const envois = reglerEnvoi([e], e.tempId, { ok: true, message: { id: "m2" } });
    const lignes = fusionnerConversation([msg("m1")], envois, ctx); // conversation rechargée SANS m2
    expect(lignes.map((l) => l.cle)).toEqual(["m1", e.tempId]);
    expect(mentionEnvoi(lignes[1]!)).toBe("envoyé ✓");
  });

  it("rechargement avec le message enregistré : pas de doublon, même clé (aucun saut)", () => {
    const e = nouvelEnvoi("Bonjour");
    const envois = reglerEnvoi([e], e.tempId, { ok: true, message: { id: "m2" } });
    const serveur = [msg("m1"), msg("m2", { sens: "sortant", auteur: "humain", texte: "Bonjour", statut: "envoye" }), msg("m3")];
    const lignes = fusionnerConversation(serveur, envois, ctx);
    expect(lignes.map((l) => l.cle)).toEqual(["m1", e.tempId, "m3"]);
    expect(lignes.filter((l) => l.texte === "Bonjour")).toHaveLength(1);
    expect(lignes[1]!.id).toBe("m2");
    expect(mentionEnvoi(lignes[1]!)).toBe("envoyé ✓");
  });

  it("échec : « Réessayer » reste proposé, même quand le serveur renvoie la tentative en échec (pas de doublon)", () => {
    const e = nouvelEnvoi("Bonjour");
    const envois = reglerEnvoi([e], e.tempId, { ok: false, erreur: "Fenêtre fermée", message: { id: "m9" } });
    const avant = fusionnerConversation([msg("m1")], envois, ctx);
    expect(avant[1]).toMatchObject({ statut: "echec", erreur: "Fenêtre fermée", envoi: { etat: "echec" } });
    const apres = fusionnerConversation([msg("m1"), msg("m9", { sens: "sortant", auteur: "humain", statut: "echec", erreur: "Fenêtre fermée" })], envois, ctx);
    expect(apres).toHaveLength(2);
    expect(apres[1]).toMatchObject({ cle: e.tempId, id: "m9", envoi: { etat: "echec", tempId: e.tempId } });
    expect(mentionEnvoi(apres[1]!)).toBeNull();
  });

  it("plusieurs envois : l'ordre du clic est gardé, chacun réglé séparément", () => {
    const a = nouvelEnvoi("un");
    const b = nouvelEnvoi("deux");
    expect(a.tempId).not.toBe(b.tempId);
    const envois = reglerEnvoi([a, b], a.tempId, { ok: true, message: { id: "ma" } });
    const lignes = fusionnerConversation([], envois, ctx);
    expect(lignes.map((l) => [l.texte, l.envoi?.etat])).toEqual([["un", "envoye"], ["deux", "envoi"]]);
  });

  it("la liste montre tout de suite le dernier message et la pause, sans toucher aux autres conversations", () => {
    const conv = (contactId: string) => ({ contactId, waId: "1", pause: null, fenetreOuverte: true, transfertOuvert: false, updatedAt: "2026-11-21T09:00:00Z" });
    const canaux = [{ canalId: "c1", restaurantId: "r", plateforme: "whatsapp", nomResto: "R", etat: "actif", conversations: [conv("k1"), conv("k2")] }] as InboxCanal[];
    const out = majConversationListe(canaux, "k1", { pause: { reason: "manuel", until: "2026-11-21T22:00:00Z" }, dernierMessage: { texte: "Bonjour", sens: "sortant", at: "2026-11-21T10:00:00Z" } });
    expect(out[0]!.conversations[0]).toMatchObject({ pause: { reason: "manuel" }, dernierMessage: { texte: "Bonjour" }, updatedAt: "2026-11-21T10:00:00Z" });
    expect(out[0]!.conversations[1]).toBe(canaux[0]!.conversations[1]);
  });
});
