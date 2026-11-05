/**
 * Lecture du CRM — LECTURE SEULE. Ce fichier ne reçoit qu'un DbReader (aucune méthode d'écriture)
 * et un test vérifie qu'il ne contient aucun appel d'écriture.
 *
 * Tables lues : restaurants, resto_modules, qg_zones_livraison, produits, groupes_options,
 * options, produits_groupes, paiement_restos (réglage « coupé » seulement).
 * Fonction lue : paiement_mode_public (mode de paiement en ligne en vigueur, lecture seule).
 */
import { DEFAULT_TIMEZONE, type InfoSheet, type IsoWeekday, type OnlinePayment, type OpeningDay } from "@/engine";
import type { DbReader } from "./db";

/** Statuts du CRM dont les restos apparaissent dans l'app bots (en plus de ceux qui ont un bot). */
export const VISIBLE_STATUTS = ["signe", "actif", "demo"] as const;

export interface CrmRestaurant {
  id: string;
  nom: string;
  slug: string | null;
  fuseau: string | null;
  statut: string;
  adresse: string | null;
  horaires: unknown;
  livraison: boolean | null;
  retrait: boolean | null;
  created_at: string;
}
export interface CrmZone {
  restaurant_id: string;
  nom: string;
  frais: number | string;
  minimum: number | string;
  ordre: number;
}
export interface CrmProduit {
  id: string;
  restaurant_id: string;
  categorie: string;
  nom: string;
  description: string | null;
  prix: number | string;
  disponible: boolean;
  ordre: number;
  allergenes: string[] | null;
  allergenes_note: string | null;
  jours_dispo: number[] | null;
}
export interface CrmGroupe {
  id: string;
  restaurant_id: string;
  nom: string;
  obligatoire: boolean;
  min_choix: number;
  max_choix: number | null;
  ordre: number;
}
export interface CrmOption {
  id: string;
  groupe_id: string;
  nom: string;
  prix_supplement: number | string;
  actif: boolean;
  ordre: number;
}
export interface CrmProduitGroupe {
  produit_id: string;
  groupe_id: string;
  ordre: number;
}

export interface CrmData {
  restaurants: CrmRestaurant[];
  /** Restos dont le module « relance » (paniers abandonnés) est actif. */
  relance: Set<string>;
  zones: CrmZone[];
  produits: CrmProduit[];
  groupes: CrmGroupe[];
  options: CrmOption[];
  produitsGroupes: CrmProduitGroupe[];
  /** Paiement en ligne en vigueur, par resto (absent si le CRM n'a pas pu le dire). */
  paiements: Map<string, OnlinePayment>;
}

/** Lit dans le CRM tout ce dont le bot a besoin, pour les restos visibles. */
export async function readCrm(db: DbReader, botRestaurantIds: string[]): Promise<CrmData> {
  const columns = "id, nom, slug, fuseau, statut, adresse, horaires, livraison, retrait, created_at";
  const [byStatut, byBot] = await Promise.all([
    db.select<CrmRestaurant & Record<string, unknown>>("restaurants", columns, { in: { column: "statut", values: [...VISIBLE_STATUTS] } }),
    db.select<CrmRestaurant & Record<string, unknown>>("restaurants", columns, { in: { column: "id", values: botRestaurantIds } }),
  ]);
  const restaurants = [...new Map([...byStatut, ...byBot].map((r) => [r.id, r])).values()];
  const ids = restaurants.map((r) => r.id);

  const [modules, zones, produits, groupes] = await Promise.all([
    db.select<{ restaurant_id: string; module: string; actif: boolean }>("resto_modules", "restaurant_id, module, actif", { in: { column: "restaurant_id", values: ids } }),
    db.select<CrmZone & Record<string, unknown>>("qg_zones_livraison", "restaurant_id, nom, frais, minimum, ordre", { in: { column: "restaurant_id", values: ids } }),
    db.select<CrmProduit & Record<string, unknown>>(
      "produits",
      "id, restaurant_id, categorie, nom, description, prix, disponible, ordre, allergenes, allergenes_note, jours_dispo",
      { in: { column: "restaurant_id", values: ids } },
    ),
    db.select<CrmGroupe & Record<string, unknown>>("groupes_options", "id, restaurant_id, nom, obligatoire, min_choix, max_choix, ordre", {
      in: { column: "restaurant_id", values: ids },
    }),
  ]);
  const paiements = await readOnlinePayments(db, ids);
  const groupIds = groupes.map((g) => g.id);
  const [options, produitsGroupes] = await Promise.all([
    db.select<CrmOption & Record<string, unknown>>("options", "id, groupe_id, nom, prix_supplement, actif, ordre", { in: { column: "groupe_id", values: groupIds } }),
    db.select<CrmProduitGroupe & Record<string, unknown>>("produits_groupes", "produit_id, groupe_id, ordre", { in: { column: "groupe_id", values: groupIds } }),
  ]);

  return {
    restaurants,
    relance: new Set(modules.filter((m) => m.module === "relance" && m.actif).map((m) => m.restaurant_id)),
    zones,
    produits,
    groupes,
    options,
    produitsGroupes,
    paiements,
  };
}

