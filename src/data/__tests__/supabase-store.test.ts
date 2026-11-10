import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLocalRepositories } from "../local/repositories";
import { createMasterTemplate } from "../template-seed";
import { crmMenuText, crmOpeningHours, crmZonesText } from "../supabase/crm";
import { assertBotTable, assertReadOnlyFunction, type Db, type Row, type SelectOptions } from "../supabase/db";
import { createSupabaseStore } from "../supabase/store";
import { autoLinkBots } from "../auto-bots";
import { resolveBot } from "../resolve";

const R1 = "00000000-0000-4000-8000-000000000001"; // signé, avec carte et zones
const R2 = "00000000-0000-4000-8000-000000000002"; // démo
const R3 = "00000000-0000-4000-8000-000000000003"; // prospect (caché)
const R4 = "00000000-0000-4000-8000-000000000004"; // perdu, mais a déjà un bot
const R5 = "00000000-0000-4000-8000-000000000005"; // deuxième démo (ajoutée par certains tests)

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
    paiement_restos: [
      { restaurant_id: R1, module: true, mode: "obligatoire" },
      { restaurant_id: R4, module: true, mode: "coupe" },
    ],
    bot_reglages: [{ restaurant_id: R1, actif: true }],
    bot_modeles: [],
    bot_clients: [{ restaurant_id: R4, mode_declenchement: "toujours", modele_id: null, lie_le: null, cree_le: "2026-10-05T10:00:00Z", maj_le: "2026-10-05T10:00:00Z" }],
    bot_dossiers: [],
    bot_flux: [],
    bot_fiches: [],
    bot_tournees: [],
    bot_appels_ia: [],
    bot_demos: [],
  };
  const writes: string[] = [];
  const functionCalls: string[] = [];
  // Mode en vigueur simulé (comme paiement_mode_public) : R2 paie en ligne ou sur place, les autres sur place.
  const paymentModes: Record<string, string> = { [R2]: "choix" };
  const db: Db = {
    async readFunction<T = unknown>(name: string, args: Record<string, unknown>) {
      assertReadOnlyFunction(name);
      functionCalls.push(name);
      return (paymentModes[String(args.rid)] ?? "non") as T;
    },
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
  return { db, tables, writes, functionCalls };
}

const CRM_TABLES = ["restaurants", "resto_modules", "qg_zones_livraison", "produits", "groupes_options", "options", "produits_groupes", "bot_reglages", "paiement_restos"];

