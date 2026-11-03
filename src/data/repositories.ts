/**
 * Point d'accès unique aux données. L'interface ne change pas entre le stockage
 * du navigateur (étape A) et Supabase (étape B) : seule l'implémentation est remplacée.
 * Toutes les méthodes sont asynchrones pour cette raison.
 */
import type { InfoSheet } from "@/engine";
import type {
  BotClient,
  BotFolder,
  BotTemplate,
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
  /** Flux d'un client ou du modèle maître. */
  listByOwner(ownerId: string): Promise<StoredFlow[]>;
  get(id: string): Promise<StoredFlow | null>;
  create(input: NewFlow): Promise<StoredFlow>;
  /** Modifie le brouillon (la version publiée n'est pas touchée). */
  update(id: string, patch: FlowPatch): Promise<StoredFlow>;
  /** Copie le brouillon dans la version publiée. */
  publish(id: string): Promise<StoredFlow>;
  delete(id: string): Promise<void>;
}

/** Lien entre un bot client et le modèle maître (opérations atomiques). */
export interface BotRepository {
  /** « Créer le bot depuis le modèle » : relie le client au modèle (rien n'est copié). */
  link(clientId: string, templateId: string): Promise<BotClient>;
  /** Copie un flux publié du modèle chez ce client ; la copie le remplace pour lui seul (publiée). */
  personalize(clientId: string, templateFlowId: string): Promise<StoredFlow>;
  /** « Revenir au modèle » : supprime la copie personnalisée. */
  revert(flowId: string): Promise<void>;
  /**
   * « Détacher » : copie chez le client tous les flux du modèle non personnalisés, transforme les
   * personnalisations en flux normaux, remet les « Aller à un flux » sur les copies, et coupe le lien.
   */
  detach(clientId: string): Promise<void>;
}

export interface TemplateRepository {
  list(): Promise<BotTemplate[]>;
  get(id: string): Promise<BotTemplate | null>;
  create(input: { name: string }): Promise<BotTemplate>;
  rename(id: string, name: string): Promise<BotTemplate>;
}

export interface FolderRepository {
  /** Dossiers d'un propriétaire (client), dans l'ordre d'affichage. */
  listByOwner(ownerId: string): Promise<BotFolder[]>;
  create(input: { ownerId: string; name: string }): Promise<BotFolder>;
  rename(id: string, name: string): Promise<BotFolder>;
  /** Monte (-1) ou descend (+1) le dossier. */
  move(id: string, delta: -1 | 1): Promise<void>;
  /** Supprime le dossier ; ses flux passent dans « Sans dossier » (jamais supprimés). */
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
  folders: FolderRepository;
  templates: TemplateRepository;
  bots: BotRepository;
  infoSheets: InfoSheetRepository;
  workspace: WorkspaceRepository;
}

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}
