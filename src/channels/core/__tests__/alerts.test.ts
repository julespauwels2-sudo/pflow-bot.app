/**
 * Alertes au gérant / à Jules : message libre si sa fenêtre de 24 h est ouverte, sinon modèle approuvé, sinon e-mail.
 * Faux Meta (serveur local) et faux service d'e-mail : aucun vrai envoi.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import { loadBotFromWorkspace } from "@/channels/core/bot-loader";
import { createMemoryChannelStore } from "@/channels/core/memory-store";
import { processWebhookPayload } from "@/channels/core/processor";
import type { Canal } from "@/channels/core/types";
import { createGraphClient } from "@/channels/whatsapp/graph";
import { demoDirectory } from "@/demos/lifecycle";
import { alertConfigFromEnv, alertTemplateParams, alertText, sendAlert, templateParam, type AlertConfig } from "../alerts";

const PHONE = "1000000099";
const ALERTE = "590690938108";
const PROSPECT = "590690111111";

let server: Server;
let base = "";
const sent: Record<string, unknown>[] = [];
/** Le faux Meta refuse les messages libres vers le numéro d'alerte (fenêtre fermée : erreur 131047). */
let refuseFreeform = true;
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = JSON.parse(body || "{}");
      res.setHeader("content-type", "application/json");
      if (refuseFreeform && json.to === ALERTE && json.type === "text") {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: "Re-engagement message", code: 131047 } }));
        return;
      }
      if (json.type) sent.push(json);
      res.end(JSON.stringify({ messages: [{ id: `wamid.out${sent.length}` }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  refuseFreeform = true;
});

const canal: Canal = {
  id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: PHONE, triggerMode: "toujours", numeroAffiche: "+590 691 26 68 53 (PFlow Démo)",
  coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [], telAlerte: ALERTE,
};
const input = { canal, motif: "Je veux le mien", contactName: "Marc", contactId: PROSPECT, extrait: "Bonjour,\nc'est combien ?" };

function fakeEmail(status = 200) {
  const calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const doFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: String((init?.headers as Record<string, string>).authorization) });
    return new Response(JSON.stringify(status === 200 ? { id: "mail-1" } : { message: "clé invalide" }), { status });
  }) as typeof fetch;
  return { calls, doFetch };
}

