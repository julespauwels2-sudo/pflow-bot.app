/** Diagnostic des comptes WhatsApp (page État) : lecture seule, faux Meta, jamais de token dans le résultat. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { canalInsertSql, diagnoseWhatsAppAccounts, guessRestaurant, parseSaisis, restoParNom } from "../diagnostic";

const TOKEN = "EAAG-jeton-secret-du-serveur";

/** Faux Meta : le nouveau modèle de comptes (le WABA refuse, le compte de messagerie répond). */
function fakeMeta() {
  const calls: { method: string; url: string }[] = [];
  const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? "GET", url });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    const path = url.replace(/^https:\/\/graph\.test\/v24\.0\//, "");
    if (path.startsWith("debug_token")) {
      return json(200, { data: { granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["1808772226929443", "4170754433058228", "9000000000000001", "9000000000000002"] }, { scope: "whatsapp_business_messaging", target_ids: ["4170754433058228"] }, { scope: "business_management", target_ids: ["555"] }] } });
    }
    if (path.startsWith("1808772226929443")) return json(400, { error: { message: "Invalid WhatsApp account usage", code: 100, error_subcode: 2388339 } });
    if (path === "4170754433058228") return json(200, { id: "4170754433058228", name: "Application WhatsApp Business" });
    if (path.startsWith("4170754433058228/phone_numbers")) return json(200, { data: [{ id: "1284474614757490", display_phone_number: "+590 691 26 68 53", verified_name: "PFlow", quality_rating: "GREEN", status: "CONNECTED", platform_type: "CLOUD_API", is_on_biz_app: true }] });
    if (path.startsWith("4170754433058228/subscribed_apps")) return json(200, { data: [{ whatsapp_business_api_data: { name: "PFlow Bots", id: "1" } }, { whatsapp_business_api_data: { name: "UChat", id: "2" } }] });
    if (path === "9000000000000001") return json(200, { id: "9000000000000001", name: "Cookies An Nou" });
    if (path.startsWith("9000000000000001/phone_numbers")) return json(200, { data: [{ id: "111", display_phone_number: "+590 690 11 11 11", verified_name: "Cookies An Nou", quality_rating: "GREEN", status: "CONNECTED", platform_type: "CLOUD_API", is_on_biz_app: true }] });
    if (path.startsWith("9000000000000001/subscribed_apps")) return json(200, { data: [{ whatsapp_business_api_data: { name: "UChat" } }] });
    if (path === "9000000000000002") return json(200, { id: "9000000000000002", name: "ag_pizzaa" });
    // Champs facultatifs refusés : relecture sans eux.
    if (path.startsWith("9000000000000002/phone_numbers") && path.includes("is_on_biz_app")) return json(400, { error: { message: "(#100) Invalid parameter", code: 100 } });
    if (path.startsWith("9000000000000002/phone_numbers")) return json(200, { data: [{ id: "222", display_phone_number: "+590 690 90 43 90", verified_name: "AG Pizza", status: "CONNECTED" }] });
    if (path.startsWith("9000000000000002/subscribed_apps")) return json(200, { data: [] });
    return json(404, { error: { message: "inconnu" } });
  }) as typeof fetch;
  return { calls, doFetch };
}

afterEach(() => vi.restoreAllMocks());

