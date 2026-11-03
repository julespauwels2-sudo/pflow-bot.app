import { describe, expect, it } from "vitest";
import { runEngine, DEFAULT_CHANNEL_SETTINGS } from "@/engine";
import { loadDemo } from "../demo";
import { createLocalRepositories } from "../local/repositories";
import { createLocalStorageStore, createMemoryStore, STORAGE_KEY } from "../local/store";
import { exportBackup, exportFileName, exportFlow, parseBackup, parseFlowImport } from "../transfer";
import { hasUnpublishedChanges, toEngineFlow } from "../types";

function setup() {
  let n = 0;
  let clock = new Date("2026-11-03T16:00:00Z");
  const repos = createLocalRepositories(createMemoryStore(), {
    newId: () => `id${++n}`,
    now: () => clock,
  });
  return { repos, tick: (ms = 1000) => (clock = new Date(clock.getTime() + ms)) };
}

/** Faux localStorage pour Node. */
class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe("clients", () => {
  it("fuseau America/Guadeloupe par défaut", async () => {
    const { repos } = setup();
    const c = await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
    expect(c.timezone).toBe("America/Guadeloupe");
  });

  it("accepte la Martinique et refuse un fuseau inconnu", async () => {
    const { repos } = setup();
    const c = await repos.clients.create({ nomResto: "Chez Paul", orderSlug: "chez-paul", timezone: "America/Martinique" });
    expect(c.timezone).toBe("America/Martinique");
    await expect(repos.clients.update(c.id, { timezone: "Mars/Olympus" })).rejects.toThrow("Fuseau horaire inconnu");
  });

  it("valide le slug et refuse les doublons", async () => {
    const { repos } = setup();
    await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
    await expect(repos.clients.create({ nomResto: "Autre", orderSlug: "mexico" })).rejects.toThrow("déjà utilisé");
    await expect(repos.clients.create({ nomResto: "Autre", orderSlug: "Chez Paul" })).rejects.toThrow("minuscules");
  });

  it("supprimer un client supprime ses flux et sa fiche", async () => {
    const { repos } = setup();
    const a = await repos.clients.create({ nomResto: "A", orderSlug: "a" });
    const b = await repos.clients.create({ nomResto: "B", orderSlug: "b" });
    await repos.flows.create({ ownerId: a.id, name: "Flux A" });
    await repos.flows.create({ ownerId: b.id, name: "Flux B" });
    await repos.infoSheets.save(a.id, { horaires: [], adresse: "ici" });
    await repos.clients.delete(a.id);
    expect(await repos.clients.list()).toHaveLength(1);
    expect(await repos.flows.listByOwner(a.id)).toEqual([]);
    expect(await repos.flows.listByOwner(b.id)).toHaveLength(1);
    expect(await repos.infoSheets.get(a.id)).toEqual({ horaires: [] });
  });
});

describe("flux : brouillon et publication", () => {
  it("un nouveau flux contient un déclencheur et n'est pas publié", async () => {
    const { repos } = setup();
    const c = await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
    const f = await repos.flows.create({ ownerId: c.id, name: "Accueil" });
    expect(f.draft.nodes.map((n) => n.type)).toEqual(["trigger"]);
    expect(f.published).toBeNull();
    expect(toEngineFlow(f)).toBeNull();
    expect(hasUnpublishedChanges(f)).toBe(true);
  });

  it("modifier le brouillon ne touche pas la version publiée", async () => {
    const { repos } = setup();
    const c = await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
    const f = await repos.flows.create({ ownerId: c.id, name: "Accueil" });
    const p = await repos.flows.publish(f.id);
    expect(p.version).toBe(1);
    expect(hasUnpublishedChanges(p)).toBe(false);

    const draft = structuredClone(p.draft);
    draft.nodes.push({ id: "m", type: "message", position: { x: 0, y: 100 }, data: { bubbles: [{ id: "m-1", text: "Salut", buttons: [] }] } });
    const edited = await repos.flows.update(f.id, { draft, name: "Accueil v2" });
    expect(edited.published?.nodes).toHaveLength(1);
    expect(edited.publishedMeta?.name).toBe("Accueil");
    expect(toEngineFlow(edited)?.name).toBe("Accueil");
    expect(hasUnpublishedChanges(edited)).toBe(true);

    const republished = await repos.flows.publish(f.id);
    expect(republished.version).toBe(2);
    expect(toEngineFlow(republished)?.nodes).toHaveLength(2);
  });

  it("l'ordre des clés n'est pas une modification", async () => {
    const storage = new FakeStorage();
    const repos = createLocalRepositories(createLocalStorageStore(storage));
    const c = await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
    const f = await repos.flows.create({ ownerId: c.id,
      name: "Accueil",
      draft: { nodes: [{ id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { keywords: [] } }], edges: [] },
    });
    const published = await repos.flows.publish(f.id);
    // Relu depuis le stockage, l'objet a ses clés dans l'ordre du schéma.
    const reordered = { ...published, draft: { edges: [], nodes: [{ data: { keywords: [] }, position: { y: 0, x: 0 }, type: "trigger", id: "t" }] } };
    expect(hasUnpublishedChanges(reordered as typeof published)).toBe(false);
  });

  it("les données renvoyées sont des copies (pas de modification par accident)", async () => {
    const { repos } = setup();
    const c = await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
    const f = await repos.flows.create({ ownerId: c.id, name: "Accueil" });
    f.draft.nodes = [];
    expect((await repos.flows.get(f.id))?.draft.nodes).toHaveLength(1);
  });
});

