import { describe, expect, it } from "vitest";
import {
  NO_ROUND_TEXT,
  formatDateFr,
  formatHour,
  formatRound,
  formatTodayHours,
  formatWeeklyHours,
  infoSheetVariables,
  joinFr,
  upcomingRounds,
} from "../info-vars";
import { runEngine } from "../run";
import type { InfoSheet } from "../types";
import { channel, edge, fakeAi, input, node, say } from "./fixtures";

const TZ = "America/Guadeloupe";
// Mardi 3 novembre 2026, 12:00 en Guadeloupe.
const MARDI_MIDI = new Date("2026-11-03T16:00:00Z");

/** Cookies An Nou (corrigé) : du mardi au vendredi 8h-12h, livraison sur planning. */
const cookies: InfoSheet = {
  horaires: [2, 3, 4, 5].map((jour) => ({ jour: jour as 2 | 3 | 4 | 5, plages: [{ de: "08:00", a: "12:00" }] })),
  livraison: true,
  livraisonMode: "planning",
  tournees: [
    { id: "r0", date: "2026-11-02", de: "11:30", a: "13:00", lieux: "Jarry — tournée passée" },
    { id: "r1", date: "2026-11-03", de: "10:00", a: "11:30", lieux: "Dothémare — finie ce matin" },
    { id: "r2", date: "2026-11-03", de: "12:30", a: "14:00", lieux: "Jarry — Orange, EDF" },
    { id: "r3", date: "2026-11-10", lieux: "Jarry — CHU" },
    { id: "r4", date: "2026-11-06", de: "11:30", a: "13:00", lieux: "Petit-Pérou" },
  ],
  retrait: false,
  pointsDeVente: "Station Vito (Le Gosier), Total La Jaille, Esso Petit-Pérou (Les Abymes), Le Boudin de Saint-Félix",
  modesPaiement: "Espèces ou carte bancaire à la livraison",
};

describe("horaires", () => {
  it("formate les heures à la française", () => {
    expect(formatHour("08:00")).toBe("8h");
    expect(formatHour("11:30")).toBe("11h30");
    expect(formatHour("00:00")).toBe("0h");
    expect(joinFr(["lundi", "samedi", "dimanche"])).toBe("lundi, samedi et dimanche");
  });

  it("regroupe les jours identiques et liste les jours fermés", () => {
    expect(formatWeeklyHours(cookies)).toBe("Du mardi au vendredi : 8h – 12h\nFermé le lundi, le samedi et le dimanche");
  });

  it("deux jours de suite, plusieurs plages, plage de nuit et précisions", () => {
    const sheet: InfoSheet = {
      horaires: [
        { jour: 5, plages: [{ de: "18:00", a: "02:00" }, { de: "11:30", a: "14:30" }] },
        { jour: 6, plages: [{ de: "11:30", a: "14:30" }, { de: "18:00", a: "02:00" }] },
        { jour: 7, plages: [{ de: "11:30", a: "15:00" }] },
      ],
      horairesNote: "Fermé le 25 décembre.",
    };
    expect(formatWeeklyHours(sheet)).toBe(
      [
        "Vendredi et samedi : 11h30 – 14h30 et 18h – 2h",
        "Dimanche : 11h30 – 15h",
        "Fermé le lundi, le mardi, le mercredi et le jeudi",
        "Fermé le 25 décembre.",
      ].join("\n"),
    );
  });

  it("ouvert tous les jours : pas de ligne « Fermé »", () => {
    const sheet: InfoSheet = { horaires: [1, 2, 3, 4, 5, 6, 7].map((j) => ({ jour: j as 1, plages: [{ de: "09:00", a: "18:00" }] })) };
    expect(formatWeeklyHours(sheet)).toBe("Du lundi au dimanche : 9h – 18h");
  });

  it("horaires du jour dans le fuseau du client", () => {
    expect(formatTodayHours(cookies, MARDI_MIDI, TZ)).toBe("Aujourd'hui (mardi) : 8h – 12h");
    // Mardi 3 novembre 23:30 UTC = encore mardi en Guadeloupe, déjà mercredi à Paris.
    const late = new Date("2026-11-03T23:30:00Z");
    expect(formatTodayHours(cookies, late, TZ)).toBe("Aujourd'hui (mardi) : 8h – 12h");
    expect(formatTodayHours(cookies, late, "Europe/Paris")).toBe("Aujourd'hui (mercredi) : 8h – 12h");
    expect(formatTodayHours(cookies, new Date("2026-11-09T16:00:00Z"), TZ)).toBe("Aujourd'hui (lundi) : fermé");
  });
});

