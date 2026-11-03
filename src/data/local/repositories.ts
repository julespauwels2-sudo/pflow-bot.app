import { DEFAULT_TIMEZONE, isValidTimezone, type InfoSheet } from "@/engine";
import { DataError, type Repositories } from "../repositories";
import { infoSheetSchema, slugSchema } from "../schemas";
import { EMPTY_INFO_SHEET, type BotClient, type FlowGraph, type StoredFlow, type WorkspaceData } from "../types";
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
          client.updatedAt = now();
          return client;
        });
      },

      async delete(id) {
        mutate((data) => {
          data.clients = data.clients.filter((c) => c.id !== id);
          data.flows = data.flows.filter((f) => f.clientId !== id);
          delete data.infoSheets[id];
        });
      },
    },

    flows: {
      async listByClient(clientId) {
        return store
          .read()
          .flows.filter((f) => f.clientId === clientId)
          .sort((a, b) => a.name.localeCompare(b.name, "fr"));
      },

      async get(id) {
        return store.read().flows.find((f) => f.id === id) ?? null;
      },

      async create(input) {
        return mutate((data) => {
          findClient(data, input.clientId);
          const name = input.name.trim();
          if (!name) throw new DataError("Nom du flux obligatoire");
          const flow: StoredFlow = {
            id: newId(),
            clientId: input.clientId,
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