describe("alertes au gérant", () => {
  it("fenêtre de 24 h ouverte (Jules a écrit au numéro) : message libre", async () => {
    refuseFreeform = false;
    const store = createMemoryChannelStore([canal]);
    const now = new Date("2026-11-09T15:00:00Z");
    const jules = await store.getOrCreateContact("pflow", ALERTE, "Jules");
    await store.saveContact({ ...jules, state: { ...jules.state, lastInboundAt: "2026-11-09T09:00:00Z" } });
    const from = sent.length;
    const res = await sendAlert({ store, graph: createGraphClient({ token: "t", base, version: "v24.0" }), config: {}, now }, input);
    expect(res).toEqual({ voie: "texte", push: "non_configure", erreurs: [] });
    const msg = sent.slice(from)[0] as { to: string; text: { body: string } };
    expect(msg.to).toBe(ALERTE);
    expect(msg.text.body).toBe(alertText(input));
    expect(msg.text.body).toContain("Marc (+590690111111) attend une réponse sur +590 691 26 68 53 (PFlow Démo)");
  });

  it("fenêtre fermée (cas normal en production) : modèle approuvé, paramètres sur une ligne ; pas de message libre tenté", async () => {
    const store = createMemoryChannelStore([canal]);
    const config: AlertConfig = { template: { name: "alerte_conversation", language: "fr" } };
    const from = sent.length;
    const res = await sendAlert({ store, graph: createGraphClient({ token: "t", base, version: "v24.0" }), config, now: new Date() }, input);
    expect(res).toEqual({ voie: "modele", push: "non_configure", erreurs: [] });
    const msg = sent.slice(from)[0] as { to: string; type: string; template: { name: string; language: { code: string }; components: { type: string; parameters: { type: string; text: string }[] }[] } };
    expect(msg).toMatchObject({ to: ALERTE, type: "template", template: { name: "alerte_conversation", language: { code: "fr" } } });
    expect(msg.template.components[0].parameters.map((p) => p.text)).toEqual(["Marc (+590690111111)", "+590 691 26 68 53 (PFlow Démo)", "Je veux le mien", "Bonjour, c'est combien ?"]);
  });

  it("message libre refusé par Meta (fenêtre en fait fermée) : modèle ; modèle refusé : e-mail ; tout refusé : « aucune » avec les erreurs", async () => {
    const store = createMemoryChannelStore([canal]);
    const jules = await store.getOrCreateContact("pflow", ALERTE, "Jules");
    await store.saveContact({ ...jules, state: { ...jules.state, lastInboundAt: new Date(Date.now() - 3600_000).toISOString() } });
    const graph = createGraphClient({ token: "t", base, version: "v24.0" });

    let res = await sendAlert({ store, graph, config: { template: { name: "alerte_conversation", language: "fr" } }, now: new Date() }, input);
    expect(res.voie).toBe("modele");
    expect(res.erreurs[0]).toContain("message libre");

    // Modèle refusé (ex. pas encore approuvé) : e-mail de secours.
    const email = fakeEmail();
    const failing = { ...graph, sendTemplate: async () => { throw new Error("Template name does not exist in the translation"); } };
    res = await sendAlert({ store, graph: failing, config: { template: { name: "alerte_conversation", language: "fr" }, email: { apiKey: "re_test", to: "jules@example.com", from: "PFlow Bots <onboarding@resend.dev>" }, fetch: email.doFetch }, now: new Date() }, input);
    expect(res.voie).toBe("email");
    expect(res.erreurs.join()).toContain("modèle : Template name does not exist");
    expect(email.calls[0].url).toBe("https://api.resend.com/emails");
    expect(email.calls[0].auth).toBe("Bearer re_test");
    expect(email.calls[0].body).toMatchObject({ to: ["jules@example.com"], subject: "🔔 PFlow Bots : Je veux le mien (Marc)" });
    expect(String(email.calls[0].body.text)).toContain("Dernier message : « Bonjour,\nc'est combien ? »");

    // E-mail refusé aussi : rien n'est parti, chaque erreur est notée.
    const bad = fakeEmail(401);
    res = await sendAlert({ store, graph: failing, config: { template: { name: "x", language: "fr" }, email: { apiKey: "k", to: "j@example.com", from: "f" }, fetch: bad.doFetch }, now: new Date() }, input);
    expect(res.voie).toBe("aucune");
    expect(res.erreurs).toHaveLength(4);
    expect(res.erreurs[2]).toContain("push : clés VAPID non définies");
    expect(res.erreurs[3]).toContain("e-mail refusé (401)");
  });

  it("rien de configuré, fenêtre fermée : « aucune », avec la raison (variables à définir)", async () => {
    const store = createMemoryChannelStore([canal]);
    const res = await sendAlert({ store, graph: createGraphClient({ token: "t", base, version: "v24.0" }), config: {}, now: new Date() }, input);
    expect(res.voie).toBe("aucune");
    expect(res.erreurs).toEqual([
      "modèle : WHATSAPP_ALERTE_MODELE non défini (fenêtre de 24 h fermée)",
      "push : clés VAPID non définies (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)",
      "e-mail : RESEND_API_KEY ou ALERTE_EMAIL non défini",
    ]);
  });

  it("paramètres du modèle : une ligne, bornés, jamais vides ; configuration lue dans l'environnement", () => {
    expect(templateParam("a\n\nb\t c     d", 50)).toBe("a b c d");
    expect(templateParam("", 10)).toBe("—");
    expect(templateParam("x".repeat(300), 200)).toHaveLength(200);
    expect(alertTemplateParams({ ...input, extrait: undefined })[3]).toBe("—");
    const env = (vars: Record<string, string>) => (name: string) => vars[name] ?? "";
    expect(alertConfigFromEnv(env({}))).toEqual({});
    expect(alertConfigFromEnv(env({ WHATSAPP_ALERTE_MODELE: "alerte_conversation", RESEND_API_KEY: "re_x", ALERTE_EMAIL: "j@example.com" }))).toEqual({
      template: { name: "alerte_conversation", language: "fr" },
      email: { apiKey: "re_x", to: "j@example.com", from: "PFlow Bots <onboarding@resend.dev>" },
    });
  });

  it("de bout en bout (faux Meta) : « Je veux le mien » sur PFlow Démo, Jules n'a pas écrit depuis 24 h → modèle ; voie gardée avec le transfert", async () => {
    const repos = createLocalRepositories(createMemoryStore(), { now: () => new Date("2026-11-09T15:00:00Z") });
    await createMasterTemplate(repos);
    const data = await repos.workspace.exportAll();
    const store = createMemoryChannelStore([canal]);
    const deps = {
      store,
      graph: createGraphClient({ token: "t", base, version: "v24.0" }),
      loadBot: async (id: string, options?: { demo?: boolean }) => loadBotFromWorkspace(data, id, options),
      loadDemos: async () => demoDirectory(data),
      now: () => new Date("2026-11-09T15:00:00Z"),
      sleep: async () => {},
      alerts: { template: { name: "alerte_conversation", language: "fr" } } as AlertConfig,
    };
    const notif = (t: string) => ({
      object: "whatsapp_business_account",
      entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE }, contacts: [{ wa_id: PROSPECT, profile: { name: "Marc" } }], messages: [{ from: PROSPECT, id: `wamid.alerte.${t}`, type: "text", text: { body: t } }] } }] }],
    });
    const from = sent.length;
    const report = await processWebhookPayload(notif("Je veux le mien"), deps);
    expect(report.errors).toEqual([]);
    const template = sent.slice(from).find((m) => (m as { type: string }).type === "template") as { to: string; template: { components: { parameters: { text: string }[] }[] } };
    expect(template.to).toBe(ALERTE);
    expect(template.template.components[0].parameters[2].text).toBe("Je veux le mien");
    const [transfert] = await store.listTransferts("pflow");
    expect(transfert).toMatchObject({ gerantPrevenu: true, alerteVoie: "modele" });

    // Une question en plein parcours : même chemin, motif « Question pendant la démo ».
    const store2 = createMemoryChannelStore([canal]);
    const deps2 = { ...deps, store: store2, alerts: {} as AlertConfig };
    await processWebhookPayload(notif("Tester la démo"), deps2);
    const r2 = await processWebhookPayload(notif("C'est payant ?"), deps2);
    const [t2] = await store2.listTransferts("pflow");
    expect(t2).toMatchObject({ gerantPrevenu: false, alerteVoie: "aucune" });
    expect(t2.alerteErreur).toContain("WHATSAPP_ALERTE_MODELE non défini");
    expect(r2.errors.join()).toContain("Alerte non envoyée");
  });

  it("paramètres du modèle : coupés à 80 / 60 / 60 / 200 caractères, sur une ligne, « — » si vide", () => {
    const long = { ...input, contactName: "N".repeat(200), canal: { ...canal, numeroAffiche: "C".repeat(200) }, motif: "M".repeat(200), extrait: "ligne 1\nligne 2 " + "E".repeat(400) };
    const [p1, p2, p3, p4] = alertTemplateParams(long);
    expect([p1.length, p2.length, p3.length, p4.length]).toEqual([80, 60, 60, 200]);
    expect([p1, p2, p3, p4].every((p) => !/[\r\n\t]/.test(p) && !/\s{2,}/.test(p))).toBe(true);
    expect(p4.startsWith("ligne 1 ligne 2 E")).toBe(true);
    expect(alertTemplateParams({ ...input, extrait: "   \n  " })[3]).toBe("—");
  });

  it("Resend SANS domaine vérifié : expéditeur par défaut onboarding@resend.dev, envoi vers l'adresse du compte ; 403 expliqué", async () => {
    const store = createMemoryChannelStore([{ ...canal, telAlerte: undefined }]);
    // Exactement les variables que Jules va mettre dans Vercel (pas d'ALERTE_EMAIL_FROM, pas de domaine).
    const config = alertConfigFromEnv((name) => ({ RESEND_API_KEY: "re_cle_de_test", ALERTE_EMAIL: "jules.pauwels2@gmail.com" })[name] ?? "");
    expect(config.email).toEqual({ apiKey: "re_cle_de_test", to: "jules.pauwels2@gmail.com", from: "PFlow Bots <onboarding@resend.dev>" });
    const ok = fakeEmail();
    const res = await sendAlert({ store, graph: createGraphClient({ token: "t", base, version: "v24.0" }), config: { ...config, fetch: ok.doFetch }, now: new Date() }, input);
    expect(res.voie).toBe("email");
    expect(ok.calls[0].body).toMatchObject({ from: "PFlow Bots <onboarding@resend.dev>", to: ["jules.pauwels2@gmail.com"] });
    // Mauvaise adresse (pas celle du compte) : Resend répond 403 ; l'erreur le dit sur la page État.
    const refuse = fakeEmail(403);
    const bad = await sendAlert({ store, graph: createGraphClient({ token: "t", base, version: "v24.0" }), config: { ...config, fetch: refuse.doFetch }, now: new Date() }, input);
    expect(bad.voie).toBe("aucune");
    expect(bad.erreurs.join()).toContain("ALERTE_EMAIL doit être l'adresse du compte Resend");
  });
});

