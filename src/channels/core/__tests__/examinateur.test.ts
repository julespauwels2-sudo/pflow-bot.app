/** Compte examinateur (examen Meta) : seulement les conversations du numéro PFlow (démos). */
import { describe, expect, it } from "vitest";
import { canauxPermis, canauxVisibles } from "../api-helpers";
import type { Canal } from "../types";

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

describe("boîte de réception d'un resto (compte du CRM)", () => {
  const canal = (id: string, restaurantId: string, role: "resto" | "pflow" = "resto") =>
    ({ id, restaurantId, role, plateforme: "whatsapp", accountId: id, etat: "actif", modeDeclenchement: "toujours" }) as unknown as Canal;
  const canaux = [canal("pflow", "", "pflow"), canal("bunbo-wa", "bunbo"), canal("bunbo-ig", "bunbo"), canal("mexico-wa", "mexico")];
  it("ne voit que les numéros de ses restos, jamais le numéro PFlow", () => {
    expect([...canauxPermis(canaux, { role: "resto", restaurantIds: ["bunbo"] })]).toEqual(["bunbo-wa", "bunbo-ig"]);
  });
  it("sans resto : rien", () => {
    expect(canauxPermis(canaux, { role: "resto", restaurantIds: [] }).size).toBe(0);
  });
  it("examinateur : le numéro PFlow seulement ; admin : tout", () => {
    expect([...canauxPermis(canaux, { role: "examinateur" })]).toEqual(["pflow"]);
    expect(canauxPermis(canaux, { role: "admin" }).size).toBe(4);
  });
  it("la liste filtrée avec ces numéros", () => {
    const liste = [{ canalId: "bunbo-wa" }, { canalId: "mexico-wa" }];
    expect(canauxVisibles("resto", liste, canauxPermis(canaux, { role: "resto", restaurantIds: ["bunbo"] }))).toEqual([{ canalId: "bunbo-wa" }]);
  });
});
