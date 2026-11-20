/** « Je veux le mien » sonne aussi sur l'appli iPhone de Jules (via le CRM, rpc app_alerte_bot). Au mieux, facultatif. */
import { describe, expect, it } from "vitest";
import { createMemoryChannelStore } from "@/channels/core/memory-store";
import type { Canal } from "@/channels/core/types";
import { alertConfigFromEnv, sendAlert } from "../alerts";
import { crmAlertConfigFromEnv, sendCrmAlert, type CrmAlertConfig } from "../crm-alert";

const canal: Canal = {
  id: "pflow", role: "pflow", restaurantId: "", plateforme: "whatsapp", accountId: "1000000099", triggerMode: "toujours", numeroAffiche: "PFlow Démo",
  coexistence: true, echoPauseHours: 12, handoffPauseHours: 24, sessionMinutes: 30, etat: "actif", testNumeros: [], telAlerte: "590690938108",
};
const input = { canal, motif: "Je veux le mien", contactName: "Marc", contactId: "590690111111", extrait: "C'est\n combien ?", conversationId: "contact-1" };

function fauxCrm(status = 200) {
  const appels: { url: string; headers: Record<string, string>; body: Record<string, string> }[] = [];
  const config: CrmAlertConfig = {
    url: "https://crm.supabase.co",
    serviceKey: "service",
    fetch: (async (url: string, o: RequestInit) => {
      appels.push({ url, headers: o.headers as Record<string, string>, body: JSON.parse(String(o.body)) });
      return new Response("1", { status });
    }) as unknown as typeof fetch,
  };
  return { config, appels };
}

describe("alerte vers l'appli iPhone (CRM)", () => {
  it("configuration : seulement si les deux variables sont posées", () => {
    const env = (vars: Record<string, string>) => (name: string) => vars[name] ?? "";
    expect(crmAlertConfigFromEnv(env({ PFLOW_CRM_SUPABASE_URL: "https://x.supabase.co" }))).toBeUndefined();
    expect(crmAlertConfigFromEnv(env({ PFLOW_CRM_SUPABASE_URL: "https://x.supabase.co/", PFLOW_CRM_SERVICE_ROLE_KEY: "k" }))).toEqual({ url: "https://x.supabase.co", serviceKey: "k" });
    expect(alertConfigFromEnv(env({ PFLOW_CRM_SUPABASE_URL: "https://x.supabase.co", PFLOW_CRM_SERVICE_ROLE_KEY: "k" }))).toEqual({ crm: { url: "https://x.supabase.co", serviceKey: "k" } });
  });

  it("« Je veux le mien » : l'alerte est posée dans le CRM", async () => {
    const crm = fauxCrm();
    expect(await sendCrmAlert(crm.config, input)).toBe("posee");
    expect(crm.appels).toHaveLength(1);
    expect(crm.appels[0].url).toBe("https://crm.supabase.co/rest/v1/rpc/app_alerte_bot");
    expect(crm.appels[0].headers.Authorization).toBe("Bearer service");
    expect(crm.appels[0].body).toEqual({ p_cle: "mien:contact-1", p_titre: "🔔 Je veux le mien : Marc", p_corps: "« C'est combien ? »", p_url: "/crm#bots" });
  });

  it("autres motifs, ou pas configuré : rien", async () => {
    const crm = fauxCrm();
    expect(await sendCrmAlert(crm.config, { ...input, motif: "Parler à Jules" })).toBe("ignoree");
    expect(await sendCrmAlert(undefined, input)).toBe("ignoree");
    expect(crm.appels).toHaveLength(0);
  });

  it("le CRM en erreur ne casse pas l'alerte (et ne la marque pas reçue)", async () => {
    const crm = fauxCrm(500);
    expect(await sendCrmAlert(crm.config, input)).toBe("crm 500");
    const res = await sendAlert({ store: createMemoryChannelStore([canal]), config: { crm: crm.config }, now: new Date() }, input);
    expect(res.voie).toBe("aucune");
    expect(crm.appels).toHaveLength(2);
    const plante = { ...crm.config, fetch: (async () => { throw new Error("réseau"); }) as unknown as typeof fetch };
    expect(await sendCrmAlert(plante, input)).toBe("crm : réseau");
  });
});
