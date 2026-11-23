/**
 * Quels restos ont l'option livraison PFlow (demande de Jules du 23/11) : les modèles WhatsApp de la livraison ne sont
 * créés que sur leurs comptes. Lecture seule dans le CRM : la fonction publique page_livraison(slug) (qg83), celle de la
 * page de commande ; « actif » = option activée, compte Stripe prêt, zone ouverte.
 */
import type { Canal } from "../core/types";

/** active : option en place ; inactive : pas d'option ; inconnue : pas de slug, ou lecture impossible. */
export type OptionLivraison = "active" | "inactive" | "inconnue";

export type LirePageLivraison = (slug: string) => Promise<unknown>;

export async function optionsLivraison(lire: LirePageLivraison | undefined, slugs: Map<string, string | undefined>): Promise<Map<string, OptionLivraison>> {
  const result = new Map<string, OptionLivraison>();
  await Promise.all(
    [...slugs].map(async ([rid, slug]) => {
      if (!lire || !slug) return void result.set(rid, "inconnue");
      try {
        const page = (await lire(slug)) as { actif?: unknown } | null;
        result.set(rid, page && typeof page === "object" && "actif" in page ? (page.actif === true ? "active" : "inactive") : "inconnue");
      } catch {
        // Fonction indisponible : on ne cache rien (mieux vaut un compte de trop qu'un resto oublié).
        result.set(rid, "inconnue");
      }
    }),
  );
  return result;
}

/**
 * Les comptes qui ont besoin des modèles : le numéro PFlow (démos) et les restos avec l'option (ou inconnue) ; les
 * autres sont mis à part (affichés par leur nom seulement, sans lecture chez Meta).
 */
export function canauxAvecLivraison<C extends Pick<Canal, "role" | "restaurantId">>(canaux: C[], options: Map<string, OptionLivraison>): { avec: C[]; sans: C[] } {
  const avec: C[] = [];
  const sans: C[] = [];
  for (const c of canaux) {
    if ((c.role ?? "resto") === "resto" && options.get(c.restaurantId) === "inactive") sans.push(c);
    else avec.push(c);
  }
  return { avec, sans };
}
