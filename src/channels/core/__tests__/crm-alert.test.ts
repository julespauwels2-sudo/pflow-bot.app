/** TOUTES les alertes partent aussi sur l'appli iPhone de Jules (via le CRM, rpc app_alerte_bot), en plus du Web Push. */
import { describe, expect, it } from "vitest";
import { createMemoryChannelStore } from "@/channels/core/memory-store";
import type { Canal } from "@/channels/core/types";
import { alertConfigFromEnv, alertDelivered, sendAlert } from "../alerts";
import { appAlertTexts, countAppDevices, crmAlertConfigFromEnv, sendCrmAlert, type CrmAlertConfig } from "../crm-alert";

const canal: Canal = {
  id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: "1000000099", triggerMode: "toujours", numeroAffiche: "PFlow Démo",
  coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [], telAlerte: "590690938108",
};
const input = { canal, motif: "Je veux le mien", contactName: "Marc", contactId: "590690111111", extrait: "C'est\n combien ?", conversationId: "contact-1" };

/** Faux CRM : liste des iPhone actifs (GET app_appareils) et file des notifications (rpc app_alerte_bot). */
function fauxCrm(opts: { status?: number; appareils?: number; id?: number | null } = {}) {
  const { status = 200, appareils = 1, id = 1 } = opts;
  const appels: { url: string; method: string; headers: Record<string, string>; body?: Record<string, string> }[] = [];
  const config: CrmAlertConfig = {
    url: "https://crm.supabase.co",
    serviceKey: "service",
    fetch: (async (url: string, o: RequestInit) => {
      appels.push({ url, method: o.method ?? "GET", headers: o.headers as Record<string, string>, ...(o.body ? { body: JSON.parse(String(o.body)) } : {}) });
      if (status !== 200) return new Response("{}", { status });
      if (url.includes("/app_appareils")) return Response.json(Array.from({ length: appareils }, (_, i) => ({ id: `a${i}` })));
      return Response.json(id);
    }) as unknown as typeof fetch,
  };
  return { config, appels, rpc: () => appels.filter((a) => a.url.endsWith("/rpc/app_alerte_bot")) };
}