describe("diagnostic des comptes WhatsApp", () => {
  it("comptes attribués au token, numéros (statut, qualité, coexistence), apps abonnées ; nouveau modèle de comptes compris", async () => {
    const meta = fakeMeta();
    const result = await diagnoseWhatsAppAccounts(
      { token: TOKEN, base: "https://graph.test", version: "v24.0", fetch: meta.doFetch },
      { accountIds: ["4170754433058228", "1808772226929443"], canaux: [{ id: "canal-pflow", etat: "actif", compteId: "1284474614757490" }] },
    );
    expect(result.erreurs).toEqual([]);
    const ids = result.comptes.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["4170754433058228", "9000000000000001", "9000000000000002", "1808772226929443"]));
    expect(ids).not.toContain("555"); // portée business_management : pas un compte WhatsApp
    const demo = result.comptes.find((c) => c.id === "4170754433058228")!;
    expect(demo).toMatchObject({ nom: "Application WhatsApp Business", apps: ["PFlow Bots", "UChat"] });
    expect(demo.numeros[0]).toEqual({ id: "1284474614757490", affichage: "+590 691 26 68 53", nomVerifie: "PFlow", qualite: "GREEN", statut: "CONNECTED", plateforme: "CLOUD_API", coexistence: true, canal: { id: "canal-pflow", etat: "actif" } });
    expect(result.comptes.find((c) => c.id === "1808772226929443")!.erreurs[0]).toContain("nouveau modèle");
    // Champs refusés : relu sans eux (coexistence inconnue).
    const ag = result.comptes.find((c) => c.id === "9000000000000002")!;
    expect(ag.numeros[0]).toMatchObject({ id: "222", statut: "CONNECTED" });
    expect(ag.numeros[0].coexistence).toBeUndefined();
    // Lecture seule : uniquement des GET ; le jeton n'apparaît jamais dans le résultat.
    expect(meta.calls.every((c) => c.method === "GET")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("SQL du canal en test proposé, avec le bon resto (nom) et le compte de messagerie qui répond ; rien d'appliqué", async () => {
    const meta = fakeMeta();
    const result = await diagnoseWhatsAppAccounts({ token: TOKEN, base: "https://graph.test", version: "v24.0", fetch: meta.doFetch }, { accountIds: [], canaux: [] });
    const cookies = result.comptes.find((c) => c.id === "9000000000000001")!;
    const restos = [
      { id: "f610eae4-84f4-4a81-bccf-9963a65e0bf7", nom: "Cookies An Nou" },
      { id: "9e3dfdce-afdd-448d-b57a-74656ce7fa89", nom: "ag_pizzaa" },
      { id: "21aa4b81-8464-4b56-97a1-bdc782d0bc22", nom: "Mexico" },
    ];
    const resto = guessRestaurant(cookies.numeros[0], restos);
    expect(resto?.id).toBe("f610eae4-84f4-4a81-bccf-9963a65e0bf7");
    expect(guessRestaurant({ id: "x", nomVerifie: "Mexico Sainte-Rose" }, restos)?.nom).toBe("Mexico");
    expect(guessRestaurant({ id: "x", nomVerifie: "Inconnu" }, restos)).toBeNull();
    const sql = canalInsertSql({ restaurant: resto, compte: cookies, numero: cookies.numeros[0], mode: "toujours", testNumero: "590690938108" });
    expect(sql).toContain("('f610eae4-84f4-4a81-bccf-9963a65e0bf7', 'resto', 'whatsapp', '111', null, '9000000000000001',");
    expect(sql).toContain("'+590 690 11 11 11 (Cookies An Nou)', 'toujours', true, 'test', array['590690938108'])");
    expect(sql.startsWith("insert into public.bot_canaux")).toBe(true);
  });

  it("droits du token illisibles : secours par les comptes de l'entreprise", async () => {
    const calls: string[] = [];
    const doFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (url.includes("debug_token")) return json(400, { error: { message: "app token required", code: 100 } });
      if (url.includes("me/businesses")) return json(200, { data: [{ id: "777", name: "PFlow 1" }] });
      if (url.includes("777/owned_whatsapp_business_accounts")) return json(200, { data: [{ id: "4170754433058228" }] });
      if (url.includes("777/client_whatsapp_business_accounts")) return json(200, { data: [] });
      if (url.endsWith("/4170754433058228")) return json(200, { name: "Compte" });
      return json(200, { data: [] });
    }) as typeof fetch;
    const result = await diagnoseWhatsAppAccounts({ token: TOKEN, base: "https://graph.test", version: "v24.0", fetch: doFetch }, { accountIds: [], canaux: [] });
    expect(result.erreurs[0]).toContain("debug_token");
    expect(result.comptes.map((c) => c.id)).toEqual(["4170754433058228"]);
    expect(result.comptes[0].origine).toEqual(["détenu par l'entreprise"]);
  });
});

