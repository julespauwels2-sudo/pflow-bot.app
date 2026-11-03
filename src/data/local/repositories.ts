import { DEFAULT_TIMEZONE, isValidTimezone, type InfoSheet } from "@/engine";
import { DataError, type Repositories } from "../repositories";
import { infoSheetSchema, slugSchema } from "../schemas";
import {
  EMPTY_INFO_SHEET,
  type BotClient,
  type BotFolder,
  type BotTemplate,
  type FlowGraph,
  type OwnerKind,
  type StoredFlow,
  type WorkspaceData,
} from "../types";
import { workspaceSchema } from "../schemas";
import type { JsonStore } from "./store";

export interface LocalRepoOptions {
  now?: () => Date;
  newId?: () => string;
}

/** Brouillon d'un nouveau flux : un déclencheur seul. */
export function newFlowGraph(newId: () => string): FlowGraph {
  return {
    nodes: [{ id: `trigger-${newId().slice(0, 8)}`, type: "trigger", position: { x: 0, y: 0 }, data: { keywords: [] } }],
    edges: [],
  };
}

function checkSlug(slug: string): string {
  const result = slugSchema.safeParse(slug);
  if (!result.success) throw new DataError(result.error.issues[0].message);
  return result.data;
}

function checkTimezone(timezone: string): string {
  if (!isValidTimezone(timezone)) throw new DataError(`Fuseau horaire inconnu : ${timezone}`);
  return timezone;
}