describe("fiche d'infos", () => {
  it("enregistre et relit, refuse une heure invalide", async () => {
    const { repos } = setup();
    const c = await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
    const sheet = { horaires: [{ jour: 6 as const, plages: [{ de: "18:00", a: "23:00" }] }], livraison: true };
    await repos.infoSheets.save(c.id, sheet);
    expect(await repos.infoSheets.get(c.id)).toEqual(sheet);
    await expect(
      repos.infoSheets.save(c.id, { horaires: [{ jour: 6, plages: [{ de: "18h", a: "23:00" }] }] }),
    ).rejects.toThrow("Fiche d'infos invalide");
  });
});

describe("export / import JSON", () => {
  it("un flux exporté se réimporte à l'identique", async () => {
    const { repos } = setup();
    const c = await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
    const f = await repos.flows.create({ ownerId: c.id, name: "Accueil", description: "Bienvenue" });
    const text = JSON.stringify(exportFlow(f));
    const parsed = parseFlowImport(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ name: "Accueil", description: "Bienvenue", graph: f.draft });
    expect(parsed.warnings).toEqual([]);
  });

  it("signale un « Aller à un flux » vers un flux absent", () => {
    const text = JSON.stringify({
      format: "pflow-bots/flow",
      version: 1,
      exportedAt: "2026-11-03T00:00:00Z",
      flow: {
        name: "Aide",
        graph: {
          nodes: [
            { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { keywords: ["aide"] } },
            { id: "g", type: "goto_flow", position: { x: 0, y: 0 }, data: { flowId: "ailleurs" } },
          ],
          edges: [{ id: "e", source: "t", target: "g" }],
        },
      },
    });
    const parsed = parseFlowImport(text, ["autre"]);
    expect(parsed.ok && parsed.warnings[0]).toContain("pointe vers un flux absent");
  });

  it("refuse un fichier invalide avec un message clair", () => {
    expect(parseFlowImport("pas du json")).toEqual({ ok: false, error: "Le fichier n'est pas un JSON valide" });
    const bad = parseFlowImport(JSON.stringify({ format: "pflow-bots/flow", version: 1, exportedAt: "", flow: { name: "x", graph: { nodes: [{ id: "a", type: "inconnu" }], edges: [] } } }));
    expect(bad.ok).toBe(false);
    const backup = parseFlowImport(JSON.stringify({ format: "pflow-bots/backup" }));
    expect(!backup.ok && backup.error).toContain("sauvegarde complète");
  });

  it("sauvegarde complète : aller-retour", async () => {
    const { repos } = setup();
    await loadDemo(repos);
    const text = JSON.stringify(exportBackup(await repos.workspace.exportAll()));
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const other = setup().repos;
    await other.workspace.importAll(parsed.value);
    expect(await other.workspace.exportAll()).toEqual(await repos.workspace.exportAll());
  });

  it("nom de fichier lisible", () => {
    expect(exportFileName("flux", "Agneau du week-end !", new Date("2026-11-03T12:00:00Z"))).toBe(
      "flux-agneau-du-week-end-2026-11-03.json",
    );
  });
});

