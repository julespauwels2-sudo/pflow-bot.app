import { describe, expect, it } from "vitest";
import { RETRAIT_SEULEMENT_TEXT,
  formatPayment,
  NO_ROUND_TEXT,
  formatFixedDelivery,
  formatWeekdays,
  isPlanningDelivery,
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

  it("pas de livraison, retrait : le bouton « Livraison » le dit (avec l'adresse si connue), zones ignorées", () => {
    const v = infoSheetVariables({ horaires: [], livraison: false, retrait: true, zonesLivraison: "ignorées" }, MARDI_MIDI, TZ);
    expect(v.infos_livraison).toBe(RETRAIT_SEULEMENT_TEXT);
    expect(v.zones_livraison).toBe("");
    expect(v.modes_service).toBe("Retrait sur place uniquement");
    const avecAdresse = infoSheetVariables({ horaires: [], livraison: false, retrait: true, adresse: "Bourg de Sainte-Rose" }, MARDI_MIDI, TZ);
    expect(avecAdresse.infos_livraison).toBe(`${RETRAIT_SEULEMENT_TEXT}\n📍 Bourg de Sainte-Rose`);
  });

  it("ni livraison ni retrait : rien", () => {
    const v = infoSheetVariables({ horaires: [], livraison: false, retrait: false }, MARDI_MIDI, TZ);
    expect(v.infos_livraison).toBe("");
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

describe("passage automatique « sur planning »", () => {
  const now = new Date("2026-11-03T16:00:00Z");
  const base = { horaires: [], livraison: true, zonesLivraison: "• Jarry : livraison offerte" };

  it("des tournées à venir font passer en planning, même sans mode choisi ou en mode zones", () => {
    for (const livraisonMode of [undefined, "zones" as const]) {
      const v = infoSheetVariables({ ...base, livraisonMode, tournees: [{ id: "t1", date: "2026-11-05", lieux: "Jarry (entreprises)" }] }, now, "America/Guadeloupe");
      expect(v.infos_livraison).toContain("Jarry (entreprises)");
      expect(v.zones_livraison).toBe("");
      expect(v.prochaines_livraisons).toContain("Jeudi 5 novembre");
    }
  });

  it("sans tournée à venir (passées seulement), les zones restent", () => {
    const v = infoSheetVariables({ ...base, tournees: [{ id: "t0", date: "2026-10-01", lieux: "Passée" }] }, now, "America/Guadeloupe");
    expect(v.infos_livraison).toBe("• Jarry : livraison offerte");
  });

  it("isPlanningDelivery : seulement si le resto livre", () => {
    expect(isPlanningDelivery({ livraison: false }, 3)).toBe(false);
    expect(isPlanningDelivery({ livraison: true, livraisonMode: "planning" }, 0)).toBe(true);
  });
});

describe("jours de livraison fixes par zone", () => {
  const now = new Date("2026-11-03T16:00:00Z");
  const tz = "America/Guadeloupe";
  const zones = "• Jarry : livraison offerte\n• Dothémare : livraison offerte\n• Saint-Anne : livraison 2 €";
  const jours = [
    { id: "j1", zone: "Jarry", jours: [2, 3, 5] as (2 | 3 | 5)[] },
    { id: "j2", zone: "dothemare", jours: [5, 2] as (2 | 5)[], note: "le midi" },
  ];

  it("formate les jours à la française", () => {
    expect(formatWeekdays([5, 2, 3])).toBe("mardi, mercredi et vendredi");
    expect(formatWeekdays([1, 2, 3, 4, 5])).toBe("du lundi au vendredi");
    expect(formatWeekdays([1, 2, 3, 4, 5, 6, 7])).toBe("tous les jours");
    expect(formatWeekdays([4])).toBe("jeudi");
  });

  it("reprend les infos de la zone (frais) et garde les zones sans jour fixe", () => {
    expect(formatFixedDelivery(jours, zones)).toBe(
      "• *Jarry* : mardi, mercredi et vendredi (livraison offerte)\n• *dothemare* : mardi et vendredi (le midi, livraison offerte)\n• Saint-Anne : livraison 2 €",
    );
  });

  it("jours fixes seuls : annoncés, jamais « aucune tournée », même en mode planning", () => {
    const v = infoSheetVariables({ horaires: [], livraison: true, livraisonMode: "planning", zonesLivraison: zones, joursLivraison: jours }, now, tz);
    expect(v.infos_livraison).toContain("• *Jarry* : mardi, mercredi et vendredi");
    expect(v.infos_livraison).not.toContain(NO_ROUND_TEXT);
    expect(v.jours_livraison).toBe(v.infos_livraison);
    expect(v.prochaines_livraisons).toBe("");
  });

  it("jours fixes + tournées à venir : les deux, les tournées en livraisons exceptionnelles", () => {
    const v = infoSheetVariables(
      {
        horaires: [],
        livraison: true,
        zonesLivraison: zones,
        joursLivraison: jours,
        tournees: [
          { id: "t0", date: "2026-10-01", lieux: "Passée" },
          { id: "t1", date: "2026-11-07", lieux: "Gosier (marché de Noël)" },
        ],
      },
      now,
      tz,
    );
    expect(v.infos_livraison).toBe(
      `${formatFixedDelivery(jours, zones)}\n\n📅 *Livraisons exceptionnelles*\n• *Samedi 7 novembre* : Gosier (marché de Noël)`,
    );
    expect(v.infos_pratiques).toContain("🛵 *Livraison*\n• *Jarry*");
  });

  it("ignorés si le resto ne livre pas, ou sans jour coché", () => {
    expect(infoSheetVariables({ horaires: [], livraison: false, joursLivraison: jours }, now, tz).jours_livraison).toBe("");
    const v = infoSheetVariables({ horaires: [], livraison: true, zonesLivraison: zones, joursLivraison: [{ id: "x", zone: "Jarry", jours: [] }] }, now, tz);
    expect(v.infos_livraison).toBe(zones);
  });
});

describe("texte du paiement", () => {
  const base = { horaires: [] };
  it("phrase selon le mode en vigueur, sans jamais nommer le prestataire", () => {
    expect(formatPayment({ ...base, paiementEnLigne: { mode: "choix", aConfigurer: false } })).toBe(
      "Vous pouvez payer *en ligne par carte* au moment de la commande, ou *sur place*.",
    );
    expect(formatPayment({ ...base, paiementEnLigne: { mode: "obligatoire", aConfigurer: false }, modesPaiement: "Espèces" })).toBe(
      "Le paiement se fait *en ligne par carte*, au moment de la commande.",
    );
    expect(formatPayment({ ...base, retrait: true, paiementEnLigne: { mode: "non", aConfigurer: true } })).toBe("Le paiement se fait *sur place*.");
    expect(formatPayment({ ...base, livraison: true, retrait: true, paiementEnLigne: { mode: "non", aConfigurer: false } })).toBe(
      "Le paiement se fait *sur place*, au comptoir ou à la livraison.",
    );
    expect(formatPayment({ ...base, livraison: true, paiementEnLigne: { mode: "non", aConfigurer: false } })).toBe("Le paiement se fait *sur place*, à la livraison.");
    for (const mode of ["choix", "obligatoire", "non"] as const) {
      expect(formatPayment({ ...base, paiementEnLigne: { mode, aConfigurer: false } })).not.toMatch(/sumup|stripe/i);
    }
  });

  it("précisions sur place ajoutées après la phrase ; sans CRM, les précisions seules", () => {
    expect(formatPayment({ ...base, paiementEnLigne: { mode: "choix", aConfigurer: false }, modesPaiement: " Espèces, tickets resto " })).toBe(
      "Vous pouvez payer *en ligne par carte* au moment de la commande, ou *sur place*.\nSur place : Espèces, tickets resto",
    );
    expect(formatPayment({ ...base, modesPaiement: "Espèces" })).toBe("Espèces");
    expect(infoSheetVariables({ ...base, paiementEnLigne: { mode: "obligatoire", aConfigurer: false } }, new Date(), "America/Guadeloupe").modes_paiement).toContain("en ligne par carte");
  });
});
