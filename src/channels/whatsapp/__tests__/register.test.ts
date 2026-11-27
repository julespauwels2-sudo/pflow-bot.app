import { describe, expect, it } from "vitest";
import { registerPhoneNumber } from "../graph";

function fakeFetch(status: number, json: unknown, calls: { url: string; init?: RequestInit }[]) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
}

describe("registerPhoneNumber", () => {
  it("envoie le PIN au bon numéro et renvoie ok", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const r = await registerPhoneNumber({ token: "T", base: "https://graph.test/", version: "v24.0", fetch: fakeFetch(200, { success: true }, calls) }, "123456789012345", "246810");
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe("https://graph.test/v24.0/123456789012345/register");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ messaging_product: "whatsapp", pin: "246810" });
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe("Bearer T");
  });

  it("refuse un PIN qui n'a pas 6 chiffres sans appeler Meta", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const r = await registerPhoneNumber({ token: "T", base: "https://g", version: "v24.0", fetch: fakeFetch(200, {}, calls) }, "123456789", "12a4");
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("refuse un identifiant de numéro non numérique", async () => {
    const r = await registerPhoneNumber({ token: "T", base: "https://g", version: "v24.0", fetch: fakeFetch(200, {}, []) }, "+590 590", "123456");
    expect(r.ok).toBe(false);
  });

  it("remonte le refus de Meta", async () => {
    const r = await registerPhoneNumber({ token: "T", base: "https://g", version: "v24.0", fetch: fakeFetch(400, { error: { message: "Phone number not verified", code: 100 } }, []) }, "123456789", "123456");
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("400");
  });
});