/** Implémentation des repositories sur un document JSON (localStorage ou mémoire). */
export function createLocalRepositories(store: JsonStore, options: LocalRepoOptions = {}): Repositories {
  const now = () => (options.now ? options.now() : new Date()).toISOString();
  const newId = options.newId ?? (() => crypto.randomUUID());

  function mutate<T>(fn: (data: WorkspaceData) => T): T {
    const data = store.read();
    const result = fn(data);
    store.write(data);
    return structuredClone(result);
  }

  function findClient(data: WorkspaceData, id: string): BotClient {
    const client = data.clients.find((c) => c.id === id);
    if (!client) throw new DataError("Client introuvable");
    return client;
  }

  function findFlow(data: WorkspaceData, id: string): StoredFlow {
    const flow = data.flows.find((f) => f.id === id);
    if (!flow) throw new DataError("Flux introuvable");
    return flow;
  }

  function findFolder(data: WorkspaceData, id: string) {
    const folder = data.folders.find((f) => f.id === id);
    if (!folder) throw new DataError("Dossier introuvable");
    return folder;
  }

  function checkFolderName(data: WorkspaceData, ownerId: string, name: string, exceptId?: string): string {
    const clean = name.trim();
    if (!clean) throw new DataError("Nom du dossier obligatoire");
    const taken = data.folders.some((f) => f.ownerId === ownerId && f.id !== exceptId && f.name.toLowerCase() === clean.toLowerCase());
    if (taken) throw new DataError(`Le dossier « ${clean} » existe déjà`);
    return clean;
  }

  /** Réécrit l'ordre 0, 1, 2… des dossiers d'un propriétaire. */
  function renumber(data: WorkspaceData, ownerId: string) {
    data.folders
      .filter((f) => f.ownerId === ownerId)
      .sort((a, b) => a.order - b.order)
      .forEach((f, i) => (f.order = i));
  }

  function checkFolderOwner(data: WorkspaceData, folderId: string, ownerId: string) {
    if (findFolder(data, folderId).ownerId !== ownerId) throw new DataError("Ce dossier appartient à un autre client ou au modèle");
  }

  function findTemplate(data: WorkspaceData, id: string): BotTemplate {
    const template = data.templates.find((t) => t.id === id);
    if (!template) throw new DataError("Modèle introuvable");
    return template;
  }

  /** Vérifie que le propriétaire (client ou modèle) existe. */
  function checkOwner(data: WorkspaceData, kind: OwnerKind, ownerId: string) {
    if (kind === "template") findTemplate(data, ownerId);
    else findClient(data, ownerId);
  }

  const ownerKindOf = (data: WorkspaceData, ownerId: string): OwnerKind =>
    data.templates.some((t) => t.id === ownerId) ? "template" : "client";

  /** Copie publiée d'un flux du modèle chez un client, rangée dans un dossier du même nom. */
  function copyFlowForClient(data: WorkspaceData, source: StoredFlow, clientId: string): StoredFlow {
    const sourceFolder = source.folderId ? data.folders.find((f) => f.id === source.folderId) : undefined;
    let folderId: string | undefined;
    if (sourceFolder) {
      let folder = data.folders.find((f) => f.ownerId === clientId && f.name.toLowerCase() === sourceFolder.name.toLowerCase());
      if (!folder) {
        folder = { id: newId(), ownerId: clientId, name: sourceFolder.name, order: data.folders.filter((f) => f.ownerId === clientId).length };
        data.folders.push(folder);
      }
      folderId = folder.id;
    }
    const graph = structuredClone(source.published ?? source.draft);
    const meta = source.publishedMeta ?? { name: source.name, description: source.description };
    return {
      id: newId(),
      ownerKind: "client",
      ownerId: clientId,
      ...(folderId ? { folderId } : {}),
      name: meta.name,
      ...(meta.description ? { description: meta.description } : {}),
      draft: graph,
      published: structuredClone(graph),
      publishedMeta: { ...meta },
      publishedAt: now(),
      version: 1,
      createdAt: now(),
      updatedAt: now(),
    };
  }

  function ensureUniqueSlug(data: WorkspaceData, slug: string, exceptId?: string) {
    if (data.clients.some((c) => c.orderSlug === slug && c.id !== exceptId)) {
      throw new DataError(`Le slug « ${slug} » est déjà utilisé par un autre client`);
    }
  }

  return {
    clients: {
      canManageClients: true,

      async list() {
        return store.read().clients.sort((a, b) => a.nomResto.localeCompare(b.nomResto, "fr"));
      },

      async get(id) {
        return store.read().clients.find((c) => c.id === id) ?? null;
      },

      async create(input) {
        return mutate((data) => {
          const nomResto = input.nomResto.trim();
          if (!nomResto) throw new DataError("Nom du resto obligatoire");
          const orderSlug = checkSlug(input.orderSlug.trim());
          ensureUniqueSlug(data, orderSlug);
          const client: BotClient = {
            id: newId(),
            nomResto,
            orderSlug,
            timezone: checkTimezone(input.timezone || DEFAULT_TIMEZONE),
            triggerMode: input.triggerMode ?? "mots_cles_uniquement",
            createdAt: now(),
            updatedAt: now(),
          };
          data.clients.push(client);
          return client;
        });
      },

      async update(id, patch) {
        return mutate((data) => {
          const client = findClient(data, id);
          if (patch.nomResto !== undefined) {
            if (!patch.nomResto.trim()) throw new DataError("Nom du resto obligatoire");
            client.nomResto = patch.nomResto.trim();
          }
          if (patch.orderSlug !== undefined) {
            const slug = checkSlug(patch.orderSlug.trim());
            ensureUniqueSlug(data, slug, id);
            client.orderSlug = slug;
          }
          if (patch.timezone !== undefined) client.timezone = checkTimezone(patch.timezone);
          if (patch.triggerMode !== undefined) client.triggerMode = patch.triggerMode;
          if (patch.options !== undefined) client.options = { ...client.options, ...patch.options };
          client.updatedAt = now();
          return client;
        });
      },

      async delete(id) {
        mutate((data) => {
          data.clients = data.clients.filter((c) => c.id !== id);
          data.flows = data.flows.filter((f) => f.ownerId !== id);
          data.folders = data.folders.filter((f) => f.ownerId !== id);
          delete data.infoSheets[id];
        });
      },
    },

    flows: {
      async listByOwner(ownerId) {
        return store
          .read()
          .flows.filter((f) => f.ownerId === ownerId)
          .sort((a, b) => a.name.localeCompare(b.name, "fr"));
      },

      async get(id) {
        return store.read().flows.find((f) => f.id === id) ?? null;
      },

      async create(input) {
        return mutate((data) => {
          const ownerKind = input.ownerKind ?? "client";
          checkOwner(data, ownerKind, input.ownerId);
          const name = input.name.trim();
          if (!name) throw new DataError("Nom du flux obligatoire");
          if (input.folderId) checkFolderOwner(data, input.folderId, input.ownerId);
          const flow: StoredFlow = {
            id: newId(),
            ownerKind,
            ownerId: input.ownerId,
            ...(input.folderId ? { folderId: input.folderId } : {}),
            name,
            description: input.description?.trim() || undefined,
            draft: input.draft ? structuredClone(input.draft) : newFlowGraph(newId),
            published: null,
            publishedMeta: null,
            publishedAt: null,
            version: 0,
            createdAt: now(),
            updatedAt: now(),
          };
          data.flows.push(flow);
          return flow;
        });
      },

      async update(id, patch) {
        return mutate((data) => {
          const flow = findFlow(data, id);
          if (patch.name !== undefined) {
            if (!patch.name.trim()) throw new DataError("Nom du flux obligatoire");
            flow.name = patch.name.trim();
          }
          if (patch.description !== undefined) flow.description = patch.description.trim() || undefined;
          if (patch.draft !== undefined) flow.draft = structuredClone(patch.draft);
          if (patch.folderId === null) delete flow.folderId;
          else if (patch.folderId !== undefined) {
            checkFolderOwner(data, patch.folderId, flow.ownerId);
            flow.folderId = patch.folderId;
          }
          flow.updatedAt = now();
          return flow;
        });
      },

      async publish(id) {
        return mutate((data) => {
          const flow = findFlow(data, id);
          flow.published = structuredClone(flow.draft);
          flow.publishedMeta = { name: flow.name, description: flow.description };
          flow.publishedAt = now();
          flow.version += 1;
          flow.updatedAt = now();
          return flow;
        });
      },

      async delete(id) {
        mutate((data) => {
          data.flows = data.flows.filter((f) => f.id !== id);
        });
      },
    },

    folders: {
      async listByOwner(ownerId) {
        return store
          .read()
          .folders.filter((f) => f.ownerId === ownerId)
          .sort((a, b) => a.order - b.order);
      },

      async create(input) {
        return mutate((data) => {
          checkOwner(data, ownerKindOf(data, input.ownerId), input.ownerId);
          const name = checkFolderName(data, input.ownerId, input.name);
          const order = data.folders.filter((f) => f.ownerId === input.ownerId).length;
          const folder: BotFolder = { id: newId(), ownerId: input.ownerId, name, order };
          data.folders.push(folder);
          return folder;
        });
      },

      async rename(id, name) {
        return mutate((data) => {
          const folder = findFolder(data, id);
          folder.name = checkFolderName(data, folder.ownerId, name, id);
          return folder;
        });
      },

      async move(id, delta) {
        mutate((data) => {
          const folder = findFolder(data, id);
          renumber(data, folder.ownerId);
          const siblings = data.folders.filter((f) => f.ownerId === folder.ownerId).sort((a, b) => a.order - b.order);
          const other = siblings.find((f) => f.order === folder.order + delta);
          if (!other) return;
          [folder.order, other.order] = [other.order, folder.order];
        });
      },

      async delete(id) {
        mutate((data) => {
          const folder = findFolder(data, id);
          for (const flow of data.flows) if (flow.folderId === id) delete flow.folderId;
          data.folders = data.folders.filter((f) => f.id !== id);
          renumber(data, folder.ownerId);
        });
      },
    },

    bots: {
      async link(clientId, templateId) {
        return mutate((data) => {
          const client = findClient(data, clientId);
          findTemplate(data, templateId);
          client.template = { templateId, linkedAt: now() };
          client.updatedAt = now();
          return client;
        });
      },

      async personalize(clientId, templateFlowId) {
        return mutate((data) => {
          const client = findClient(data, clientId);
          if (!client.template) throw new DataError("Ce client n'est pas lié au modèle maître");
          const source = findFlow(data, templateFlowId);
          if (source.ownerKind !== "template" || source.ownerId !== client.template.templateId) {
            throw new DataError("Ce flux n'appartient pas au modèle de ce client");
          }
          if (!source.published || !source.publishedMeta) throw new DataError("Ce flux du modèle n'est pas encore publié");
          if (data.flows.some((f) => f.ownerId === clientId && f.overridesTemplateFlowId === templateFlowId)) {
            throw new DataError("Ce flux est déjà personnalisé pour ce client");
          }
          const copy = copyFlowForClient(data, source, clientId);
          copy.overridesTemplateFlowId = source.id;
          copy.basedOnTemplateVersion = source.version;
          data.flows.push(copy);
          return copy;
        });
      },

      async revert(flowId) {
        mutate((data) => {
          const flow = findFlow(data, flowId);
          if (!flow.overridesTemplateFlowId) throw new DataError("Ce flux n'est pas une personnalisation du modèle");
          data.flows = data.flows.filter((f) => f.id !== flowId);
        });
      },

      async detach(clientId) {
        mutate((data) => {
          const client = findClient(data, clientId);
          const templateId = client.template?.templateId;
          if (!templateId) throw new DataError("Ce client n'est pas lié au modèle maître");
          const own = data.flows.filter((f) => f.ownerId === clientId);
          // id du flux du modèle → id de la copie chez le client
          const idMap = new Map<string, string>();
          for (const flow of own) {
            if (!flow.overridesTemplateFlowId) continue;
            idMap.set(flow.overridesTemplateFlowId, flow.id);
            delete flow.overridesTemplateFlowId;
            delete flow.basedOnTemplateVersion;
          }
          const templateFlows = data.flows.filter((f) => f.ownerKind === "template" && f.ownerId === templateId && f.published);
          for (const source of templateFlows) {
            if (idMap.has(source.id)) continue;
            const copy = copyFlowForClient(data, source, clientId);
            idMap.set(source.id, copy.id);
            data.flows.push(copy);
          }
          // Les « Aller à un flux » visaient les flux du modèle : on les remet sur les copies.
          const remap = (graph: FlowGraph | null): FlowGraph | null =>
            graph && {
              ...graph,
              nodes: graph.nodes.map((n) => (n.type === "goto_flow" && idMap.has(n.data.flowId) ? { ...n, data: { flowId: idMap.get(n.data.flowId)! } } : n)),
            };
          for (const flow of data.flows) {
            if (flow.ownerId !== clientId) continue;
            flow.draft = remap(flow.draft)!;
            flow.published = remap(flow.published);
          }
          delete client.template;
          client.updatedAt = now();
        });
      },
    },

    templates: {
      async list() {
        return store.read().templates;
      },

      async get(id) {
        return store.read().templates.find((t) => t.id === id) ?? null;
      },

      async create(input) {
        return mutate((data) => {
          const name = input.name.trim();
          if (!name) throw new DataError("Nom du modèle obligatoire");
          const template: BotTemplate = { id: newId(), name, createdAt: now(), updatedAt: now() };
          data.templates.push(template);
          return template;
        });
      },

      async rename(id, name) {
        return mutate((data) => {
          const template = findTemplate(data, id);
          if (!name.trim()) throw new DataError("Nom du modèle obligatoire");
          template.name = name.trim();
          template.updatedAt = now();
          return template;
        });
      },
    },

    infoSheets: {
      async get(clientId) {
        return store.read().infoSheets[clientId] ?? structuredClone(EMPTY_INFO_SHEET);
      },

      async save(clientId, sheet: InfoSheet) {
        const parsed = infoSheetSchema.safeParse(sheet);
        if (!parsed.success) throw new DataError(`Fiche d'infos invalide : ${parsed.error.issues[0].message}`);
        return mutate((data) => {
          findClient(data, clientId);
          data.infoSheets[clientId] = parsed.data;
          return parsed.data;
        });
      },
    },

    workspace: {
      async exportAll() {
        return store.read();
      },

      async importAll(data) {
        const parsed = workspaceSchema.safeParse(data);
        if (!parsed.success) throw new DataError("Sauvegarde invalide");
        store.write(parsed.data);
      },
    },
  };
}