describe("stockage navigateur", () => {
  it("persiste entre deux ouvertures", async () => {
    const storage = new FakeStorage();
    const a = createLocalRepositories(createLocalStorageStore(storage));
    await a.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
    const b = createLocalRepositories(createLocalStorageStore(storage));
    expect((await b.clients.list()).map((c) => c.nomResto)).toEqual(["Mexico"]);
  });

  it("convertit les anciens flux à la lecture et garde une copie des données d'avant", async () => {
    const storage = new FakeStorage();
    const old = {
      clients: [{ id: "c", nomResto: "Mexico", orderSlug: "mexico", timezone: "America/Guadeloupe", createdAt: "x", updatedAt: "x" }],
      flows: [
        {
          id: "f",
          clientId: "c",
          name: "Accueil",
          draft: { nodes: [{ id: "l", type: "order_link", position: { x: 0, y: 0 }, data: {} }], edges: [] },
          published: null,
          publishedMeta: null,
          publishedAt: null,
          version: 0,
          createdAt: "x",
          updatedAt: "x",
        },
      ],
      infoSheets: {},
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(old));
    const repos = createLocalRepositories(createLocalStorageStore(storage));
    const flow = await repos.flows.get("f");
    expect(flow?.draft.nodes[0].type).toBe("message");
    expect(flow).toMatchObject({ ownerKind: "client", ownerId: "c" });
    expect((await repos.clients.get("c"))?.triggerMode).toBe("mots_cles_uniquement");
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).flows[0].draft.nodes[0].type).toBe("message");
    expect(JSON.parse(storage.getItem(`${STORAGE_KEY}:avant-conversion-bulles`)!)).toEqual(old);
  });

  it("ne perd jamais des données illisibles : copie de secours", async () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, "{ cassé");
    const repos = createLocalRepositories(createLocalStorageStore(storage));
    expect(await repos.clients.list()).toEqual([]);
    const backupKey = storage.key(0);
    expect(backupKey).toMatch(/^pflow-bots:v1:corrompu:/);
    expect(storage.getItem(backupKey!)).toBe("{ cassé");
  });
});

describe("de bout en bout : stockage → moteur", () => {
  it("les flux publiés de la démo tournent dans le moteur", async () => {
    const { repos } = setup();
    const client = await loadDemo(repos);
    const flows = (await repos.flows.listByOwner(client.id)).map(toEngineFlow).filter((f) => f !== null);
    const result = await runEngine({
      now: new Date("2026-11-07T14:00:00Z"), // samedi 10h en Guadeloupe
      client: { id: client.id, nomResto: client.nomResto, orderSlug: client.orderSlug, timezone: client.timezone },
      channel: { id: "c", clientId: client.id, triggerMode: "mots_cles_uniquement", ...DEFAULT_CHANNEL_SETTINGS },
      flows,
      infoSheet: await repos.infoSheets.get(client.id),
      contact: { id: "x", pause: null, aiUsage: { day: "", calls: 0 } },
      session: null,
      message: { kind: "text", text: "Vos horaires ?" },
    });
    // « horaires » lance Infos pratiques ; le clic sur « 🕒 Horaires » donne la réponse de la fiche.
    const buttons = result.outgoing[0];
    if (buttons.kind !== "buttons") throw new Error("boutons attendus");
    const r2 = await runEngine({
      now: new Date("2026-11-07T14:00:00Z"),
      client: { id: client.id, nomResto: client.nomResto, orderSlug: client.orderSlug, timezone: client.timezone },
      channel: { id: "c", clientId: client.id, triggerMode: "mots_cles_uniquement", ...DEFAULT_CHANNEL_SETTINGS },
      flows,
      infoSheet: await repos.infoSheets.get(client.id),
      contact: result.contact,
      session: result.session,
      message: { kind: "button_reply", id: buttons.buttons[0].id, title: "🕒 Horaires" },
    });
    expect(r2.outgoing[0]).toEqual({
      kind: "text",
      text: "🕒 *Nos horaires*\nDu mardi au jeudi : 11h30 – 14h30\nVendredi : 11h30 – 14h30 et 18h30 – 23h\nSamedi : 11h30 – 15h et 18h30 – 23h\nDimanche : 11h30 – 15h\nFermé le lundi\nOuvert les jours fériés sauf le 25 décembre.",
    });
    // Puis « Aller à un flux » → CTA - Commander avec le bouton natif.
    expect(r2.outgoing[1]).toMatchObject({ kind: "link", buttonLabel: "😋 Je commande", url: "https://order.pflow.fr/c/resto-demo" });
  });

  it("charger la démo deux fois ne crée pas de doublon", async () => {
    const { repos } = setup();
    await loadDemo(repos);
    await loadDemo(repos);
    expect(await repos.clients.list()).toHaveLength(1);
  });
});