/**
 * Paiement en ligne de chaque resto : uniquement le mode réellement en vigueur (paiement_mode_public),
 * jamais la notion d'option vendue. « À configurer » : pas de paiement en ligne en vigueur alors que le
 * resto ne l'a pas coupé lui-même (aucun prestataire prêt, SumUp ou Stripe).
 */
async function readOnlinePayments(db: DbReader, ids: string[]): Promise<Map<string, OnlinePayment>> {
  const result = new Map<string, OnlinePayment>();
  if (!db.readFunction || !ids.length) return result;
  const reglages = await db.select<{ restaurant_id: string; mode: string } & Record<string, unknown>>("paiement_restos", "restaurant_id, mode", {
    in: { column: "restaurant_id", values: ids },
  });
  const coupe = new Set(reglages.filter((r) => r.mode === "coupe").map((r) => r.restaurant_id));
  await Promise.all(
    ids.map(async (rid) => {
      try {
        const value = await db.readFunction!<string>("paiement_mode_public", { rid });
        const mode = value === "choix" || value === "obligatoire" ? value : "non";
        result.set(rid, { mode, aConfigurer: mode === "non" && !coupe.has(rid) });
      } catch {
        // Fonction indisponible : on n'affiche rien plutôt qu'une information fausse.
      }
    }),
  );
  return result;
}

// ---------------------------------------------------------------------------
// Conversion vers le format du bot (fonctions pures, testées)
// ---------------------------------------------------------------------------

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Horaires du CRM : { jours: { "1": [["08:00", "12:00"]], … "7": [] } } (1 = lundi). */
export function crmOpeningHours(horaires: unknown): OpeningDay[] | null {
  if (!horaires || typeof horaires !== "object") return null;
  const jours = (horaires as { jours?: unknown }).jours;
  if (!jours || typeof jours !== "object") return null;
  const result: OpeningDay[] = [];
  for (const [key, ranges] of Object.entries(jours as Record<string, unknown>)) {
    const jour = Number(key);
    if (!Number.isInteger(jour) || jour < 1 || jour > 7 || !Array.isArray(ranges)) continue;
    const plages = ranges
      .filter((r): r is [string, string] => Array.isArray(r) && HHMM.test(String(r[0])) && HHMM.test(String(r[1])))
      .map(([de, a]) => ({ de, a }));
    if (plages.length) result.push({ jour: jour as IsoWeekday, plages });
  }
  return result.sort((a, b) => a.jour - b.jour);
}

export function formatEuros(value: number | string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${value} €`;
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} €`;
}

export function crmZonesText(zones: CrmZone[]): string {
  return [...zones]
    .sort((a, b) => a.ordre - b.ordre)
    .map((z) => {
      const frais = Number(z.frais) > 0 ? `livraison ${formatEuros(z.frais)}` : "livraison offerte";
      const minimum = Number(z.minimum) > 0 ? `, minimum de commande ${formatEuros(z.minimum)}` : "";
      return `• ${z.nom.trim()} : ${frais}${minimum}`;
    })
    .join("\n");
}

/** 0 = dimanche … 6 = samedi (convention du CRM). */
const JOURS_CRM = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** Codes des 14 allergènes réglementaires utilisés par le CRM. */
const ALLERGENES: Record<string, string> = {
  gluten: "Gluten",
  crustaces: "Crustacés",
  oeufs: "Œufs",
  poissons: "Poissons",
  arachides: "Arachides",
  soja: "Soja",
  lait: "Lait",
  fruits_coque: "Fruits à coque",
  celeri: "Céleri",
  moutarde: "Moutarde",
  sesame: "Sésame",
  sulfites: "Sulfites",
  lupin: "Lupin",
  mollusques: "Mollusques",
};

