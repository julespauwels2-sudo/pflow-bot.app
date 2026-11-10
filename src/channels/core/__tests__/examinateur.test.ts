/** Compte examinateur (examen Meta) : seulement les conversations du numéro PFlow (démos). */
import { describe, expect, it } from "vitest";
import { canauxVisibles } from "../api-helpers";

describe("boîte de réception d'un examinateur", () => {
  const canaux = [
    { canalId: "pflow", nomResto: "Numéro PFlow (démos)" },
    { canalId: "cookies", nomResto: "Cookies An Nou" },
    { canalId: "mexico", nomResto: "Mexico" },
  ];
  it("un administrateur voit tout ; un examinateur seulement le numéro PFlow", () => {
    expect(canauxVisibles("admin", canaux, new Set(["pflow"]))).toHaveLength(3);
    expect(canauxVisibles("examinateur", canaux, new Set(["pflow"])).map((c) => c.canalId)).toEqual(["pflow"]);
  });
  it("sans canal PFlow : rien", () => {
    expect(canauxVisibles("examinateur", canaux, new Set())).toEqual([]);
  });
});