describe("dossiers", () => {
  async function withClient() {
    const { repos } = setup();
    const client = await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
    return { repos, client };
  }

  it("crée des dossiers dans l'ordre, refuse un nom vide ou en double", async () => {
    const { repos, client } = await withClient();
    await repos.folders.create({ ownerId: client.id, name: "Principales PFlow Order" });
    await repos.folders.create({ ownerId: client.id, name: "Fonctions IA" });
    expect((await repos.folders.listByOwner(client.id)).map((f) => [f.name, f.order])).toEqual([
      ["Principales PFlow Order", 0],
      ["Fonctions IA", 1],
    ]);
    await expect(repos.folders.create({ ownerId: client.id, name: "  " })).rejects.toThrow("obligatoire");
    await expect(repos.folders.create({ ownerId: client.id, name: "fonctions ia" })).rejects.toThrow("existe déjà");
  });

  it("renomme et réordonne", async () => {
    const { repos, client } = await withClient();
    const a = await repos.folders.create({ ownerId: client.id, name: "A" });
    const b = await repos.folders.create({ ownerId: client.id, name: "B" });
    await repos.folders.move(b.id, -1);
    expect((await repos.folders.listByOwner(client.id)).map((f) => f.name)).toEqual(["B", "A"]);
    await repos.folders.move(b.id, -1); // déjà en tête : rien ne bouge
    expect((await repos.folders.listByOwner(client.id)).map((f) => f.name)).toEqual(["B", "A"]);
    await repos.folders.rename(a.id, "Commande");
    expect((await repos.folders.listByOwner(client.id)).map((f) => f.name)).toEqual(["B", "Commande"]);
  });

  it("range un flux, le sort du dossier, et supprimer un dossier ne supprime jamais ses flux", async () => {
    const { repos, client } = await withClient();
    const folder = await repos.folders.create({ ownerId: client.id, name: "Commande" });
    const f = await repos.flows.create({ ownerId: client.id, name: "Statut - Prête", folderId: folder.id });
    expect(f.folderId).toBe(folder.id);
    expect((await repos.flows.update(f.id, { folderId: null })).folderId).toBeUndefined();
    await repos.flows.update(f.id, { folderId: folder.id });
    await repos.folders.delete(folder.id);
    const after = await repos.flows.get(f.id);
    expect(after).not.toBeNull();
    expect(after?.folderId).toBeUndefined();
    expect(await repos.folders.listByOwner(client.id)).toEqual([]);
  });

  it("un flux ne peut pas aller dans le dossier d'un autre client", async () => {
    const { repos, client } = await withClient();
    const other = await repos.clients.create({ nomResto: "Autre", orderSlug: "autre" });
    const folder = await repos.folders.create({ ownerId: other.id, name: "Ailleurs" });
    const f = await repos.flows.create({ ownerId: client.id, name: "Accueil" });
    await expect(repos.flows.update(f.id, { folderId: folder.id })).rejects.toThrow("autre client");
  });

  it("supprimer le client supprime ses dossiers ; une ancienne sauvegarde sans dossiers reste lisible", async () => {
    const { repos, client } = await withClient();
    await repos.folders.create({ ownerId: client.id, name: "A" });
    await repos.clients.delete(client.id);
    expect((await repos.workspace.exportAll()).folders).toEqual([]);
    const parsed = parseBackup(JSON.stringify({ format: "pflow-bots/backup", version: 1, exportedAt: "x", data: { clients: [], flows: [], infoSheets: {} } }));
    expect(parsed.ok && parsed.value.folders).toEqual([]);
  });
});
