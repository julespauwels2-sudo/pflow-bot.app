/**
 * Point d'accès unique aux données. L'interface ne change pas entre le stockage
 * du navigateur (étape A) et Supabase (étape B) : seule l'implémentation est remplacée.
 * Toutes les méthodes sont asynchrones pour cette raison.
 */
import type { InfoSheet } from "@/engine";
import type {
  BotClient,
  ClientPatch,
  FlowPatch,
  NewClient,
  NewFlow,
  StoredFlow,
  WorkspaceData,
} from "./types";

export interface ClientRepository {
  /**
   * Faux à l'étape B : les clients viennent du CRM (lecture seule), seuls
   * les réglages propres aux bots (fuseau…) restent modifiables ici.
   */
  readonly canManageClients: boolean;
  list(): Promise<BotClient[]>;
  get(id: string): Promise<BotClient | null>;
  create(input: NewClient): Promise<BotClient>;
  update(id: string, patch: ClientPatch): Promise<BotClient>;
  /** Supprime le client avec ses flux et sa fiche d'infos. */
  delete(id: string): Promise<void>;
}

export interface FlowRepository {
  listByClient(clientId: string): Promise<StoredFlow[]>;
  get(id: string): Promise<StoredFlow | null>;
  create(input: NewFlow): Promise<StoredFlow>;
  /** Modifie le brouillon (la version publiée n'est pas touchée). */
  update(id: string, patch: FlowPatch): Promise<StoredFlow>;
  /** Copie le brouillon dans la version publiée. */
  publish(id: string): Promise<StoredFlow>;
  delete(id: string): Promise<void>;
}

export interface InfoSheetRepository {
  get(clientId: string): Promise<InfoSheet>;
  save(clientId: string, sheet: InfoSheet): Promise<InfoSheet>;
}

/** Sauvegarde / restauration complète (utile tant que tout vit dans le navigateur). */
export interface WorkspaceRepository {
  exportAll(): Promise<WorkspaceData>;
  /** Remplace toutes les données. */
  importAll(data: WorkspaceData): Promise<void>;
}

export interface Repositories {
  clients: ClientRepository;
  flows: FlowRepository;
  infoSheets: InfoSheetRepository;
  workspace: WorkspaceRepository;
}

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}