export function allergenLabel(code: string): string {
  const key = code.trim().toLowerCase();
  if (ALLERGENES[key]) return ALLERGENES[key];
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Carte lisible par l'IA, depuis les produits disponibles et leurs options. */
export function crmMenuText(restaurantId: string, data: Pick<CrmData, "produits" | "groupes" | "options" | "produitsGroupes">): string {
  const produits = data.produits.filter((p) => p.restaurant_id === restaurantId && p.disponible);
  if (!produits.length) return "";
  const groupes = new Map(data.groupes.filter((g) => g.restaurant_id === restaurantId).map((g) => [g.id, g]));
  const optionsOf = (groupeId: string) => data.options.filter((o) => o.groupe_id === groupeId && o.actif).sort((a, b) => a.ordre - b.ordre);

  const byCategory = new Map<string, CrmProduit[]>();
  for (const p of [...produits].sort((a, b) => a.ordre - b.ordre)) {
    const cat = p.categorie?.trim() || "Autres";
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), p]);
  }

  const lines = [
    "Prix en euros. « Allergènes : non renseignés » veut dire que le resto n'a pas donné l'information : ce n'est jamais « sans allergène ».",
  ];
  for (const [cat, list] of byCategory) {
    lines.push("", `== ${cat} ==`);
    for (const p of list) {
      lines.push(`• ${p.nom.trim()} : ${formatEuros(p.prix)}`);
      if (p.description?.trim()) lines.push(p.description.trim());
      const linked = data.produitsGroupes
        .filter((pg) => pg.produit_id === p.id && groupes.has(pg.groupe_id))
        .sort((a, b) => a.ordre - b.ordre)
        .map((pg) => groupes.get(pg.groupe_id)!);
      for (const g of linked) {
        const choices = optionsOf(g.id).map((o) => (Number(o.prix_supplement) > 0 ? `${o.nom} (+${formatEuros(o.prix_supplement)})` : o.nom));
        if (choices.length) lines.push(`${g.nom}${g.obligatoire ? " (au choix)" : " (en option)"} : ${choices.join(", ")}`);
      }
      if (p.jours_dispo?.length) {
        // Dans l'ordre de la semaine, du lundi au dimanche.
        const days = [...p.jours_dispo].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
        lines.push(`Disponible seulement le ${days.map((d) => JOURS_CRM[d] ?? String(d)).join(", le ")}`);
      }
      const allergenes = p.allergenes?.filter((a) => a.trim()).map(allergenLabel) ?? [];
      lines.push(`Allergènes : ${allergenes.length ? allergenes.join(", ") : "non renseignés"}${p.allergenes_note?.trim() ? ` (${p.allergenes_note.trim()})` : ""}`);
    }
  }
  return lines.join("\n");
}

/** Champs de la fiche d'infos qui viennent du CRM (affichés en lecture seule). */
export type CrmSheetField = "horaires" | "adresse" | "livraison" | "retrait" | "zonesLivraison" | "resumeCarte" | "paiementEnLigne";

export function crmInfoSheet(restaurant: CrmRestaurant, data: CrmData): { sheet: Partial<InfoSheet>; locked: CrmSheetField[] } {
  const sheet: Partial<InfoSheet> = {};
  const locked: CrmSheetField[] = [];
  const horaires = crmOpeningHours(restaurant.horaires);
  if (horaires) {
    sheet.horaires = horaires;
    locked.push("horaires");
  }
  if (restaurant.adresse?.trim()) {
    sheet.adresse = restaurant.adresse.trim();
    locked.push("adresse");
  }
  if (restaurant.livraison !== null) {
    sheet.livraison = Boolean(restaurant.livraison);
    locked.push("livraison");
  }
  if (restaurant.retrait !== null) {
    sheet.retrait = Boolean(restaurant.retrait);
    locked.push("retrait");
  }
  const zones = data.zones.filter((z) => z.restaurant_id === restaurant.id);
  if (zones.length) {
    sheet.zonesLivraison = crmZonesText(zones);
    locked.push("zonesLivraison");
  }
  const paiement = data.paiements?.get(restaurant.id);
  if (paiement) {
    sheet.paiementEnLigne = paiement;
    locked.push("paiementEnLigne");
  }
  const menu = crmMenuText(restaurant.id, data);
  if (menu) {
    sheet.resumeCarte = menu;
    locked.push("resumeCarte");
  }
  return { sheet, locked };
}

export function crmTimezone(restaurant: CrmRestaurant): string {
  return restaurant.fuseau?.trim() || DEFAULT_TIMEZONE;
}
