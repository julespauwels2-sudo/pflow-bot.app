/**
 * Création automatique des bots (étape B) : tout resto du CRM en statut signé, actif ou démo reçoit
 * son bot, lié au modèle maître, sans clic. Écrit seulement dans bot_clients (via bots.link).
 * Un resto qui a déjà une ligne bot_clients (bot existant, détaché ou désactivé) n'est jamais touché.
 */
import type { Repositories } from "./repositories";
import { VISIBLE_STATUTS } from "./supabase/crm";

export interface AutoBotsResult {
  linked: { id: string; nomResto: string }[];
  /** Raison si rien n'a pu être fait (ex. pas de modèle maître). */
  skipped?: string;
}

export async function autoLinkBots(repos: Repositories): Promise<AutoBotsResult> {
  const template = (await repos.templates.list())[0];
  if (!template) return { linked: [], skipped: "Pas encore de modèle maître : les bots seront créés dès qu'il existera." };
  const statuts = new Set<string>(VISIBLE_STATUTS);
  const linked: AutoBotsResult["linked"] = [];
  for (const client of await repos.clients.list()) {
    if (!client.crmStatut || !statuts.has(client.crmStatut)) continue;
    if (client.hasBotRecord || client.template || client.botDisabledAt) continue;
    await repos.bots.link(client.id, template.id);
    linked.push({ id: client.id, nomResto: client.nomResto });
  }
  return { linked };
}