describe("alerte vers l'appli iPhone (CRM)", () => {
  it("configuration : seulement si les deux variables sont posées", () => {
    const env = (vars: Record<string, string>) => (name: string) => vars[name] ?? "";
    expect(crmAlertConfigFromEnv(env({ PFLOW_CRM_SUPABASE_URL: "https://x.supabase.co" }))).toBeUndefined();
    expect(crmAlertConfigFromEnv(env({ PFLOW_CRM_SUPABASE_URL: "https://x.supabase.co/", PFLOW_CRM_SERVICE_ROLE_KEY: "k" }))).toEqual({ url: "https://x.supabase.co", serviceKey: "k" });
    expect(alertConfigFromEnv(env({ PFLOW_CRM_SUPABASE_URL: "https://x.supabase.co", PFLOW_CRM_SERVICE_ROLE_KEY: "k" }))).toEqual({ crm: { url: "https://x.supabase.co", serviceKey: "k" } });
  });

  it("sans PFLOW_CRM_SERVICE_ROLE_KEY : les variables de PFlow Bots (même projet Supabase), jamais vers un autre projet", () => {
    const env = (vars: Record<string, string>) => (name: string) => vars[name] ?? "";
    const bots = { NEXT_PUBLIC_SUPABASE_URL: "https://tekntxvkjhgyvbbwbogt.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "cle-bots" };
    // Les deux variables déjà dans Vercel suffisent.
    expect(crmAlertConfigFromEnv(env(bots))).toEqual({ url: "https://tekntxvkjhgyvbbwbogt.supabase.co", serviceKey: "cle-bots" });
    expect(alertConfigFromEnv(env(bots))).toEqual({ crm: { url: "https://tekntxvkjhgyvbbwbogt.supabase.co", serviceKey: "cle-bots" } });
    // PFLOW_CRM_SUPABASE_URL sur le même projet : accepté.
    expect(crmAlertConfigFromEnv(env({ ...bots, PFLOW_CRM_SUPABASE_URL: "https://tekntxvkjhgyvbbwbogt.supabase.co" }))?.serviceKey).toBe("cle-bots");
    // PFLOW_CRM_SUPABASE_URL sur un autre projet, sans sa clé : rien (la clé de PFlow Bots n'y part jamais).
    expect(crmAlertConfigFromEnv(env({ ...bots, PFLOW_CRM_SUPABASE_URL: "https://autre.supabase.co" }))).toBeUndefined();
    // La clé dédiée l'emporte ; sans URL dédiée, l'URL de PFlow Bots.
    expect(crmAlertConfigFromEnv(env({ ...bots, PFLOW_CRM_SERVICE_ROLE_KEY: "cle-crm" }))).toEqual({ url: "https://tekntxvkjhgyvbbwbogt.supabase.co", serviceKey: "cle-crm" });
    // Une seule des deux variables de PFlow Bots : rien.
    expect(crmAlertConfigFromEnv(env({ NEXT_PUBLIC_SUPABASE_URL: bots.NEXT_PUBLIC_SUPABASE_URL }))).toBeUndefined();
    expect(crmAlertConfigFromEnv(env({ SUPABASE_SERVICE_ROLE_KEY: "cle-bots" }))).toBeUndefined();
  });

  it("toutes les alertes partent sur l'appli : resto dans le titre, une notification par alerte (heure dans la clé)", async () => {
    const crm = fauxCrm();
    const t1 = new Date("2026-11-21T14:00:00.000Z");
    expect(await sendCrmAlert(crm.config, input, t1)).toEqual({ statut: "posee" });
    const [mien] = crm.rpc();
    expect(mien.headers.Authorization).toBe("Bearer service");
    expect(mien.body).toEqual({ p_cle: "mien:contact-1:2026-11-21T14:00:00.000Z", p_titre: "🔔 Je veux le mien", p_corps: "Marc : « C'est combien ? »", p_url: "/crm#bots" });
    // Transfert d'un client de resto (« parler à quelqu'un ») : même chemin, le resto dans le titre.
    const transfert = { ...input, resto: "Mexico", motif: "Le client demande à parler à l'équipe", contactName: "Léa", extrait: "je voudrais parler à quelqu'un" };
    expect(await sendCrmAlert(crm.config, transfert, new Date("2026-11-21T14:05:00.000Z"))).toEqual({ statut: "posee" });
    expect(crm.rpc()[1].body).toMatchObject({ p_cle: "alerte:contact-1:2026-11-21T14:05:00.000Z", p_titre: "🔔 Mexico · Le client demande à parler à l'équipe", p_corps: "Léa : « je voudrais parler à quelqu'un »" });
    // Deux alertes de la même conversation : deux clés différentes (deux notifications).
    expect(crm.rpc()[0].body!.p_cle).not.toBe(crm.rpc()[1].body!.p_cle);
    // Textes coupés aux longueurs de la file (titre 80, corps 110).
    const long = appAlertTexts({ ...transfert, motif: "x".repeat(200), extrait: "y".repeat(500) });
    expect(long.titre.length).toBeLessThanOrEqual(80);
    expect(long.corps.length).toBeLessThanOrEqual(110);
  });

  it("pas reçue par l'appli : aucun iPhone, notifications coupées dans le QG, pas configurée", async () => {
    expect(await sendCrmAlert(fauxCrm({ appareils: 0 }).config, input)).toMatchObject({ statut: "aucun_appareil" });
    expect(await sendCrmAlert(fauxCrm({ id: null }).config, input)).toMatchObject({ statut: "coupee" });
    expect(await sendCrmAlert(undefined, input)).toEqual({ statut: "non_configure" });
  });

  it("le CRM en erreur ne casse pas l'alerte (et ne la marque pas reçue)", async () => {
    const crm = fauxCrm({ status: 500 });
    expect(await sendCrmAlert(crm.config, input)).toEqual({ statut: "echec", erreur: "appli : appareils 500" });
    const res = await sendAlert({ store: createMemoryChannelStore([canal]), config: { crm: crm.config }, now: new Date() }, input);
    expect(res).toMatchObject({ voie: "aucune", appli: "echec" });
    expect(alertDelivered(res)).toBe(false);
    const plante = { ...crm.config, fetch: (async () => { throw new Error("réseau"); }) as unknown as typeof fetch };
    expect(await sendCrmAlert(plante, input)).toEqual({ statut: "echec", erreur: "appli : réseau" });
  });

  it("deux voies : reçue si l'appli OU le Web Push l'a prise ; « aucune » seulement si aucune des deux", async () => {
    // Web Push non configuré, appli OK : reçue par l'appli.
    const ok = await sendAlert({ store: createMemoryChannelStore([canal]), config: { crm: fauxCrm().config }, now: new Date() }, input);
    expect(ok).toMatchObject({ voie: "appli", push: "non_configure", appli: "posee" });
    expect(alertDelivered(ok)).toBe(true);
    // Aucun iPhone et pas de Web Push : non reçue, les deux raisons gardées.
    const rien = await sendAlert({ store: createMemoryChannelStore([canal]), config: { crm: fauxCrm({ appareils: 0 }).config }, now: new Date() }, input);
    expect(rien).toMatchObject({ voie: "aucune", appli: "aucun_appareil" });
    expect(rien.erreurs.join(" | ")).toContain("aucun iPhone enregistré");
    expect(rien.erreurs.join(" | ")).toContain("clés VAPID non définies");
  });

  it("nombre d'iPhone actifs (page État)", async () => {
    expect(await countAppDevices(fauxCrm({ appareils: 2 }).config)).toBe(2);
    expect(await countAppDevices(fauxCrm({ status: 500 }).config)).toBeNull();
    expect(await countAppDevices(undefined)).toBeNull();
  });
});
