/** Cycle de vie des démos : qui est une démo, quelles démos sont actives (fonctions pures). */
import type { BotClient, DemoRecord, WorkspaceData } from "@/data/types";
import type { DemoDirectoryEntry } from "./router";

/**
 * Le resto est-il (encore) une démo ? Avec le CRM : son statut. En local (pas de statut) : la démo
 * a été démarrée à la main.
 */
export function isDemoClient(client: Pick<BotClient, "crmStatut">): boolean {
  return client.crmStatut === undefined || client.crmStatut === "demo";
}

/** Démo joignable par son mot-clé : pas supprimée, pas expirée. */
export function isDemoActive(demo: DemoRecord, now: Date): boolean {
  return !demo.deletedAt && Date.parse(demo.expiresAt) > now.getTime();
}

/** Démos du numéro PFlow, avec le nom du resto (pour l'aiguillage et les messages). */
export function demoDirectory(data: WorkspaceData): DemoDirectoryEntry[] {
  const names = new Map(data.clients.map((c) => [c.id, c.nomResto]));
  return data.demos.map((d) => ({ ...d, nomResto: names.get(d.clientId) ?? d.keyword }));
}
