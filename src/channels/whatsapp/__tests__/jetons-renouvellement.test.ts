/**
 * Jetons Meta des clients (60 jours) : échéance, renouvellement quotidien, échec gardé pour la page État.
 * Faux Meta local, aucun appel réel.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMemoryConnexionStore } from "@/channels/core/connexions";
import { etatJeton, renouvelerJetons } from "../jetons-renouvellement";
import type { MetaAppConfig } from "../embedded-signup";

const NOW = new Date("2026-11-10T07:00:00Z");
const jours = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
let server: Server;
let base = "";
const calls: string[] = [];
let refus = false;
let expiresAtDebug = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "").replace(/^\/v\d+\.\d+\//, "");
    calls.push(path);
    const json = (status: number, v: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(v));
    };
    if (path.startsWith("oauth/access_token")) {
      if (refus) return json(400, { error: { message: "Error validating access token: Session has expired", code: 190, error_subcode: 463 } });
      const q = new URLSearchParams(path.split("?")[1]);
      return json(200, { access_token: `NOUVEAU-${q.get("fb_exchange_token")}`, token_type: "bearer", expires_in: 5_183_944 });
    }
    if (path.startsWith("debug_token?")) return json(200, { data: { is_valid: true, expires_at: expiresAtDebug, scopes: [] } });
    json(404, { error: { message: "inconnu" } });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => {
  calls.length = 0;
  refus = false;
  expiresAtDebug = 0;
});

const meta = (): MetaAppConfig => ({ appId: "111", appSecret: "secret-app", configId: "222", base, version: "v24.0" });
// « Chiffrement » de test lisible : préfixe, pour vérifier que le jeton stocké est bien le chiffré.
const deps = (connexions: ReturnType<typeof createMemoryConnexionStore>) => ({
  meta: meta(),
  connexions,
  chiffrer: (t: string) => `chiffre:${t}`,
  dechiffrer: (s: string) => s.replace(/^chiffre:/, ""),
  now: () => NOW,
});

describe("échéance des jetons", () => {
  it("ok, à renouveler (< 20 j), bientôt (< 10 j, alerte), expiré, jamais, inconnu", () => {
    expect(etatJeton({ expireLe: jours(45) }, NOW)).toEqual({ etat: "ok", joursRestants: 45 });
    expect(etatJeton({ expireLe: jours(19) }, NOW).etat).toBe("a_renouveler");
    expect(etatJeton({ expireLe: jours(9) }, NOW)).toEqual({ etat: "bientot", joursRestants: 9 });
    expect(etatJeton({ expireLe: jours(-1) }, NOW).etat).toBe("expire");
    expect(etatJeton({ expireLe: null, nExpirePas: true }, NOW).etat).toBe("jamais");
    expect(etatJeton({ expireLe: null }, NOW).etat).toBe("inconnu");
  });
});

describe("renouvellement quotidien", () => {
  it("seuls les jetons à moins de 20 jours sont renouvelés : nouveau jeton chiffré, 60 jours de plus", async () => {
    const c = createMemoryConnexionStore();
    await c.saveJeton("waba-loin", "r1", "chiffre:JETON-LOIN", "bearer", { expireLe: jours(45) });
    await c.saveJeton("waba-proche", "r2", "chiffre:JETON-PROCHE", "bearer", { expireLe: jours(15) });
    const r = await renouvelerJetons(deps(c));
    expect(r).toMatchObject({ verifies: 2, renouveles: 1, echecs: [] });
    expect(calls).toHaveLength(1);
    const q = new URLSearchParams(calls[0].split("?")[1]);
    expect(Object.fromEntries(q)).toEqual({
      grant_type: "fb_exchange_token",
      client_id: "111",
      client_secret: "secret-app",
      set_token_expires_in_60_days: "true",
      fb_exchange_token: "JETON-PROCHE",
    });
    const proche = (await c.listJetons()).find((j) => j.wabaId === "waba-proche")!;
    expect(proche.chiffre).toBe("chiffre:NOUVEAU-JETON-PROCHE");
    expect(etatJeton(proche, NOW).joursRestants).toBe(59);
    expect(proche.renouveleLe).toBe(NOW.toISOString());
    expect(proche.erreur).toBeUndefined();
    expect((await c.listJetons()).find((j) => j.wabaId === "waba-loin")!.chiffre).toBe("chiffre:JETON-LOIN");
  });

  it("refus de Meta : jeton inchangé, erreur gardée pour la page État ; réussite suivante : erreur effacée", async () => {
    const c = createMemoryConnexionStore();
    await c.saveJeton("waba", "r1", "chiffre:JETON", "bearer", { expireLe: jours(8) });
    refus = true;
    const r = await renouvelerJetons(deps(c));
    expect(r.renouveles).toBe(0);
    expect(r.echecs[0].erreur).toMatch(/Session has expired \(code 190\/463\)/);
    let [j] = await c.listJetons();
    expect(j.chiffre).toBe("chiffre:JETON");
    expect(j.erreur).toMatch(/code 190/);
    expect(etatJeton(j, NOW).etat).toBe("bientot");
    refus = false;
    await renouvelerJetons(deps(c));
    [j] = await c.listJetons();
    expect(j.erreur).toBeUndefined();
    expect(j.chiffre).toBe("chiffre:NOUVEAU-JETON");
  });

  it("échéance inconnue (jeton gardé avant la migration) : demandée à Meta ; « n'expire pas » : jamais renouvelé", async () => {
    const c = createMemoryConnexionStore();
    await c.saveJeton("waba-a", "r1", "chiffre:A");
    expiresAtDebug = Math.floor(Date.parse(jours(50)) / 1000);
    await renouvelerJetons(deps(c));
    expect(etatJeton((await c.listJetons())[0], NOW)).toEqual({ etat: "ok", joursRestants: 50 });

    const d = createMemoryConnexionStore();
    await d.saveJeton("waba-b", "r1", "chiffre:B");
    expiresAtDebug = 0;
    const r = await renouvelerJetons(deps(d));
    expect(r).toMatchObject({ echeancesTrouvees: 1, renouveles: 0 });
    expect((await d.listJetons())[0].nExpirePas).toBe(true);
    calls.length = 0;
    await renouvelerJetons(deps(d));
    expect(calls).toHaveLength(0); // plus aucun appel pour un jeton qui n'expire pas
  });

  it("jeton illisible (mauvaise clé) : signalé, les autres continuent", async () => {
    const c = createMemoryConnexionStore();
    await c.saveJeton("waba-x", "r1", "illisible", "bearer", { expireLe: jours(5) });
    await c.saveJeton("waba-y", "r2", "chiffre:Y", "bearer", { expireLe: jours(5) });
    const r = await renouvelerJetons({ ...deps(c), dechiffrer: (s: string) => (s.startsWith("chiffre:") ? s.slice(8) : (() => { throw new Error("clé"); })()) });
    expect(r.echecs).toEqual([{ wabaId: "waba-x", erreur: "jeton illisible (BOT_JETONS_CLE)" }]);
    expect(r.renouveles).toBe(1);
  });

  it("« Renouveler maintenant » : seulement le compte demandé, même loin de l'échéance", async () => {
    const c = createMemoryConnexionStore();
    await c.saveJeton("waba-a", "r1", "chiffre:A", "bearer", { expireLe: jours(55) });
    await c.saveJeton("waba-b", "r2", "chiffre:B", "bearer", { expireLe: jours(55) });
    const r = await renouvelerJetons({ ...deps(c), forcer: ["waba-a"] });
    expect(r).toMatchObject({ verifies: 1, renouveles: 1 });
    const js = await c.listJetons();
    expect(js.find((j) => j.wabaId === "waba-a")!.chiffre).toBe("chiffre:NOUVEAU-A");
    expect(js.find((j) => j.wabaId === "waba-b")!.chiffre).toBe("chiffre:B");
  });
});
