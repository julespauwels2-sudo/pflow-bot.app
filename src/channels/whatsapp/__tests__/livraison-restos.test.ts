import { describe, expect, it } from "vitest";
import { canauxAvecLivraison, optionsLivraison } from "../livraison-restos";
import { READ_ONLY_FUNCTIONS } from "@/data/supabase/db";

describe("modèles de la livraison : seulement les restos avec l'option (demande de Jules du 23/11)", () => {
  it("option lue dans page_livraison(slug) : active, inactive, ou inconnue (pas de slug, erreur, réponse étrange)", async () => {
    const lus: string[] = [];
    const lire = async (slug: string) => {
      lus.push(slug);
      if (slug === "panne") throw new Error("fonction absente");
      if (slug === "bizarre") return null;
      return { actif: slug === "bokit" };
    };
    const r = await optionsLivraison(lire, new Map<string, string | undefined>([["r1", "bokit"], ["r2", "ag-pizza"], ["r3", undefined], ["r4", "panne"], ["r5", "bizarre"]]));
    expect(Object.fromEntries(r)).toEqual({ r1: "active", r2: "inactive", r3: "inconnue", r4: "inconnue", r5: "inconnue" });
    expect(lus.sort()).toEqual(["ag-pizza", "bizarre", "bokit", "panne"]);
    // Sans lecture possible (mode mémoire) : tout est « inconnue », donc rien n'est caché.
    expect(Object.fromEntries(await optionsLivraison(undefined, new Map([["r1", "bokit"]])))).toEqual({ r1: "inconnue" });
  });

  it("seuls les restos SANS l'option sont mis à part ; le numéro PFlow (démos) et les options inconnues restent", () => {
    const canaux = [
      { id: "a", role: "resto" as const, restaurantId: "r1" },
      { id: "b", role: "resto" as const, restaurantId: "r2" },
      { id: "c", role: "pflow" as const, restaurantId: "" },
      { id: "d", restaurantId: "r3" },
    ];
    const { avec, sans } = canauxAvecLivraison(canaux, new Map([["r1", "active"], ["r2", "inactive"], ["r3", "inconnue"]]));
    expect(avec.map((c) => c.id)).toEqual(["a", "c", "d"]);
    expect(sans.map((c) => c.id)).toEqual(["b"]);
  });

  it("page_livraison est dans la liste des fonctions de lecture autorisées", () => {
    expect(READ_ONLY_FUNCTIONS).toContain("page_livraison");
  });
});
