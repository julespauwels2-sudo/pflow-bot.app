import { describe, expect, it } from "vitest";
import { createContactToken, readContactToken } from "../contact-token";

describe("jeton de pré-remplissage", () => {
  const now = 1_762_300_000;
  it("se relit avec le bon secret et le bon resto, sans numéro en clair", () => {
    const token = createContactToken({ tel: "590690123456", prenom: "Léa", slug: "cookies-an-nou" }, "secret", now);
    expect(token).not.toContain("590690123456");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(readContactToken(token, "secret", "cookies-an-nou", now + 60)).toEqual({ tel: "590690123456", prenom: "Léa", slug: "cookies-an-nou" });
  });

  it("refusé : autre resto, mauvais secret, expiré (2 h), altéré", () => {
    const token = createContactToken({ tel: "590690123456", slug: "cookies-an-nou" }, "secret", now);
    expect(readContactToken(token, "secret", "mexico", now)).toBeNull();
    expect(readContactToken(token, "autre", "cookies-an-nou", now)).toBeNull();
    expect(readContactToken(token, "secret", "cookies-an-nou", now + 2 * 3600 + 1)).toBeNull();
    expect(readContactToken(`${token.slice(0, -2)}AA`, "secret", "cookies-an-nou", now)).toBeNull();
    expect(readContactToken("n'importe quoi", "secret", "cookies-an-nou", now)).toBeNull();
  });
});
