import { describe, expect, it } from "vitest";
import { evaluateRule } from "../conditions";
import { keywordMatches, matchFlowByKeyword, normalize } from "../match";
import { decodeReplyId, encodeReplyId } from "../reply-id";
import { firstName, renderTemplate } from "../template";
import { formatOpeningHours, inRange, isOpenAt, isValidTimezone, localTime, parseHhmm } from "../time";
import { validateAnswer } from "../validators";
import { canSendFreeform } from "../window";
import { edge, infoSheet, node } from "./fixtures";
import type { Flow } from "../types";

describe("normalisation et mots-clés", () => {
  it("ignore casse, accents et ponctuation", () => {
    expect(normalize("  Réservation, SVP !! ")).toBe("reservation svp");
    expect(normalize("Ça marche à 20h ?")).toBe("ca marche a 20h");
  });

  it("mode contient : mots entiers uniquement", () => {
    expect(keywordMatches("Je voudrais commander", "commander")).toBe(true);
    expect(keywordMatches("recommander", "commander")).toBe(false);
    expect(keywordMatches("la carte du midi svp", "Carte du midi")).toBe(true);
  });

  it("mode exact", () => {
    expect(keywordMatches("Menu", "menu", "exact")).toBe(true);
    expect(keywordMatches("le menu", "menu", "exact")).toBe(false);
  });

  it("un mot-clé vide ne correspond jamais", () => {
    expect(keywordMatches("bonjour", "  ")).toBe(false);
  });

  it("le mot-clé le plus long l'emporte", () => {
    const flow = (id: string, keywords: string[]): Flow => ({
      id,
      name: id,
      nodes: [node("t", "trigger", { keywords })],
      edges: [],
    });
    const flows = [flow("carte", ["carte"]), flow("midi", ["carte du midi"])];
    expect(matchFlowByKeyword(flows, "la carte du midi ?")?.id).toBe("midi");
    expect(matchFlowByKeyword(flows, "la carte ?")?.id).toBe("carte");
  });
});

describe("variables", () => {
  it("remplace les variables connues et efface les inconnues", () => {
    expect(renderTemplate("Bonjour {{ prenom }} ! {{inconnue}}Bienvenue chez {{nom_resto}}", { prenom: "Jules", nom_resto: "Mexico" })).toBe(
      "Bonjour Jules ! Bienvenue chez Mexico",
    );
    expect(renderTemplate("Bonjour {{prenom}} !", {})).toBe("Bonjour !");
  });

  it("n'envoie pas un titre suivi d'une info vide", () => {
    const text = "🛵 *Livraison*\n{{infos_livraison}}\n\n🏪 *Points de vente*\n{{points_de_vente}}";
    expect(renderTemplate(text, { infos_livraison: "• Jarry", points_de_vente: "" })).toBe("🛵 *Livraison*\n• Jarry");
    expect(renderTemplate(text, { infos_livraison: "", points_de_vente: "• Station" })).toBe("🏪 *Points de vente*\n• Station");
    expect(renderTemplate(text, { infos_livraison: "", points_de_vente: "" })).toBe("");
    // Une ligne de variable vide disparaît sans emporter le reste du paragraphe.
    expect(renderTemplate("*Infos*\n{{a}}\n{{b}}\nÀ bientôt", { a: "", b: "B" })).toBe("*Infos*\nB\nÀ bientôt");
    // Une phrase qui contient une variable n'est jamais retirée.
    expect(renderTemplate("Merci !\n\nBonjour {{prenom}} !", {})).toBe("Merci !\n\nBonjour !");
  });

  it("prénom = premier mot du nom de profil", () => {
    expect(firstName("Jules Pauwels")).toBe("Jules");
    expect(firstName(undefined)).toBe("");
  });
});

