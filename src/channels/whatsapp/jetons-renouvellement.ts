/**
 * Jetons Meta des clients (Embedded Signup) : la configuration de PFlow (modèle Meta « inscription intégrée avec un
 * jeton d'expiration de 60 jours ») donne un jeton d'utilisateur système d'intégration métier qui expire au bout de
 * 60 jours. Chaque jour (Vercel Cron, /api/cron/jetons), les jetons qui expirent dans moins de RENOUVELER_JOURS
 * sont renouvelés (nouveau jeton de 60 jours, l'ancien reste valable jusqu'à sa propre échéance). En cas d'échec :
 * erreur gardée, affichée sur la page État avec un lien de reconnexion à envoyer au resto.
 */
import type { ConnexionStore, JetonStocke } from "@/channels/core/connexions";
import { echeanceJeton, renouvelerJeton, type MetaAppConfig } from "./embedded-signup";

/** Renouvelé quand il reste moins de 20 jours : 19 essais quotidiens avant l'échéance si Meta refuse. */
export const RENOUVELER_JOURS = 20;
/** Alerte sur la page État quand il reste moins de 10 jours (le renouvellement échoue depuis 10 jours). */
export const ALERTE_JOURS = 10;

export type EtatJeton = "ok" | "a_renouveler" | "bientot" | "expire" | "jamais" | "inconnu";

export function etatJeton(j: Pick<JetonStocke, "expireLe" | "nExpirePas">, now: Date): { etat: EtatJeton; joursRestants: number | null } {
  if (j.nExpirePas) return { etat: "jamais", joursRestants: null };
  if (!j.expireLe) return { etat: "inconnu", joursRestants: null };
  const jours = Math.floor((Date.parse(j.expireLe) - now.getTime()) / 86_400_000);
  if (jours < 0) return { etat: "expire", joursRestants: jours };
  if (jours < ALERTE_JOURS) return { etat: "bientot", joursRestants: jours };
  if (jours < RENOUVELER_JOURS) return { etat: "a_renouveler", joursRestants: jours };
  return { etat: "ok", joursRestants: jours };
}

export interface RenouvellementDeps {
  meta: MetaAppConfig;
  connexions: Pick<ConnexionStore, "listJetons" | "majJeton">;
  chiffrer: (jeton: string) => string;
  dechiffrer: (stocke: string) => string;
  now?: () => Date;
  /** Renouveler ces comptes tout de suite, quelle que soit l'échéance (bouton « Renouveler maintenant » de la page État). */
  forcer?: string[];
}

export interface RenouvellementRapport {
  verifies: number;
  echeancesTrouvees: number;
  renouveles: number;
  echecs: { wabaId: string; erreur: string }[];
}

export async function renouvelerJetons(deps: RenouvellementDeps): Promise<RenouvellementRapport> {
  const now = () => (deps.now ? deps.now() : new Date());
  const rapport: RenouvellementRapport = { verifies: 0, echeancesTrouvees: 0, renouveles: 0, echecs: [] };
  for (const j of (await deps.connexions.listJetons()).filter((x) => !deps.forcer || deps.forcer.includes(x.wabaId))) {
    rapport.verifies++;
    let token: string;
    try {
      token = deps.dechiffrer(j.chiffre);
    } catch {
      rapport.echecs.push({ wabaId: j.wabaId, erreur: "jeton illisible (BOT_JETONS_CLE)" });
      continue;
    }
    try {
      // Échéance inconnue (jeton gardé avant la migration) : on la demande à Meta.
      let expiration = { expireLe: j.expireLe, nExpirePas: j.nExpirePas };
      if (!j.expireLe && !j.nExpirePas) {
        const e = await echeanceJeton(deps.meta, token, undefined, now());
        expiration = { expireLe: e.expireLe, nExpirePas: e.nExpirePas };
        await deps.connexions.majJeton(j.wabaId, { expiration });
        rapport.echeancesTrouvees++;
      }
      const { etat } = etatJeton(expiration, now());
      if ((etat === "ok" || etat === "jamais") && !deps.forcer) continue;
      // Expiré : Meta refusera ; on essaie quand même (une seule requête), l'erreur part sur la page État.
      const r = await renouvelerJeton(deps.meta, token);
      const e = await echeanceJeton(deps.meta, r.token, r.expiresIn, now());
      await deps.connexions.majJeton(j.wabaId, {
        chiffre: deps.chiffrer(r.token),
        expiration: { expireLe: e.expireLe, nExpirePas: e.nExpirePas },
        renouveleLe: now().toISOString(),
        erreur: null,
      });
      rapport.renouveles++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      rapport.echecs.push({ wabaId: j.wabaId, erreur: message });
      await deps.connexions.majJeton(j.wabaId, { erreur: message }).catch(() => {});
    }
  }
  return rapport;
}