describe("comptes saisis à la main (token sans business_management)", () => {
  it("IDs relevés dans Business Manager : lus directement ; le nom saisi désigne le resto du SQL", async () => {
    expect(parseSaisis("1120744623676139 ag pizza\n1678321033943134 : Mexico, 2577158539379673\nn'importe quoi\n12")).toEqual([
      { id: "1120744623676139", resto: "ag pizza" },
      { id: "1678321033943134", resto: "Mexico" },
      { id: "2577158539379673" },
    ]);
    const restos = [{ id: "r-ag", nom: "ag_pizzaa" }, { id: "r-mx", nom: "Mexico" }, { id: "r-ck", nom: "Cookies An Nou" }, { id: "r-cr", nom: "Croustiz Pointe à pitre" }];
    expect(restoParNom("ag pizza", restos)?.id).toBe("r-ag");
    expect(restoParNom("Mexico Sainte-Rose", restos)?.id).toBe("r-mx");
    expect(restoParNom("cookies an nou", restos)?.id).toBe("r-ck");
    expect(restoParNom("xy", restos)).toBeNull();

    // Token sans business_management : debug_token ne liste rien, me/businesses refusé ; les IDs saisis répondent.
    const doFetch = (async (input: string | URL | Request) => {
      const path = String(input).replace(/^https:\/\/graph\.test\/v24\.0\//, "");
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (path.startsWith("debug_token")) return json(200, { data: { granular_scopes: [] } });
      if (path.startsWith("me/businesses")) return json(400, { error: { message: "(#100) Missing Permission", code: 100 } });
      if (path === "1120744623676139") return json(200, { id: "1120744623676139", name: "ag pizza" });
      if (path.startsWith("1120744623676139/phone_numbers")) return json(200, { data: [{ id: "333", display_phone_number: "+590 690 33 33 33", verified_name: "AG PIZZA", is_on_biz_app: true }] });
      if (path.startsWith("1120744623676139/subscribed_apps")) return json(200, { data: [{ whatsapp_business_api_data: { name: "UChat" } }] });
      return json(404, { error: { message: "inconnu" } });
    }) as typeof fetch;
    const result = await diagnoseWhatsAppAccounts({ token: TOKEN, base: "https://graph.test", version: "v24.0", fetch: doFetch }, { accountIds: [], canaux: [], saisis: ["1120744623676139"] });
    expect(result.erreurs[0]).toContain("Missing Permission");
    expect(result.comptes[0]).toMatchObject({ id: "1120744623676139", nom: "ag pizza", origine: ["saisi à la main"], apps: ["UChat"] });
    expect(result.comptes[0].numeros[0]).toMatchObject({ id: "333", coexistence: true });
    const sql = canalInsertSql({ restaurant: restoParNom("ag pizza", restos), compte: result.comptes[0], numero: result.comptes[0].numeros[0], mode: "toujours", testNumero: "590690938108" });
    expect(sql).toContain("('r-ag', 'resto', 'whatsapp', '333', null, '1120744623676139',");
    expect(sql).toContain("'test', array['590690938108']");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

describe("apps abonnées : délai plus long et nouvel essai", () => {
  it("1er essai sans réponse (délai dépassé) → 2e essai qui répond : UChat visible ; 2 échecs : message clair, pas « injoignable »", async () => {
    let appels = 0;
    const lent = (id: string, toujours: boolean) =>
      (async (input: string | URL | Request, init?: RequestInit) => {
        const path = String(input).replace(/^https:\/\/graph\.test\/v24\.0\//, "");
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
        if (path.startsWith("debug_token")) return json({ data: { granular_scopes: [] } });
        if (path.startsWith("me/businesses")) return new Response(JSON.stringify({ error: { message: "(#100) Missing Permission", code: 100 } }), { status: 400 });
        if (path === id) return json({ id, name: "Mexico" });
        if (path.startsWith(`${id}/phone_numbers`)) return json({ data: [] });
        if (path.startsWith(`${id}/subscribed_apps`)) {
          appels++;
          if (toujours || appels === 1) {
            // Meta ne répond pas : la requête reste ouverte jusqu'à l'abandon par le délai.
            return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
          }
          return json({ data: [{ whatsapp_business_api_data: { name: "UChat" } }] });
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch;

    const ok = await diagnoseWhatsAppAccounts({ token: TOKEN, base: "https://graph.test", version: "v24.0", fetch: lent("1678321033943134", false), appsTimeoutMs: 50, retryDelayMs: 1 }, { accountIds: [], canaux: [], saisis: ["1678321033943134"] });
    expect(appels).toBe(2);
    expect(ok.comptes[0].apps).toEqual(["UChat"]);
    expect(ok.comptes[0].erreurs).toEqual([]);

    appels = 0;
    const ko = await diagnoseWhatsAppAccounts({ token: TOKEN, base: "https://graph.test", version: "v24.0", fetch: lent("1678321033943134", true), appsTimeoutMs: 50, retryDelayMs: 1 }, { accountIds: [], canaux: [], saisis: ["1678321033943134"] });
    expect(appels).toBe(2);
    expect(ko.comptes[0].erreurs[0]).toMatch(/^Apps abonnées : Meta n'a pas répondu en/);
  }, 60_000);
});

