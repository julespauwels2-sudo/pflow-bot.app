import { describe, expect, it } from "vitest";
import { checkWhatsAppAccess, createGraphClient, graphErrorText } from "../graph";

type Call = { url: string; init?: RequestInit };

function fakeFetch(routes: Record<string, { status: number; body: unknown }>, calls: Call[]) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const key = Object.keys(routes).find((k) => u.includes(k));
    const r = key ? routes[key] : { status: 404, body: { error: { message: "inconnu" } } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const config = (f: typeof fetch) => ({ token: "jeton-secret", base: "https://graph.test", version: "v24.0", fetch: f });

describe("envoi WhatsApp : compte de messagerie", () => {
  it("ajoute messaging_account_id (le WABA du canal) au corps de l'envoi", async () => {
    const calls: Call[] = [];
    const graph = createGraphClient(config(fakeFetch({ "/messages": { status: 200, body: { messages: [{ id: "wamid.x" }] } } }, calls)));
    expect(await graph.send("111", "590690000001", { kind: "text", text: "Bonjour" }, { messagingAccountId: "222" })).toBe("wamid.x");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ messaging_product: "whatsapp", to: "590690000001", messaging_account_id: "222" });
    await graph.send("111", "590690000001", { kind: "text", text: "Bonjour" });
    expect(JSON.parse(String(calls[1].init?.body))).not.toHaveProperty("messaging_account_id");
  });

  it("texte d'erreur de Meta : message, sous-code, détail, trace", () => {
    expect(graphErrorText({ error: { message: "(#10) Viewer cannot access", code: 10, error_subcode: 2494, error_data: { details: "plus de détail" }, fbtrace_id: "Abc" } }))
      .toBe("(#10) Viewer cannot access [sous-code 2494 ; plus de détail ; trace Abc]");
    expect(graphErrorText({})).toBe("erreur inconnue");
  });
});

describe("test de l'accès du token (page État)", () => {
  it("lectures seules : numéro, compte, numéros, apps ; jamais d'envoi ni de token dans le résultat", async () => {
    const calls: Call[] = [];
    const steps = await checkWhatsAppAccess(
      config(fakeFetch({
        "/111?": { status: 200, body: { display_phone_number: "+1 555 186 2679", verified_name: "Test Number", quality_rating: "GREEN" } },
        "/222?": { status: 200, body: { id: "222", name: "Test WhatsApp Business Account", owner_business_info: { id: "999", name: "PFlow" } } },
        "/222/phone_numbers": { status: 200, body: { data: [{ id: "111", display_phone_number: "+1 555 186 2679" }] } },
        "/222/subscribed_apps": { status: 400, body: { error: { message: "(#10) Viewer cannot access", fbtrace_id: "T1" } } },
      }, calls)),
      "111",
      "222",
    );
    expect(calls.every((c) => !c.init?.method || c.init.method === "GET")).toBe(true);
    expect(steps.map((s) => s.ok)).toEqual([true, true, true, false]);
    expect(steps[1].detail).toContain("portefeuille propriétaire : PFlow (999)");
    expect(steps[3].detail).toBe("Refus de Meta (400) : (#10) Viewer cannot access [trace T1]");
    expect(JSON.stringify(steps)).not.toContain("jeton-secret");
  });
});
