import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLocalRepositories } from "../local/repositories";
import { createMasterTemplate } from "../template-seed";
import { crmMenuText, crmOpeningHours, crmZonesText } from "../supabase/crm";
import { assertBotTable, type Db, type Row, type SelectOptions } from "../supabase/db";
import { createSupabaseStore } from "../supabase/store";

const R1 = "00000000-0000-4000-8000-000000000001"; // signé, avec carte et zones
const R2 = "00000000-0000-4000-8000-000000000002"; // démo
const R3 = "00000000-0000-4000-8000-000000000003"; // prospect (caché)
const R4 = "00000000-0000-4000-8000-000000000004"; // perdu, mais a déjà un bot

/** Base en mémoire : CRM + tables bot_, avec les mêmes garde-fous que l'adaptateur Supabase. */
function fakeDb() {
  const tables: Record<string, Row[]> = {
    restaurants: [
      {
        id: R1, nom: "Cookies An Nou", slug: "cookies-an-nou", fuseau: "America/Guadeloupe", statut: "signe", adresse: "Jarry",
        horaires: { pas: 15, jours: { "1": [], "2": [["08:00", "12:00"]], "3": [["08:00", "12:00"]], "6": [], "7": [] } },
        livraison: true, retrait: false, created_at: "2026-10-01T10:00:00Z",
      },
      { id: R2, nom: "Démo Burger", slug: null, fuseau: "America/Martinique", statut: "demo", adresse: null, horaires: null, livraison: false, retrait: true, created_at: "2026-10-02T10:00:00Z" },
      { id: R3, nom: "Prospect", slug: "prospect", fuseau: "America/Guadeloupe", statut: "prospect", adresse: null, horaires: null, livraison: false, retrait: true, created_at: "2026-10-03T10:00:00Z" },
      { id: R4, nom: "Ancien client", slug: "ancien", fuseau: "America/Guadeloupe", statut: "perdu", adresse: null, horaires: null, livraison: false, retrait: true, created_at: "2026-10-04T10:00:00Z" },
    ],
    resto_modules: [{ restaurant_id: R1, module: "relance", actif: true }],
    qg_zones_livraison: [
      { restaurant_id: R1, nom: "Jarry", frais: 0, minimum: 0, ordre: 1 },
      { restaurant_id: R1, nom: "Dothémare", frais: 2.5, minimum: 15, ordre: 2 },
    ],
    produits: [
      { id: "p1", restaurant_id: R1, categorie: "Cookies", nom: "Tout choco", description: "Cœur fondant", prix: 4, disponible: true, ordre: 1, allergenes: ["gluten", "oeufs", "fruits_coque"], allergenes_note: null, jours_dispo: null },
      { id: "p2", restaurant_id: R1, categorie: "Box", nom: "Box 6", description: null, prix: 24, disponible: true, ordre: 2, allergenes: null, allergenes_note: null, jours_dispo: [6, 0] },
      { id: "p3", restaurant_id: R1, categorie: "Cookies", nom: "Rupture", description: null, prix: 4, disponible: false, ordre: 3, allergenes: null, allergenes_note: null, jours_dispo: null },
    ],
    groupes_options: [{ id: "g1", restaurant_id: R1, nom: "Nappage", obligatoire: false, min_choix: 0, max_choix: 1, ordre: 1 }],
    options: [
      { id: "o1", groupe_id: "g1", nom: "Caramel", prix_supplement: 0.5, actif: true, ordre: 1 },
      { id: "o2", groupe_id: "g1", nom: "Sans", prix_supplement: 0, actif: true, ordre: 0 },
    ],
    produits_groupes: [{ produit_id: "p1", groupe_id: "g1", ordre: 1 }],
    bot_reglages: [{ restaurant_id: R1, actif: true }],
    bot_modeles: [],
    bot_clients: [{ restaurant_id: R4, mode_declenchement: "toujours", modele_id: null, lie_le: null, cree_le: "2026-10-05T10:00:00Z", maj_le: "2026-10-05T10:00:00Z" }],
    bot_dossiers: [],
    bot_flux: [],
    bot_fiches: [],
    bot_tournees: [],
    bot_appels_ia: [],
  };
  const writes: string[] = [];
  const db: Db = {
    async select<T extends Row = Row>(table: string, _columns: string, options: SelectOptions = {}) {
      let rows = structuredClone(tables[table] ?? []);
      if (options.in) rows = rows.filter((r) => options.in!.values.includes(String(r[options.in!.column])));
      if (options.limit) rows = rows.slice(0, options.limit);
      return rows as T[];
    },
    async upsert(table, rows, onConflict) {
      assertBotTable(table);
      writes.push(table);
      for (const row of rows) {
        const list = tables[table];
        const i = list.findIndex((r) => r[onConflict] === row[onConflict]);
        const withDefaults = { cree_le: "2026-11-05T10:00:00Z", maj_le: "2026-11-05T10:00:00Z", ...(i >= 0 ? list[i] : {}), ...structuredClone(row) };
        if (i >= 0) list[i] = withDefaults;
        else list.push(withDefaults);
      }
    },
    async remove(table, column, values) {
      assertBotTable(table);
      writes.push(table);
      tables[table] = tables[table].filter((r) => !values.includes(String(r[column])));
    },
  };
  return { db, tables, writes };
}

