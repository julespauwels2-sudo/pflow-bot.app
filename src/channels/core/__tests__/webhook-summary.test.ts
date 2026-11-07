import { describe, expect, it } from "vitest";
import { parseWebhook } from "../../whatsapp/parse";
import { META_SAMPLE_ID, summarize } from "../webhook-route";

/** Exemple envoyé par le bouton « Tester » du tableau de bord de Meta (champ messages). */
const metaSample = {
  object: "whatsapp_business_account",
  entry: [{
    id: "0",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "16505551111", phone_number_id: "123456123" },
        contacts: [{ profile: { name: "test user name" }, wa_id: "16315551181" }],
        messages: [{ from: "16315551181", id: META_SAMPLE_ID, timestamp: "1504902988", type: "text", text: { body: "this is a text message" } }],
      },
    }],
  }],
};

describe("résumé d'un appel du webhook (journaux)", () => {
  it("signale l'exemple du bouton « Tester » de Meta", () => {
    const events = parseWebhook(metaSample);
    const line = summarize(events, { handled: [], skipped: [{ reason: "numéro inconnu (aucun canal)" }], errors: [] });
    expect(line).toContain("reçu : 1 message(s), 0 statut(s)");
    expect(line).toContain("ignorés : numéro inconnu (aucun canal)");
    expect(line).toContain("bouton « Tester »");
  });

  it("ne contient ni numéro ni texte du message", () => {
    const events = parseWebhook(metaSample);
    const line = summarize(events, { handled: [{}], skipped: [], errors: ["Envoi à 16315551181 : refus"] });
    expect(line).not.toContain("16315551181");
    expect(line).not.toContain("this is a text message");
    expect(line).toContain("traités : 1");
    expect(line).toContain("erreurs : 1");
  });
});
