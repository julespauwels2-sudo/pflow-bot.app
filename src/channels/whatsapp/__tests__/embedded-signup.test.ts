/**
 * « Connecter votre WhatsApp » (Embedded Signup v4, coexistence) : faux Meta local, aucun appel réel.
 * - chiffrement des jetons des clients ;
 * - les 10 modèles de la livraison (textes exacts du contrat, règles de Meta) ;
 * - fin du parcours : ordre des appels, jeton jamais en clair, canal en test, modèles créés sans doublon ;
 * - routes : lien unique et expirant, page publique, fin, abandon ; l'envoi utilise ensuite le jeton DU client.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chiffrerJeton, cleJetons, dechiffrerJeton } from "@/lib/jetons-chiffres";
import { createMemoryChannelStore } from "@/channels/core/memory-store";
import { createMemoryConnexionStore, hashJeton, nouveauJetonLien, jetonValide } from "@/channels/core/connexions";
import { LIVRAISON_TEMPLATES, templatePayload } from "../livraison-templates";
import { terminerConnexion, type MetaAppConfig } from "../embedded-signup";

const KEY = randomBytes(32);
const CLIENT_TOKEN = "EAAG-jeton-du-client-" + randomBytes(6).toString("hex");

type Call = { method: string; path: string; auth?: string; body?: Record<string, unknown> };
let server: Server;
let base = "";
const calls: Call[] = [];
let existingTemplates: string[] = [];
let failOn: string | null = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = (req.url ?? "").replace(/^\/v\d+\.\d+\//, "");
      calls.push({ method: req.method ?? "", path, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
      const json = (status: number, v: unknown) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(v));
      };
      if (failOn && path.startsWith(failOn)) return json(400, { error: { message: "Refusé par Meta", code: 100 } });
      if (path.startsWith("oauth/access_token")) return json(200, { access_token: CLIENT_TOKEN, token_type: "bearer", expires_in: 5_184_000 });
      if (path.startsWith("debug_token?"))
        return json(200, {
          data: {
            is_valid: true,
            expires_at: Math.floor(Date.now() / 1000) + 5_184_000,
            scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
            granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["9876543210"] }, { scope: "whatsapp_business_messaging", target_ids: ["9876543210"] }],
          },
        });
      if (path.startsWith("1234567890?fields=")) return json(200, { display_phone_number: "+590 690 12 34 56", verified_name: "Bokit An Nou", is_on_biz_app: true, platform_type: "CLOUD_API" });
      if (path === "9876543210/subscribed_apps") return json(200, { success: true });
      if (path.startsWith("1808772226929443/")) return json(400, { error: { message: "Authorization Error", code: 100, error_subcode: 2388339 } });
      if (path === "1234567890/smb_app_data") return json(200, { request_id: "r1" });
      if (/^\d+\/message_templates\?/.test(path)) return json(200, { data: existingTemplates.map((name) => ({ name, status: "APPROVED", language: "fr" })) });
      if (/^\d+\/message_templates$/.test(path)) return json(200, { id: "t1", status: "PENDING", category: "UTILITY" });
      if (path === "1234567890/messages") return json(200, { messages: [{ id: "wamid.sent" }] });
      json(404, { error: { message: "inconnu" } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => {
  calls.length = 0;
  existingTemplates = [];
  failOn = null;
});

const meta = (): MetaAppConfig => ({ appId: "111", appSecret: "secret-app", configId: "222", base, version: "v24.0" });

describe("jetons chiffrés", () => {
  it("aller-retour, jamais le jeton en clair ; jeton modifié ou mauvaise clé : erreur", () => {
    const stocke = chiffrerJeton(CLIENT_TOKEN, KEY);
    expect(stocke.startsWith("v1:")).toBe(true);
    expect(stocke).not.toContain(CLIENT_TOKEN);
    expect(dechiffrerJeton(stocke, KEY)).toBe(CLIENT_TOKEN);
    expect(chiffrerJeton(CLIENT_TOKEN, KEY)).not.toBe(stocke); // vecteur aléatoire
    const parts = stocke.split(":");
    parts[3] = Buffer.from("autre chose").toString("base64");
    expect(() => dechiffrerJeton(parts.join(":"), KEY)).toThrow();
    expect(() => dechiffrerJeton(stocke, randomBytes(32))).toThrow();
    expect(() => cleJetons(undefined)).toThrow(/BOT_JETONS_CLE absente/);
    expect(() => cleJetons(Buffer.from("trop court").toString("base64"))).toThrow(/32 octets/);
  });
});

describe("modèles de la livraison", () => {
  it("les 10 noms du contrat, textes conformes aux règles de Meta, bouton « Suivre ma livraison »", () => {
    expect(LIVRAISON_TEMPLATES.map((t) => t.name).sort()).toEqual(
      [
        "pflow_livraison_confirmee",
        "pflow_livraison_livreur_trouve",
        "pflow_livraison_en_route",
        "pflow_livraison_heure_maj",
        "pflow_livraison_arrive_bientot",
        "pflow_livraison_livreur_arrive",
        "pflow_livraison_paiement_refuse",
        "pflow_livraison_aucun_livreur",
        "pflow_livraison_annulee",
        "pflow_livraison_annulee_sans_livreur",
      ].sort(),
    );
    for (const t of LIVRAISON_TEMPLATES) {
      const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(vars, t.name).toEqual(vars.map((_, i) => i + 1)); // {{1}}, {{2}} dans l'ordre
      expect(t.examples.length, t.name).toBe(vars.length);
      expect(t.body.trim().startsWith("{{"), t.name).toBe(false); // ni au début…
      expect(/\}\}[.!?]?$/.test(t.body.trim()), t.name).toBe(false); // …ni à la fin
    }
    expect(templatePayload(LIVRAISON_TEMPLATES[0])).toEqual({
      name: "pflow_livraison_confirmee",
      language: "fr",
      category: "UTILITY",
      components: [
        { type: "BODY", text: LIVRAISON_TEMPLATES[0].body, example: { body_text: [["Bokit An Nou", "1042"]] } },
        { type: "BUTTONS", buttons: [{ type: "URL", text: "Suivre ma livraison", url: "https://order.pflow.fr/suivi/{{1}}", example: ["https://order.pflow.fr/suivi/0b6f2c1e-1111-4222-8333-444455556666"] }] },
      ],
    });
  });
});

async function nouvelleConnexion() {
  const connexions = createMemoryConnexionStore();
  const store = createMemoryChannelStore([]);
  const c = await connexions.create({ restaurantId: "resto-1", jetonHash: hashJeton(nouveauJetonLien()), expireLe: new Date(Date.now() + 86_400_000).toISOString() });
  return { connexions, store, c };
}
const input = { code: "code-de-meta-0123456789", wabaId: "9876543210", phoneNumberId: "1234567890", businessId: "5555555555", evenement: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" as const };

describe("fin du parcours (coexistence)", () => {
  it("code → jeton chiffré → numéro → app abonnée → contacts puis historique → canal en test → modèles manquants", async () => {
    const { connexions, store, c } = await nouvelleConnexion();
    existingTemplates = ["pflow_livraison_confirmee", "autre_modele"];
    const done = await terminerConnexion({ meta: meta(), connexions, store, chiffrer: (t) => chiffrerJeton(t, KEY) }, c, input);

    expect(done.etat).toBe("terminee");
    expect(done.erreur).toBeUndefined();
    expect(done.numeroAffiche).toBe("+590 690 12 34 56");
    expect(calls.map((x) => `${x.method} ${x.path.split("?")[0]}`)).toEqual([
      "GET oauth/access_token",
      "GET debug_token",
      "GET 1234567890",
      "POST 9876543210/subscribed_apps",
      "POST 1234567890/smb_app_data",
      "POST 1234567890/smb_app_data",
      "GET 9876543210/message_templates",
      ...Array(9).fill("POST 9876543210/message_templates"),
    ]);
    // Le secret de l'app seulement pour l'échange du code ; ensuite le jeton du client, en en-tête.
    expect(calls[0].path).toContain("client_secret=secret-app");
    // debug_token : avec le jeton de l'app (id|secret) ; tout le reste avec le jeton du client.
    expect(calls[1].auth).toBe("Bearer 111|secret-app");
    expect(calls.slice(2).every((x) => x.auth === `Bearer ${CLIENT_TOKEN}`)).toBe(true);
    // Échéance (60 jours) et droits notés et gardés avec le jeton.
    expect(done.etapes.find((e) => e.etape === "jeton_echeance")?.detail).toMatch(/^expire le \d{4}-\d{2}-\d{2}, renouvelé automatiquement$/);
    expect(done.etapes.find((e) => e.etape === "jeton_droits")).toMatchObject({ ok: true, detail: "whatsapp_business_management, whatsapp_business_messaging" });
    const [jeton] = await connexions.listJetons();
    expect(Math.round((Date.parse(jeton.expireLe!) - Date.now()) / 86_400_000)).toBe(60);
    expect(calls.filter((x) => x.path.endsWith("smb_app_data")).map((x) => x.body?.sync_type)).toEqual(["smb_app_state_sync", "history"]);
    expect(calls.some((x) => x.path.endsWith("/register"))).toBe(false); // jamais en coexistence

    // Jeton gardé chiffré, nulle part en clair dans la demande.
    const stocke = await connexions.jetonChiffre("9876543210");
    expect(dechiffrerJeton(stocke!, KEY)).toBe(CLIENT_TOKEN);
    expect(JSON.stringify(await connexions.list())).not.toContain(CLIENT_TOKEN);

    const [canal] = await store.listCanaux();
    expect(canal).toMatchObject({ restaurantId: "resto-1", accountId: "1234567890", wabaId: "9876543210", etat: "test", coexistence: true, role: "resto", testNumeros: ["590690938108"] });
    expect(done.canalId).toBe(canal.id);
    expect(done.etapes.find((e) => e.etape === "modeles_livraison")?.detail).toBe("9 créé(s), 1 déjà là");
  });

  it("deuxième connexion du même numéro : canal existant laissé tel quel (aucun doublon)", async () => {
    const { connexions, store, c } = await nouvelleConnexion();
    await store.ensureCanal({ restaurantId: "resto-1", role: "resto", plateforme: "whatsapp", accountId: "1234567890", triggerMode: "toujours", coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "test", testNumeros: [] });
    await store.setCanalEtat((await store.listCanaux())[0].id, "actif");
    const done = await terminerConnexion({ meta: meta(), connexions, store, chiffrer: (t) => chiffrerJeton(t, KEY) }, c, input);
    expect(await store.listCanaux()).toHaveLength(1);
    expect((await store.listCanaux())[0].etat).toBe("actif");
    expect(done.etapes.find((e) => e.etape === "canal")?.detail).toContain("déjà présent");
  });

  it("code refusé par Meta : erreur, aucun jeton, aucun canal", async () => {
    const { connexions, store, c } = await nouvelleConnexion();
    failOn = "oauth/";
    const done = await terminerConnexion({ meta: meta(), connexions, store, chiffrer: (t) => chiffrerJeton(t, KEY) }, c, input);
    expect(done.etat).toBe("erreur");
    expect(done.erreur).toContain("Refusé par Meta");
    expect(await connexions.jetonChiffre("9876543210")).toBeNull();
    expect(await store.listCanaux()).toHaveLength(0);
  });

  it("abonnement refusé : connexion terminée, étape à reprendre notée ; parcours classique : pas de synchronisation", async () => {
    const { connexions, store, c } = await nouvelleConnexion();
    failOn = "9876543210/subscribed_apps";
    const done = await terminerConnexion({ meta: meta(), connexions, store, chiffrer: (t) => chiffrerJeton(t, KEY) }, c, { ...input, evenement: "FINISH" });
    expect(done.etat).toBe("terminee");
    expect(done.erreur).toBe("Terminé, à reprendre à la main : app_abonnee");
    expect(calls.some((x) => x.path.endsWith("smb_app_data"))).toBe(false);
    expect(done.etapes.find((e) => e.etape === "coexistence")?.detail).toContain("Parcours classique");
    expect((await store.listCanaux())[0].coexistence).toBe(false);
  });
});

describe("routes « Connecter votre WhatsApp » (mode mémoire)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    (globalThis as { __pflowChannels?: unknown }).__pflowChannels = undefined;
  });

  it("lien unique → page publique → fin → canal en test ; l'envoi utilise ensuite le jeton DU client ; lien réutilisé : rien ne se refait", async () => {
    Object.assign(process.env, {
      CHANNELS_STORE: "memory",
      WHATSAPP_APP_SECRET: "secret-app",
      WHATSAPP_VERIFY_TOKEN: "v",
      WHATSAPP_TOKEN: "jeton-general-pflow",
      WHATSAPP_GRAPH_BASE: base,
      META_APP_ID: "111",
      META_ES_CONFIG_ID: "222",
      BOT_JETONS_CLE: KEY.toString("base64"),
    });
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.VERCEL;
    (globalThis as { __pflowChannels?: unknown }).__pflowChannels = undefined;
    const admin = await import("@/app/api/connexions-whatsapp/route");
    const page = await import("@/app/api/connecter/[jeton]/route");
    const { getChannelsRuntime } = await import("@/channels/core/runtime");

    const liste = await (await admin.GET(new Request("http://localhost/api/connexions-whatsapp"))).json();
    expect(liste.manque).toEqual([]);
    const resto = liste.restos.find((r: { nom: string }) => r.nom.startsWith("Cookies"));
    const cree = await admin.POST(new Request("http://localhost/api/connexions-whatsapp", { method: "POST", body: JSON.stringify({ restaurantId: resto.id }) }));
    const { url } = await cree.json();
    const jeton = url.split("/connecter/")[1];
    expect(jetonValide(jeton)).toBe(true);
    const ctx = { params: Promise.resolve({ jeton }) };

    // Page publique : nom du resto et identifiants de l'app (pas de secret).
    const infos = await (await page.GET(new Request(`http://localhost/api/connecter/${jeton}`), ctx)).json();
    expect(infos).toMatchObject({ nomResto: resto.nom, etat: "lien_envoye", meta: { appId: "111", configId: "222" } });
    expect(JSON.stringify(infos)).not.toContain("secret-app");
    // Lien inventé : 404.
    expect((await page.GET(new Request("http://localhost/x"), { params: Promise.resolve({ jeton: "x".repeat(43) }) })).status).toBe(404);

    const post = (body: unknown) => page.POST(new Request(`http://localhost/api/connecter/${jeton}`, { method: "POST", body: JSON.stringify(body) }), ctx);
    const r = await post({ type: "termine", ...input });
    expect(r.status).toBe(200);
    const fin = await r.json();
    expect(fin.etat).toBe("terminee");
    expect(JSON.stringify(fin)).not.toContain(CLIENT_TOKEN);

    // Le canal créé envoie avec le jeton du client (déchiffré), pas avec le jeton général.
    const rt = await getChannelsRuntime();
    const canal = (await rt.store.listCanaux()).find((x) => x.accountId === "1234567890")!;
    expect(canal.etat).toBe("test");
    calls.length = 0;
    await rt.senders.whatsapp!.send(canal.accountId, "590690999999", { kind: "text", text: "Bonjour" });
    expect(calls[0]).toMatchObject({ path: "1234567890/messages", auth: `Bearer ${CLIENT_TOKEN}` });

    // Lien réutilisé après la fin : rien ne se refait.
    calls.length = 0;
    expect((await (await post({ type: "termine", ...input })).json()).etat).toBe("terminee");
    expect(calls).toHaveLength(0);

    // Page État : la connexion, son déroulé.
    const apres = await (await admin.GET(new Request("http://localhost/api/connexions-whatsapp"))).json();
    expect(apres.connexions[0]).toMatchObject({ nomResto: resto.nom, etat: "terminee", numeroAffiche: "+590 690 12 34 56" });
  });

  it("abandon du gérant : noté (étape et session Meta), le lien reste utilisable", async () => {
    Object.assign(process.env, { CHANNELS_STORE: "memory" });
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.VERCEL;
    (globalThis as { __pflowChannels?: unknown }).__pflowChannels = undefined;
    const { getChannelsRuntime } = await import("@/channels/core/runtime");
    const page = await import("@/app/api/connecter/[jeton]/route");
    const rt = await getChannelsRuntime();
    const jeton = nouveauJetonLien();
    await rt.connexions.create({ restaurantId: "r", jetonHash: hashJeton(jeton), expireLe: new Date(Date.now() + 3_600_000).toISOString() });
    const ctx = { params: Promise.resolve({ jeton }) };
    await page.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ type: "annule", etape: "PHONE_NUMBER_VERIFICATION", sessionId: "s-1" }) }), ctx);
    const c = await rt.connexions.byJetonHash(hashJeton(jeton));
    expect(c).toMatchObject({ etat: "annulee" });
    expect(c!.erreur).toContain("PHONE_NUMBER_VERIFICATION");
    expect(c!.erreur).toContain("s-1");
  });
});

describe("page État : modèles compte par compte, client test hors CRM, débranchement", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    (globalThis as { __pflowChannels?: unknown }).__pflowChannels = undefined;
  });
  const env = () => {
    Object.assign(process.env, {
      CHANNELS_STORE: "memory", WHATSAPP_APP_SECRET: "secret-app", WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_TOKEN: "jeton-general-pflow",
      WHATSAPP_GRAPH_BASE: base, META_APP_ID: "111", META_ES_CONFIG_ID: "222", BOT_JETONS_CLE: KEY.toString("base64"),
    });
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.VERCEL;
    (globalThis as { __pflowChannels?: unknown }).__pflowChannels = undefined;
  };
  const canal = (accountId: string, wabaId: string, messagingAccountId?: string) => ({
    restaurantId: "r", role: "resto" as const, plateforme: "whatsapp" as const, accountId, wabaId, ...(messagingAccountId ? { messagingAccountId } : {}),
    triggerMode: "toujours" as const, coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "test" as const, testNumeros: [],
  });

  it("modèles : un compte par resto, le compte de messagerie d'abord (le WABA du nouveau modèle refuse), seuls les manquants créés", async () => {
    env();
    const route = await import("@/app/api/etat/modeles-livraison/route");
    const { getChannelsRuntime } = await import("@/channels/core/runtime");
    const rt = await getChannelsRuntime();
    // Comme en production : WABA 1808… refusé (nouveau modèle), compte de messagerie 4170… qui répond.
    await rt.store.ensureCanal(canal("5550001111", "1808772226929443", "4170754433058228"));
    existingTemplates = ["pflow_livraison_en_route", "pflow_livraison_annulee"];

    const lu = await (await route.GET(new Request("http://localhost/x"))).json();
    const compte = lu.comptes.find((c: { canalId: string; compteId: string }) => c.compteId === "4170754433058228");
    expect(compte.etat).toHaveLength(10);
    expect(compte.jeton).toBe("general");
    // Le canal de démo du mode mémoire n'a pas d'identifiant Meta : signalé, pas d'appel.
    expect(lu.comptes.find((c: { error?: string }) => c.error?.includes("Aucun identifiant"))).toBeTruthy();

    calls.length = 0;
    const cree = await (await route.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ canalId: compte.canalId }) }))).json();
    expect(cree.comptes[0].crees).toHaveLength(8);
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.every((c) => c.path === "4170754433058228/message_templates" && c.auth === "Bearer jeton-general-pflow")).toBe(true);
    expect(posts.map((c) => c.body?.name)).not.toContain("pflow_livraison_en_route");
    expect(JSON.stringify(cree)).not.toContain("jeton-general-pflow");
    // Sans compte de messagerie et WABA refusé : erreur affichée, rien créé.
    await rt.store.ensureCanal(canal("5550002222", "1808772226929443"));
    const tous = await (await route.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ tous: true }) }))).json();
    expect(tous.comptes.find((c: { libelle: string }) => c.libelle.includes("5550002222")).error).toContain("Authorization Error");
    // Le numéro PFlow (démos) est aussi listé : son compte a les modèles de la livraison (vidéo de l'examen Meta).
    await rt.store.ensureCanal({ ...canal("5550003333", "9990001111"), role: "pflow" as const });
    const avecPflow = await (await route.GET(new Request("http://localhost/x"))).json();
    expect(avecPflow.comptes.find((c: { libelle: string }) => c.libelle.includes("5550003333")).libelle).toContain("PFlow Démo");
  });

  it("client test hors CRM (Cedyan) : lien, connexion, canal en test relié à aucun resto, seul Jules en test ; puis débranchement", async () => {
    env();
    const admin = await import("@/app/api/connexions-whatsapp/route");
    const page = await import("@/app/api/connecter/[jeton]/route");
    const { getChannelsRuntime } = await import("@/channels/core/runtime");
    const rt = await getChannelsRuntime();
    const restosAvant = (await rt.workspace()).clients.length;

    const cree = await (await admin.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ clientTest: { nom: "Cedyan Energy" } }) }))).json();
    expect(cree).toMatchObject({ nomResto: "Cedyan Energy", clientTest: true });
    const jeton = cree.url.split("/connecter/")[1];
    const ctx = { params: Promise.resolve({ jeton }) };
    expect((await (await page.GET(new Request("http://localhost/x"), ctx)).json()).nomResto).toBe("Cedyan Energy");
    const fin = await (await page.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ type: "termine", ...input }) }), ctx)).json();
    expect(fin.etat).toBe("terminee");

    const c = (await rt.store.listCanaux()).find((x) => x.accountId === "1234567890")!;
    expect(c).toMatchObject({ etat: "test", testNumeros: ["590690938108"] });
    expect((await rt.workspace()).clients.some((x) => x.id === c.restaurantId)).toBe(false); // relié à aucun resto
    expect((await rt.workspace()).clients.length).toBe(restosAvant); // rien créé côté restos

    const liste = await (await admin.GET(new Request("http://localhost/x"))).json();
    const ligne = liste.connexions.find((x: { nomResto: string }) => x.nomResto === "Cedyan Energy");
    expect(ligne).toMatchObject({ clientTest: true, etat: "terminee" });

    calls.length = 0;
    const deb = await (await admin.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ action: "debrancher", id: ligne.id }) }))).json();
    expect(deb.etat).toBe("debranchee");
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "9876543210/subscribed_apps", auth: `Bearer ${CLIENT_TOKEN}` });
    expect((await rt.store.listCanaux()).find((x) => x.accountId === "1234567890")!.etat).toBe("coupe");
    expect(await rt.connexions.jetonChiffre("9876543210")).toBeNull();
  });
});
