import type { WorkspaceData } from "../types";
import { containsLegacyNodes } from "../migrate";
import { workspaceSchema } from "../schemas";

/** Stockage brut d'un document JSON unique. */
export interface JsonStore {
  read(): WorkspaceData;
  write(data: WorkspaceData): void;
}

export const STORAGE_KEY = "pflow-bots:v1";

export function emptyWorkspace(): WorkspaceData {
  return { clients: [], flows: [], folders: [], templates: [], infoSheets: {} };
}

/** Pour les tests : tout en mémoire. */
export function createMemoryStore(initial: WorkspaceData = emptyWorkspace()): JsonStore {
  let data = structuredClone(initial);
  return {
    read: () => structuredClone(data),
    write: (next) => {
      data = structuredClone(next);
    },
  };
}

/**
 * Stockage dans le localStorage du navigateur. Des données illisibles ne sont
 * jamais écrasées en silence : elles sont copiées sous une clé de secours.
 */
export function createLocalStorageStore(storage: Storage, key = STORAGE_KEY): JsonStore {
  return {
    read() {
      const raw = storage.getItem(key);
      if (!raw) return emptyWorkspace();
      try {
        const json: unknown = JSON.parse(raw);
        const parsed = workspaceSchema.safeParse(json);
        if (parsed.success) {
          if (containsLegacyNodes(json)) {
            // Conversion vers le nouveau format : on garde une copie des données d'avant.
            const backupKey = `${key}:avant-conversion-bulles`;
            if (!storage.getItem(backupKey)) storage.setItem(backupKey, raw);
            storage.setItem(key, JSON.stringify(parsed.data));
          }
          return parsed.data;
        }
      } catch {
        // JSON invalide : traité ci-dessous.
      }
      storage.setItem(`${key}:corrompu:${Date.now()}`, raw);
      storage.removeItem(key);
      return emptyWorkspace();
    },
    write(data) {
      storage.setItem(key, JSON.stringify(data));
    },
  };
}
