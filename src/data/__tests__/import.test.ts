import { describe, expect, it } from "vitest";
import { planImport, suggestMapping } from "../import";
import { createLocalRepositories } from "../local/repositories";
import { createMemoryStore, emptyWorkspace } from "../local/store";
import { createMasterTemplate } from "../template-seed";
import type { WorkspaceData } from "../types";

const RID = "00000000-0000-4000-8000-000000000001";

async function localWorkspace(): Promise<WorkspaceData> {
  let n = 0;
  const repos = createLocalRepositories(createMemoryStore(), { newId: () => `local-${++n}`, now: () => new Date("2026-11-04T10:00:00Z") });
  const template = await createMasterTemplate(repos);
  const client = await repos.clients.create({ nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou" });
  await repos.bots.link(client.id, template.id);
  const accueil = (await repos.flows.listByOwner(template.id)).find((f) => f.name === "Accueil")!;
  await repos.bots.personalize(client.id, accueil.id);
  const own = await repos.flows.create({ ownerId: client.id, name: "Spécial Noël" });
  await repos.flows.update(own.id, {
    draft: { nodes: [...own.draft.nodes, { id: "g", type: "goto_flow", position: { x: 0, y: 0 }, data: { flowId: accueil.id } }], edges: [] },
  });
  await repos.infoSheets.save(client.id, { horaires: [{ jour: 1, plages: [{ de: "09:00", a: "10:00" }] }], faq: "Box ? Oui.", modesPaiement: "Espèces" });
  await repos.aiCalls.add({ clientId: client.id, at: "2026-11-04T10:00:00Z", source: "simulateur", message: "?" });
  await repos.clients.create({ nomResto: "Resto test", orderSlug: "resto-test" });
  return repos.workspace.exportAll();
}

function remoteWorkspace(): WorkspaceData {
  return {
    ...emptyWorkspace(),
    clients: [
      { id: RID, nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: "America/Guadeloupe", triggerMode: "mots_cles_uniquement", createdAt: "x", updatedAt: "x" },
    ],
    infoSheets: { [RID]: { horaires: [{ jour: 2, plages: [{ de: "08:00", a: "12:00" }] }], modesPaiement: "Carte" } },
  };
}

describe("import des données du navigateur", () => {
  it("propose le resto du CRM qui a le même slug", async () => {
    const local = await localWorkspace();
    const mapping = suggestMapping(local, remoteWorkspace());
    expect(Object.values(mapping).sort()).toEqual(["", RID]);
  });

  it("importe le modèle, les flux du client (personnalisation et « Aller à un flux » gardés), la fiche du bot et le journal", async () => {
    const local = await localWorkspace();
    const remote = remoteWorkspace();
    const localClient = local.clients.find((c) => c.orderSlug === "cookies-an-nou")!;
    const { data, done, warnings } = planImport(local, remote, { mapping: { [localClient.id]: RID }, locked: { [RID]: ["horaires"] } });

    expect(data.templates).toHaveLength(1);
    expect(data.flows.filter((f) => f.ownerKind === "template")).toHaveLength(11);
    const own = data.flows.filter((f) => f.ownerId === RID);
    expect(own.map((f) => f.name).sort()).toEqual(["Accueil", "Spécial Noël"]);
    const accueil = data.flows.find((f) => f.ownerKind === "template" && f.name === "Accueil")!;
    expect(own.find((f) => f.name === "Accueil")?.overridesTemplateFlowId).toBe(accueil.id);
    expect(data.clients[0].template?.templateId).toBe(data.templates[0].id);

    // Horaires du CRM jamais remplacés ; moyens de paiement déjà remplis : gardés ; FAQ ajoutée.
    expect(data.infoSheets[RID].horaires).toEqual(remote.infoSheets[RID].horaires);
    expect(data.infoSheets[RID].modesPaiement).toBe("Carte");
    expect(data.infoSheets[RID].faq).toBe("Box ? Oui.");
    expect(data.aiCalls).toEqual([expect.objectContaining({ clientId: RID })]);

    expect(done.join("\n")).toContain("Modèle maître");
    expect(warnings).toContain("« Resto test » : non importé (aucun resto du CRM choisi).");
  });

  it("si un modèle existe déjà : il est gardé, et les flux sont reliés par leur nom", async () => {
    const local = await localWorkspace();
    const remote = remoteWorkspace();
    const remoteTemplateId = "00000000-0000-4000-8000-0000000000aa";
    const remoteAccueil = "00000000-0000-4000-8000-0000000000bb";
    remote.templates.push({ id: remoteTemplateId, name: "Modèle maître", createdAt: "x", updatedAt: "x" });
    remote.flows.push({
      ...local.flows.find((f) => f.ownerKind === "template" && f.name === "Accueil")!,
      id: remoteAccueil,
      ownerId: remoteTemplateId,
    });
    const localClient = local.clients.find((c) => c.orderSlug === "cookies-an-nou")!;
    const { data, warnings } = planImport(local, remote, { mapping: { [localClient.id]: RID }, locked: {} });

    expect(data.templates.map((t) => t.id)).toEqual([remoteTemplateId]);
    expect(warnings[0]).toContain("existe déjà");
    const noel = data.flows.find((f) => f.name === "Spécial Noël")!;
    expect(noel.draft.nodes.find((n) => n.type === "goto_flow")?.data).toEqual({ flowId: remoteAccueil });
    expect(data.flows.find((f) => f.ownerId === RID && f.name === "Accueil")?.overridesTemplateFlowId).toBe(remoteAccueil);
  });

  it("un second import n'ajoute pas de doublons", async () => {
    const local = await localWorkspace();
    const localClient = local.clients.find((c) => c.orderSlug === "cookies-an-nou")!;
    const options = { mapping: { [localClient.id]: RID }, locked: {} };
    const first = planImport(local, remoteWorkspace(), options).data;
    const second = planImport(local, first, options);
    expect(second.data.flows).toHaveLength(first.flows.length);
    expect(second.data.aiCalls).toHaveLength(1);
  });
});