describe("livraison sur planning", () => {
  it("ne garde que les tournées à venir, triées ; une tournée du jour terminée est passée", () => {
    expect(upcomingRounds(cookies.tournees, MARDI_MIDI, TZ).map((r) => r.id)).toEqual(["r2", "r4", "r3"]);
  });

  it("sans plage horaire, une tournée du jour reste valable toute la journée", () => {
    const soir = new Date("2026-11-10T23:00:00Z"); // mardi 10 novembre, 19:00 en Guadeloupe
    expect(upcomingRounds(cookies.tournees, soir, TZ).map((r) => r.id)).toEqual(["r3"]);
  });

  it("formate les dates en français", () => {
    expect(formatDateFr("2026-11-10")).toBe("mardi 10 novembre");
    expect(formatRound(cookies.tournees![2])).toBe("• *Mardi 3 novembre* (12h30 – 14h) : Jarry — Orange, EDF");
  });

  it("variables : prochaines livraisons et infos pratiques", () => {
    const v = infoSheetVariables(cookies, MARDI_MIDI, TZ);
    expect(v.prochaines_livraisons).toBe(
      [
        "• *Mardi 3 novembre* (12h30 – 14h) : Jarry — Orange, EDF",
        "• *Vendredi 6 novembre* (11h30 – 13h) : Petit-Pérou",
        "• *Mardi 10 novembre* : Jarry — CHU",
      ].join("\n"),
    );
    expect(v.infos_livraison).toBe(v.prochaines_livraisons);
    expect(v.zones_livraison).toBe("");
    expect(v.modes_service).toBe("Livraison uniquement");
    expect(v.infos_pratiques).toContain("🛵 *Prochaines livraisons*");
    expect(v.infos_pratiques).toContain("🏪 *Points de vente*\nStation Vito");
    expect(v.infos_pratiques).not.toContain("Adresse");
    expect(v.infos_pratiques).not.toContain("passée");
  });

  it("en mode planning, un ancien texte de zones ne ressort jamais", () => {
    const v = infoSheetVariables({ ...cookies, zonesLivraison: "Jarry, Dothémare (ancien texte)" }, MARDI_MIDI, TZ);
    expect(v.zones_livraison).toBe("");
    expect(v.infos_pratiques).not.toContain("ancien texte");
  });

  it("plus aucune tournée à venir : message explicite, jamais de date inventée", () => {
    const v = infoSheetVariables(cookies, new Date("2026-12-01T16:00:00Z"), TZ);
    expect(v.prochaines_livraisons).toBe(NO_ROUND_TEXT);
  });

  it("mode zones : texte des zones", () => {
    const v = infoSheetVariables({ horaires: [], livraison: true, livraisonMode: "zones", zonesLivraison: "Jarry, Dothémare (offerte)" }, MARDI_MIDI, TZ);
    expect(v.infos_livraison).toBe("Jarry, Dothémare (offerte)");
    expect(v.prochaines_livraisons).toBe("");
    expect(v.horaires).toBe("");
    expect(v.horaires_du_jour).toBe("");
  });

  it("pas de livraison : variables de livraison vides", () => {
    const v = infoSheetVariables({ horaires: [], livraison: false, retrait: true, zonesLivraison: "ignorées" }, MARDI_MIDI, TZ);
    expect(v.infos_livraison).toBe("");
    expect(v.modes_service).toBe("Retrait sur place uniquement");
  });
});

describe("dans le moteur", () => {
  const flow = {
    id: "f_infos",
    name: "Infos",
    nodes: [node("t", "trigger", { keywords: ["livraison"] }), say("m", "🛵 *Prochaines livraisons*\n{{prochaines_livraisons}}\n\n{{horaires_du_jour}}")],
    edges: [edge("t", "m")],
  };

  it("les variables de la fiche d'infos sont remplacées dans les bulles", async () => {
    const r = await runEngine(input({ now: MARDI_MIDI, infoSheet: cookies, flows: [flow], message: { kind: "text", text: "livraison ?" } }));
    expect(r.outgoing[0]).toEqual({
      kind: "text",
      text:
        "🛵 *Prochaines livraisons*\n• *Mardi 3 novembre* (12h30 – 14h) : Jarry — Orange, EDF\n• *Vendredi 6 novembre* (11h30 – 13h) : Petit-Pérou\n• *Mardi 10 novembre* : Jarry — CHU\n\nAujourd'hui (mardi) : 8h – 12h",
    });
  });

  it("l'IA ne reçoit jamais les tournées passées", async () => {
    const ai = fakeAi({ action: "repondre", texte: "ok" });
    await runEngine(
      input({ now: MARDI_MIDI, infoSheet: cookies, channel: { ...channel, triggerMode: "toujours" }, message: { kind: "text", text: "vous livrez quand à Jarry ?" } }),
      { ai: ai.port },
    );
    expect(ai.calls[0].infoSheet.tournees?.map((r) => r.id)).toEqual(["r2", "r4", "r3"]);
  });
});