function setup(fake = fakeDb(), clock = { now: new Date("2026-11-05T10:00:00Z") }) {
  let n = 0;
  const store = createSupabaseStore(fake.db, { newId: () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`, now: () => 0 });
  const repos = createLocalRepositories(store, {
    crmClients: true,
    lockedFields: (id) => store.lockedFields(id),
    newId: () => `00000000-0000-4000-a000-${String(++n).padStart(12, "0")}`,
    now: () => clock.now,
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
    expect(await repos.infoSheets.lockedFields(R1)).toEqual(["horaires", "adresse", "livraison", "retrait", "zonesLivraison", "paiementEnLigne", "familles", "resumeCarte"]);
    // Démo sans horaires ni carte : ces champs restent modifiables côté bot.
    expect(await repos.infoSheets.lockedFields(R2)).toEqual(["livraison", "retrait", "paiementEnLigne"]);
  });

  it("paiement en ligne : mode en vigueur lu dans le CRM (lecture seule), « à configurer » sans prestataire prêt", async () => {
    const fake = fakeDb();
    const { repos } = setup(fake);
    // R1 : réglé « obligatoire » mais rien en vigueur (prestataire pas prêt) → sur place, à configurer.
    expect((await repos.infoSheets.get(R1)).paiementEnLigne).toEqual({ mode: "non", aConfigurer: true });
    expect((await repos.infoSheets.get(R2)).paiementEnLigne).toEqual({ mode: "choix", aConfigurer: false });
    // R4 : le resto a coupé le paiement en ligne lui-même → pas un point d'onboarding.
    expect((await repos.infoSheets.get(R4)).paiementEnLigne).toEqual({ mode: "non", aConfigurer: false });
    expect(new Set(fake.functionCalls)).toEqual(new Set(["paiement_mode_public"]));
    expect(fake.writes).toEqual([]);
  });

  it("seules les fonctions de lecture connues peuvent être appelées", () => {
    expect(() => assertReadOnlyFunction("paiement_mode_public")).not.toThrow();
    for (const f of ["paiement_confirmer", "passer_commande", "pont_relier"]) expect(() => assertReadOnlyFunction(f)).toThrow("interdite");
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
    expect(tables.bot_flux).toHaveLength(17);
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
    expect((await other.flows.listByOwner(template.id)).length).toBe(17);
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

describe("création automatique des bots", () => {
  it("sans modèle maître : rien n'est créé, avec la raison", async () => {
    const { repos, tables } = setup();
    expect(await autoLinkBots(repos)).toEqual({ linked: [], skipped: expect.stringContaining("modèle maître") });
    expect(tables.bot_clients).toHaveLength(1);
  });

  it("lie au modèle les restos signés, actifs ou en démo qui n'ont pas encore de bot ; une seule fois", async () => {
    const fake = fakeDb();
    const crmBefore = structuredClone(CRM_TABLES.map((t) => fake.tables[t]));
    const { repos, tables, writes } = setup(fake);
    const template = await createMasterTemplate(repos);
    const result = await autoLinkBots(repos);
    expect(result.linked.map((c) => c.nomResto).sort()).toEqual(["Cookies An Nou", "Démo Burger"]);
    // L'ancien client (perdu) avait déjà une ligne : pas touché. Le prospect n'est pas concerné.
    expect(tables.bot_clients.find((c) => c.restaurant_id === R4)?.modele_id).toBeNull();
    expect(tables.bot_clients.find((c) => c.restaurant_id === R3)).toBeUndefined();
    expect(tables.bot_clients.filter((c) => c.modele_id === template.id).map((c) => c.restaurant_id).sort()).toEqual([R1, R2].sort());
    expect(writes.every((t) => t.startsWith("bot_"))).toBe(true);
    expect(CRM_TABLES.map((t) => fake.tables[t])).toEqual(crmBefore);

    // Relu par un autre navigateur : rien de plus à créer.
    expect((await autoLinkBots(setup(fake).repos)).linked).toEqual([]);
  });

  it("désactiver ou « supprimer le bot » : la ligne reste, le bot n'est jamais recréé ; réactiver le relie", async () => {
    const fake = fakeDb();
    const { repos } = setup(fake);
    const template = await createMasterTemplate(repos);
    await autoLinkBots(repos);
    await repos.bots.disable(R1);
    await repos.clients.delete(R2);

    const other = setup(fake).repos;
    expect((await autoLinkBots(other)).linked).toEqual([]);
    const r1 = (await other.clients.get(R1))!;
    expect(r1.botDisabledAt).toBeTruthy();
    expect(r1.template).toBeUndefined();
    expect((await other.clients.get(R2))?.botDisabledAt).toBeTruthy();
    expect(fake.tables.bot_clients.find((c) => c.restaurant_id === R1)).toMatchObject({ modele_id: null });

    // Un bot désactivé n'a aucun flux actif.
    const templateFlows = await other.flows.listByOwner(template.id);
    const linkedCopy = { ...r1, template: { templateId: template.id, linkedAt: "x" } };
    expect(resolveBot({ client: linkedCopy, templateFlows, clientFlows: [] }).flows).toEqual([]);

    await other.bots.enable(R1, template.id);
    const third = setup(fake).repos;
    expect((await third.clients.get(R1))).toMatchObject({ template: { templateId: template.id } });
    expect((await third.clients.get(R1))?.botDisabledAt).toBeUndefined();
  });

  it("un bot détaché garde sa ligne et n'est pas recréé", async () => {
    const fake = fakeDb();
    const { repos } = setup(fake);
    await createMasterTemplate(repos);
    await autoLinkBots(repos);
    await repos.bots.detach(R1);
    const other = setup(fake).repos;
    expect((await autoLinkBots(other)).linked).toEqual([]);
    const r1 = (await other.clients.get(R1))!;
    expect(r1.template).toBeUndefined();
    expect(r1.botDisabledAt).toBeUndefined();
    expect((await other.flows.listByOwner(R1)).length).toBe(17);
  });
});

describe("démos sur le numéro PFlow", () => {
  it("création automatique : la démo démarre (mot-clé = nom, 5 jours) ; rien dans le CRM", async () => {
    const fake = fakeDb();
    fake.tables.restaurants.push({ ...fake.tables.restaurants[1], id: R5, nom: "Démo Burger" });
    const crmBefore = structuredClone(CRM_TABLES.map((t) => fake.tables[t]));
    const { repos, tables } = setup(fake);
    await createMasterTemplate(repos);
    const result = await autoLinkBots(repos);
    expect(result.demosStarted?.sort()).toEqual([R2, R5].sort());
    const demos = await repos.demos.list();
    expect(demos.map((d) => d.keyword).sort()).toEqual(["Démo Burger", "Démo Burger 2"]);
    expect(demos[0]).toMatchObject({ days: 5, startedAt: "2026-11-05T10:00:00.000Z", expiresAt: "2026-11-10T10:00:00.000Z" });
    expect(tables.bot_demos.map((r) => r.mot_cle_normalise).sort()).toEqual(["demo burger", "demo burger 2"]);
    expect(CRM_TABLES.map((t) => fake.tables[t])).toEqual(crmBefore);
    // Relancer ne crée rien de plus.
    expect((await autoLinkBots(repos)).demosStarted).toBeUndefined();
  });

  it("mot-clé unique (casse et accents ignorés), prolongation, durée réglable", async () => {
    const fake = fakeDb();
    fake.tables.restaurants.push({ ...fake.tables.restaurants[1], id: R5, nom: "Byron" });
    const { repos } = setup(fake);
    await createMasterTemplate(repos);
    await autoLinkBots(repos);
    await expect(repos.demos.setKeyword(R2, "BYRÔN")).rejects.toThrow("déjà pris par Byron");
    expect((await repos.demos.setKeyword(R2, "Smash")).keyword).toBe("Smash");
    expect((await repos.demos.extend(R2, 5)).expiresAt).toBe("2026-11-15T10:00:00.000Z");
    expect((await repos.demos.setDays(R2, 7)).expiresAt).toBe("2026-11-12T10:00:00.000Z");
    await expect(repos.demos.setDays(R2, 0)).rejects.toThrow("Durée invalide");
  });

  it("expiration : bot supprimé (données bot_ seulement), jamais recréé tant que le resto reste en démo", async () => {
    const fake = fakeDb();
    const clock = { now: new Date("2026-11-05T10:00:00Z") };
    const crmBefore = structuredClone(CRM_TABLES.map((t) => fake.tables[t]));
    const { repos, tables } = setup(fake, clock);
    await createMasterTemplate(repos);
    await autoLinkBots(repos);
    await repos.infoSheets.save(R2, { ...(await repos.infoSheets.get(R2)), faq: "Oui" });
    expect(tables.bot_fiches.some((f) => f.restaurant_id === R2)).toBe(true);

    clock.now = new Date("2026-11-10T10:00:01Z");
    const result = await autoLinkBots(repos);
    expect(result.demosDeleted).toEqual([R2]);
    expect(result.linked).toEqual([]);
    expect(tables.bot_clients.some((c) => c.restaurant_id === R2)).toBe(false);
    expect(tables.bot_fiches.some((f) => f.restaurant_id === R2)).toBe(false);
    expect(tables.bot_demos.find((d) => d.restaurant_id === R2)?.supprime_le).toBeTruthy();
    expect((await repos.clients.list()).some((c) => c.id === R2)).toBe(true);
    expect(CRM_TABLES.map((t) => fake.tables[t])).toEqual(crmBefore);
    // Toujours en démo : pas recréé.
    expect((await autoLinkBots(repos)).linked).toEqual([]);
  });

  it("le resto passe signé pendant la démo : à l'expiration, le bot reste (c'est son bot client)", async () => {
    const fake = fakeDb();
    const clock = { now: new Date("2026-11-05T10:00:00Z") };
    const { repos, tables } = setup(fake, clock);
    await createMasterTemplate(repos);
    await autoLinkBots(repos);
    fake.tables.restaurants.find((r) => r.id === R2)!.statut = "signe";
    clock.now = new Date("2026-11-11T10:00:00Z");
    const fresh = setup(fake, clock).repos;
    const result = await autoLinkBots(fresh);
    expect(result.demosDeleted).toBeUndefined();
    expect(tables.bot_clients.find((c) => c.restaurant_id === R2)?.modele_id).toBeTruthy();
    expect(tables.bot_demos.some((d) => d.restaurant_id === R2)).toBe(false);
    await expect(fresh.demos.remove(R2)).rejects.toThrow();
  });

  it("sans la table bot_demos (avant la migration C) : rien n'est écrit, les actions sont refusées clairement", async () => {
    const fake = fakeDb();
    delete (fake.tables as Record<string, unknown>).bot_demos;
    const original = fake.db.select.bind(fake.db);
    fake.db.select = (async (table: string, columns: string, options?: SelectOptions) => {
      if (table === "bot_demos") throw new Error('relation "public.bot_demos" does not exist');
      return original(table, columns, options);
    }) as typeof fake.db.select;
    const { repos } = setup(fake);
    await createMasterTemplate(repos);
    const result = await autoLinkBots(repos);
    expect(result.linked.length).toBe(2);
    expect(result.demosStarted).toBeUndefined();
    expect(await repos.demos.available()).toBe(false);
    await expect(repos.demos.start(R2)).rejects.toThrow("migration C");
  });
});
