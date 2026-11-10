import { describe, expect, it } from "vitest";
import { crmFamilles, type CrmProduit } from "../supabase/crm";

let n = 0;
const produit = (categorie: string, overrides: Partial<CrmProduit> = {}): CrmProduit => ({
  id: `p${++n}`,
  restaurant_id: "mexico",
  categorie,
  nom: `Produit ${n}`,
  description: null,
  prix: 12,
  disponible: true,
  ordre: n,
  allergenes: null,
  allergenes_note: null,
  jours_dispo: null,
  ...overrides,
});

describe("crmFamilles", () => {
  it("une famille par catégorie, dans l'ordre de la carte, sans boissons ni produits indisponibles", () => {
    const produits = [
      produit("Bœuf"),
      produit("Poulet"),
      produit("Boissons"),
      produit("Bœuf"),
      produit("Végan"),
      produit("Desserts", { disponible: false }),
      produit("Poulet", { restaurant_id: "autre" }),
      produit("Softs"),
    ];
    expect(crmFamilles("mexico", produits).map((f) => f.titre)).toEqual(["Bœuf", "Poulet", "Végan"]);
  });

  it("famille servie certains jours seulement si TOUS ses produits le sont (CRM 0 = dimanche → 7)", () => {
    const produits = [
      produit("Agneau", { jours_dispo: [5, 6] }),
      produit("Agneau", { jours_dispo: [0, 5] }),
      produit("Poulet", { jours_dispo: [5] }),
      produit("Poulet"),
    ];
    expect(crmFamilles("mexico", produits)).toEqual([{ titre: "Agneau", jours: [5, 6, 7] }, { titre: "Poulet" }]);
  });
});