const CRM_TABLES = ["restaurants", "resto_modules", "qg_zones_livraison", "produits", "groupes_options", "options", "produits_groupes", "bot_reglages"];

function setup(fake = fakeDb()) {
  let n = 0;
  const store = createSupabaseStore(fake.db, { newId: () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`, now: () => 0 });
  const repos = createLocalRepositories(store, {
    crmClients: true,
    lockedFields: (id) => store.lockedFields(id),
    newId: () => `00000000-0000-4000-a000-${String(++n).padStart(12, "0")}`,
    now: () => new Date("2026-11-05T10:00:00Z"),
  });
  return { ...fake, store, repos };
}

describe("lecture du CRM", () => {
  it("affiche les restos signés, actifs, en démo, et ceux qui ont déjà un bot", async () => {
    const { repos } = setup();
    const clients = await repos.clients.list();
    expect(clients.map((c) => c.nomResto)).toEqual(["Ancien client", "Cookies An Nou", "Démo Burger"]);
    const cookies = clients.find((c) => c.id === R1)!;
    expect(cookies).toMatchObject({ orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe", crmStatut: "signe", options: { panier_abandonne: true } });
    expect(clients.find((c) => c.id === R4)?.triggerMode).toBe("toujours");
    expect(repos.clients.canManageClients).toBe(false);
  });

  it("construit la fiche d'infos depuis le CRM : horaires, adresse, service, zones, carte", async () => {
    const { repos } = setup();
    const sheet = await repos.infoSheets.get(R1);
    expect(sheet.horaires).toEqual([
      { jour: 2, plages: [{ de: "08:00", a: "12:00" }] },
      { jour: 3, plages: [{ de: "08:00", a: "12:00" }] },
    ]);
    expect(sheet).toMatchObject({ adresse: "Jarry", livraison: true, retrait: false });
    expect(sheet.zonesLivraison).toBe("• Jarry : livraison offerte\n• Dothémare : livraison 2,50 €, minimum de commande 15 €");
    expect(sheet.resumeCarte).toContain("• Tout choco : 4 €");
    expect(sheet.resumeCarte).toContain("Nappage (en option) : Sans, Caramel (+0,50 €)");
    expect(sheet.resumeCarte).toContain("Disponible seulement le samedi, le dimanche");
    expect(sheet.resumeCarte).toContain("Allergènes : Gluten, Œufs, Fruits à coque");
    expect(sheet.resumeCarte).toContain("Allergènes : non renseignés");
    expect(sheet.resumeCarte).not.toContain("Rupture");
    expect(await repos.infoSheets.lockedFields(R1)).toEqual(["horaires", "adresse", "livraison", "retrait", "zonesLivraison", "resumeCarte"]);
    // Démo sans horaires ni carte : ces champs restent modifiables côté bot.
    expect(await repos.infoSheets.lockedFields(R2)).toEqual(["livraison", "retrait"]);
  });

  it("formatage : horaires invalides ignorés", () => {
    expect(crmOpeningHours({ jours: { "1": [["8h", "12h"]], "8": [["08:00", "09:00"]], "2": [["08:00", "12:00"]] } })).toEqual([{ jour: 2, plages: [{ de: "08:00", a: "12:00" }] }]);
    expect(crmOpeningHours(null)).toBeNull();
    expect(crmZonesText([])).toBe("");
    expect(crmMenuText(R2, { produits: [], groupes: [], options: [], produitsGroupes: [] })).toBe("");
  });
});

describe("écritures : uniquement dans les tables bot_, jamais dans le CRM", () => {
  it("modèle maître, lien du bot, fiche et tournées sont enregistrés ; le CRM ne bouge pas", async () => {
    const fake = fakeDb();
    const crmBefore = structuredClone(CRM_TABLES.map((t) => fake.tables[t]));
    const { repos, tables, writes } = setup(fake);

    const template = await createMasterTemplate(repos);
    await repos.bots.link(R1, template.id);
    await repos.clients.update(R1, { triggerMode: "toujours" });
    const sheet = await repos.infoSheets.get(R1);
    await repos.infoSheets.save(R1, {
      ...sheet,
      horaires: [], // champ du CRM : ignoré
      faq: "Vous faites des box ? Oui.",
      livraisonMode: "planning",
      tournees: [{ id: "t-local", date: "2026-11-12", de: "11:00", a: "13:00", lieux: "Jarry" }],
    });

    expect(writes.every((t) => t.startsWith("bot_"))).toBe(true);
    expect(CRM_TABLES.map((t) => tables[t])).toEqual(crmBefore);
    expect(tables.bot_modeles).toHaveLength(1);
    expect(tables.bot_flux).toHaveLength(11);
    expect(tables.bot_dossiers).toHaveLength(3);
    expect(tables.bot_clients.find((c) => c.restaurant_id === R1)).toMatchObject({ mode_declenchement: "toujours", modele_id: template.id });
    expect(tables.bot_fiches).toEqual([expect.objectContaining({ restaurant_id: R1, donnees: { faq: "Vous faites des box ? Oui.", livraisonMode: "planning" } })]);
    expect(tables.bot_tournees).toEqual([expect.objectContaining({ restaurant_id: R1, date: "2026-11-12", de: "11:00", lieux: "Jarry" })]);

    // Relu depuis la base par un autre navigateur : tout est là, horaires du CRM compris.
    const other = setup(fake).repos;
    const reread = await other.infoSheets.get(R1);
    expect(reread.faq).toBe("Vous faites des box ? Oui.");
    expect(reread.horaires).toHaveLength(2);
    expect(reread.tournees?.[0]).toMatchObject({ date: "2026-11-12", de: "11:00", a: "13:00", lieux: "Jarry" });
    expect((await other.clients.get(R1))?.template?.templateId).toBe(template.id);
    expect((await other.flows.listByOwner(template.id)).length).toBe(11);
  });

  it("nom, slug, fuseau et options payantes se modifient dans le CRM ; pas de création de client", async () => {
    const { repos } = setup();
    await expect(repos.clients.update(R1, { nomResto: "Autre" })).rejects.toThrow("dans le CRM");
    await expect(repos.clients.update(R1, { options: { panier_abandonne: false } })).rejects.toThrow("dans le CRM");
    await expect(repos.clients.create({ nomResto: "X", orderSlug: "x" })).rejects.toThrow("CRM");
  });

  it("« Supprimer le bot » retire les données bot_ ; le resto reste dans la liste", async () => {
    const fake = fakeDb();
    const { repos, tables } = setup(fake);
    await repos.flows.create({ ownerId: R1, name: "Flux du client" });
    await repos.aiCalls.add({ clientId: R1, at: "2026-11-05T10:00:00Z", source: "simulateur", message: "?" });
    expect(tables.bot_flux).toHaveLength(1);
    expect(tables.bot_appels_ia).toHaveLength(1);
    await repos.clients.delete(R1);
    expect(tables.bot_flux).toHaveLength(0);
    expect(tables.bot_appels_ia).toHaveLength(0);
    expect(tables.restaurants).toHaveLength(4);
    expect((await setup(fake).repos.clients.list()).some((c) => c.id === R1)).toBe(true);
  });

  it("refuse toute écriture hors des tables bot_ (y compris les tables bot_ du module UChat)", () => {
    for (const t of ["restaurants", "produits", "bot_reglages", "bot_cles", "admins"]) expect(() => assertBotTable(t)).toThrow("Écriture interdite");
    expect(() => assertBotTable("bot_flux")).not.toThrow();
  });

  it("le code qui lit le CRM ne contient aucune écriture", () => {
    const crm = readFileSync(new URL("../supabase/crm.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(crm).not.toMatch(/\.(upsert|remove|insert|update|delete|rpc)\s*\(/);
    expect(crm).not.toMatch(/\bDb\b(?!Reader)/);
  });
});
