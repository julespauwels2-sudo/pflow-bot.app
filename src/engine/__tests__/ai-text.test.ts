import { describe, expect, it } from "vitest";
import { cleanAiText, stripGreeting, stripLinks } from "../ai-text";

describe("garde-fou : liens dans le texte de l'IA", () => {
  it("retire les liens et ce qui les annonçait", () => {
    expect(stripLinks("Commandez ici 👉 https://order.pflow.fr/c/cookies-an-nou")).toEqual({
      text: "Commandez ici",
      removed: ["https://order.pflow.fr/c/cookies-an-nou"],
    });
    expect(stripLinks("Notre carte est en ligne : order.pflow.fr/c/cookies-an-nou.").text).toBe("Notre carte est en ligne.");
    expect(stripLinks("Voir [la carte](https://order.pflow.fr/c/x) 😋").text).toBe("Voir la carte 😋");
    expect(stripLinks("Suivez-nous sur www.instagram.com/cookies !").text).toBe("Suivez-nous sur !");
  });

  it("garde les lignes utiles et supprime les lignes devenues vides", () => {
    const { text } = stripLinks("🕒 *Nos horaires*\n\nMardi au vendredi, 8h – 12h.\n\n👉 https://order.pflow.fr/c/x\n\nUne petite faim ? 😋");
    expect(text).toBe("🕒 *Nos horaires*\n\nMardi au vendredi, 8h – 12h.\n\nUne petite faim ? 😋");
  });

  it("ne touche pas un texte sans lien (prix, heures, emails non concernés)", () => {
    const text = "Le *Tout choco* : 4,50 €. Livraison de 11h à 13h.";
    expect(stripLinks(text)).toEqual({ text, removed: [] });
  });
});

describe("garde-fou : pas de nouvelle salutation", () => {
  it("retire une ligne de salutation en tête", () => {
    expect(stripGreeting("Bonjour Léa ! 😊\n\n🕒 Nous livrons jeudi.")).toEqual({ text: "🕒 Nous livrons jeudi.", removed: true });
    expect(stripGreeting("Hello !\nOui, on livre à Jarry.").text).toBe("Oui, on livre à Jarry.");
  });

  it("ne touche ni une phrase qui commence par Bonjour, ni une réponse qui n'est qu'une salutation", () => {
    expect(stripGreeting("Bonjour, nous livrons jeudi.").removed).toBe(false);
    expect(stripGreeting("Bonjour !").removed).toBe(false);
  });

  it("combine les deux", () => {
    expect(cleanAiText("Bonjour !\nCommandez ici : https://x.fr/c/a")).toEqual({ text: "Commandez ici", removedLinks: ["https://x.fr/c/a"], removedGreeting: true });
  });
});
