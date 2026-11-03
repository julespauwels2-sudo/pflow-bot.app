import { describe, expect, it } from "vitest";
import { checkBasicAuth, safeEqual } from "../basic-auth";

/** En-tête tel qu'un navigateur l'envoie (UTF-8 puis base64). */
const header = (user: string, password: string) =>
  `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${password}`)))}`;
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

  it("sans BASIC_AUTH_USER : n'importe quel nom, seul le mot de passe compte", () => {
    const onlyPassword = { password: "s3cret", isProduction: true };
    expect(checkBasicAuth(header("jules", "s3cret"), onlyPassword)).toBe("allow");
    expect(checkBasicAuth(header("", "s3cret"), onlyPassword)).toBe("allow");
    expect(checkBasicAuth(header("n'importe", "s3cret"), onlyPassword)).toBe("allow");
    expect(checkBasicAuth(header("jules", "faux"), onlyPassword)).toBe("challenge");
    expect(checkBasicAuth(header("jules", "s3cret"), { ...onlyPassword, user: "  " })).toBe("allow");
  });

  it("mot de passe avec accents", () => {
    const accents = { password: "Café-Pointe-à-Pitre", isProduction: true };
    expect(checkBasicAuth(header("x", "Café-Pointe-à-Pitre"), accents)).toBe("allow");
    expect(checkBasicAuth(header("x", "Cafe-Pointe-a-Pitre"), accents)).toBe("challenge");
  });

  it("ignore les espaces et retours à la ligne collés dans les variables d'environnement", () => {
    expect(checkBasicAuth(header("jules", "s3cret"), { user: " jules\n", password: "s3cret\n", isProduction: true })).toBe("allow");
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