describe("heure locale et horaires", () => {
  it("convertit dans le fuseau du client", () => {
    const t = localTime(new Date("2026-11-07T01:00:00Z"), "America/Guadeloupe");
    expect(t).toEqual({ date: "2026-11-06", weekday: 5, minutes: 21 * 60, hhmm: "21:00" });
    const m = localTime(new Date("2026-11-07T01:00:00Z"), "America/Martinique");
    expect(m.weekday).toBe(5);
  });

  it("valide un fuseau IANA", () => {
    expect(isValidTimezone("America/Guadeloupe")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });

  it("plages horaires, y compris celles qui passent minuit", () => {
    expect(parseHhmm("9:30")).toBe(570);
    expect(parseHhmm("25:00")).toBeNull();
    expect(inRange(12 * 60, "11:00", "14:00")).toBe(true);
    expect(inRange(14 * 60, "11:00", "14:00")).toBe(false);
    expect(inRange(60, "22:00", "02:00")).toBe(true);
    expect(inRange(3 * 60, "22:00", "02:00")).toBe(false);
  });

  it("ouvert maintenant d'après la fiche d'infos", () => {
    const tz = "America/Guadeloupe";
    expect(isOpenAt(infoSheet.horaires, new Date("2026-11-03T16:00:00Z"), tz)).toBe(true); // mardi 12:00
    expect(isOpenAt(infoSheet.horaires, new Date("2026-11-03T20:00:00Z"), tz)).toBe(false); // mardi 16:00
    expect(isOpenAt(infoSheet.horaires, new Date("2026-11-07T05:30:00Z"), tz)).toBe(true); // samedi 01:30 (plage du vendredi)
    expect(isOpenAt(infoSheet.horaires, new Date("2026-11-07T06:30:00Z"), tz)).toBe(false); // samedi 02:30
  });

  it("formate les horaires pour l'IA", () => {
    const text = formatOpeningHours(infoSheet.horaires);
    expect(text).toContain("lundi : fermé");
    expect(text).toContain("samedi : 11:00-14:00, 18:00-23:00");
  });

  it("règles heure et variable", () => {
    const ctx = { now: new Date("2026-11-03T16:00:00Z"), timezone: "America/Guadeloupe", vars: { nb: "4", mode: "Livraison" }, infoSheet };
    expect(evaluateRule({ kind: "heure", de: "11:00", a: "14:00" }, ctx)).toBe(true);
    expect(evaluateRule({ kind: "heure", de: "18:00", a: "23:00" }, ctx)).toBe(false);
    expect(evaluateRule({ kind: "variable", variable: "mode", operator: "egal", value: "livraison" }, ctx)).toBe(true);
    expect(evaluateRule({ kind: "variable", variable: "nb", operator: "superieur", value: "3" }, ctx)).toBe(true);
    expect(evaluateRule({ kind: "variable", variable: "nb", operator: "inferieur", value: "3" }, ctx)).toBe(false);
    expect(evaluateRule({ kind: "variable", variable: "absente", operator: "vide" }, ctx)).toBe(true);
    expect(evaluateRule({ kind: "variable", variable: "mode", operator: "existe" }, ctx)).toBe(true);
  });
});

describe("validation des réponses", () => {
  it("texte", () => {
    expect(validateAnswer("  Jules ", "texte")).toEqual({ ok: true, value: "Jules" });
    expect(validateAnswer("   ", "texte")).toEqual({ ok: false });
  });

  it("nombre", () => {
    expect(validateAnswer("4", "nombre")).toEqual({ ok: true, value: "4" });
    expect(validateAnswer("2,5", "nombre")).toEqual({ ok: true, value: "2.5" });
    expect(validateAnswer("quatre", "nombre")).toEqual({ ok: false });
  });

  it("téléphone (Antilles et international)", () => {
    expect(validateAnswer("0690 12 34 56", "telephone")).toEqual({ ok: true, value: "0690123456" });
    expect(validateAnswer("+590 690 12 34 56", "telephone")).toEqual({ ok: true, value: "+590690123456" });
    expect(validateAnswer("00596696123456", "telephone")).toEqual({ ok: true, value: "+596696123456" });
    expect(validateAnswer("12345", "telephone")).toEqual({ ok: false });
  });

  it("oui / non", () => {
    expect(validateAnswer("Oui !", "oui_non")).toEqual({ ok: true, value: "oui" });
    expect(validateAnswer("d'accord", "oui_non")).toEqual({ ok: true, value: "oui" });
    expect(validateAnswer("Non merci", "oui_non")).toEqual({ ok: true, value: "non" });
    expect(validateAnswer("peut-être", "oui_non")).toEqual({ ok: false });
  });
});

describe("fenêtre de 24 h", () => {
  const now = new Date("2026-11-03T16:00:00Z");
  it("ouverte moins de 24 h après le dernier message du contact", () => {
    expect(canSendFreeform({ lastInboundAt: "2026-11-02T16:00:01Z" }, now)).toBe(true);
  });
  it("fermée après 24 h ou sans message du contact", () => {
    expect(canSendFreeform({ lastInboundAt: "2026-11-02T16:00:00Z" }, now)).toBe(false);
    expect(canSendFreeform({}, now)).toBe(false);
  });
});

describe("identifiants de réponse", () => {
  it("aller-retour, y compris avec des caractères spéciaux", () => {
    const ref = { flowId: "f|1", nodeId: "nœud", handle: "oui" };
    expect(decodeReplyId(encodeReplyId(ref))).toEqual(ref);
  });
  it("rejette un id étranger", () => {
    expect(decodeReplyId("btn_1")).toBeNull();
    expect(decodeReplyId("pf|a|b")).toBeNull();
  });
});

describe("fixtures", () => {
  it("edge() utilise la sortie par défaut", () => {
    expect(edge("a", "b").sourceHandle).toBeNull();
  });
});
