/**
 * Création automatique des bots (étape B) : tout resto du CRM en statut signé, actif ou démo reçoit
 * son bot, lié au modèle maître, sans clic. Écrit seulement dans les tables bot_.
 * Un resto qui a déjà une ligne bot_clients (bot existant, détaché ou désactivé) n'est jamais touché.
 *
 * Démos (numéro PFlow) : un resto en démo reçoit aussi sa démo (mot-clé = son nom, 5 jours). Une démo
 * expirée voit son bot supprimé (données bot_ seulement) et n'est jamais recréée tant que le resto reste
 * en démo ; s'il passe signé ou actif, il garde (ou reçoit) son bot client.
 */
import type { Repositories } from "./repositories";
import { VISIBLE_STATUTS } from "./supabase/crm";

export interface AutoBotsResult {
  linked: { id: string; nomResto: string }[];
  /** Démos créées, et démos expirées dont le bot vient d'être supprimé. */
  demosStarted?: string[];
  demosDeleted?: string[];
  /** Raison si rien n'a pu être fait (ex. pas de modèle maître). */
  skipped?: string;
}

export async function autoLinkBots(repos: Repositories): Promise<AutoBotsResult> {
  const demosOn = await repos.demos.available();
  // D'abord les démos expirées (sinon un bot à supprimer serait compté comme lié).
  const purge = demosOn ? await repos.demos.purgeExpired() : { deleted: [], converted: [] };

  const template = (await repos.templates.list())[0];
  if (!template) return { linked: [], skipped: "Pas encore de modèle maître : les bots seront créés dès qu'il existera." };
  const statuts = new Set<string>(VISIBLE_STATUTS);
  const demos = new Map((await repos.demos.list()).map((d) => [d.clientId, d]));
  const linked: AutoBotsResult["linked"] = [];
  const demosStarted: string[] = [];
  for (const client of await repos.clients.list()) {
    if (!client.crmStatut || !statuts.has(client.crmStatut)) continue;
    const isDemo = client.crmStatut === "demo";
    const demo = demos.get(client.id);
    // Démo terminée (bot supprimé) : jamais recréée tant que le resto reste en démo.
    if (isDemo && demo?.deletedAt) continue;
    if (!(client.hasBotRecord || client.template || client.botDisabledAt)) {
      await repos.bots.link(client.id, template.id);
      linked.push({ id: client.id, nomResto: client.nomResto });
    }
    // Démo à démarrer : resto en démo avec un bot lié, sans démo en cours.
    if (isDemo && demosOn && !demo && !client.botDisabledAt) {
      await repos.demos.start(client.id);
      demosStarted.push(client.id);
    }
  }
  return {
    linked,
    ...(demosStarted.length ? { demosStarted } : {}),
    ...(purge.deleted.length ? { demosDeleted: purge.deleted } : {}),
  };
}
