import { describe, expect, it } from "vitest";
import { checkBasicAuth, safeEqual } from "../basic-auth";

const header = (user: string, password: string) => `Basic ${btoa(`${user}:${password}`)}`;
const config = { user: "jules", password: "s3cret:avec:deux-points", isProduction: true };

describe("protection par mot de passe", () => {
  it("accepte les bons identifiants", () => {
    expect(checkBasicAuth(header("jules", "s3cret:avec:deux-points"), config)).toBe("allow");
  });

  it("refuse un mauvais mot de passe ou un en-tête absent", () => {
    expect(checkBasicAuth(header("jules", "faux"), config)).toBe("challenge");
    expect(checkBasicAuth(header("autre", "s3cret:avec:deux-points"), config)).toBe("challenge");
    expect(checkBasicAuth(null, config)).toBe("challenge");
    expect(checkBasicAuth("Basic !!!", config)).toBe("challenge");
  });

  it("bloque tout en production si aucun mot de passe n'est configuré", () => {
    expect(checkBasicAuth(null, { isProduction: true })).toBe("not_configured");
    expect(checkBasicAuth(null, { isProduction: false })).toBe("allow");
  });

  it("comparaison en temps constant", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
