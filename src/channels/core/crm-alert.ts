/**
 * L'appli iPhone « PFlow » de Jules (dépôt Pflow-Crm, branche app-mobile, sql/qg160) : quand un prospect touche
 * « Je veux le mien », une notification part aussi sur l'appli, avec son propre son (cloche).
 *
 * PFlow Bots pose l'alerte dans la file du CRM (rpc public.app_alerte_bot, clé de service du projet Supabase du CRM) ;
 * la fonction qg-notifier du CRM l'envoie à l'appli. Facultatif : sans les deux variables, rien ne change.
 *   PFLOW_CRM_SUPABASE_URL           https://<projet du CRM>.supabase.co
 *   PFLOW_CRM_SERVICE_ROLE_KEY       clé service_role de ce projet
 * Au mieux : ne lève jamais d'erreur et ne change pas le résultat de l'alerte push (src/channels/core/alerts.ts).
 */
export interface CrmAlertConfig {
  url: string;
  serviceKey: string;
  /** Pour les tests. */
  fetch?: typeof fetch;
}

/** Les motifs qui sonnent sur l'appli de Jules. */
export const CRM_MOTIFS = ["Je veux le mien"];

export function crmAlertConfigFromEnv(env: (name: string) => string): CrmAlertConfig | undefined {
  const url = env("PFLOW_CRM_SUPABASE_URL")?.trim().replace(/\/+$/, "");
  const serviceKey = env("PFLOW_CRM_SERVICE_ROLE_KEY")?.trim();
  return url && serviceKey ? { url, serviceKey } : undefined;
}

export interface CrmAlertInput {
  motif: string;
  contactName?: string;
  contactId: string;
  extrait?: string;
  conversationId?: string;
}

/** Pose l'alerte « prospect » dans le CRM. Rend « posee », « ignoree » (autre motif, pas configuré) ou l'erreur. */
export async function sendCrmAlert(config: CrmAlertConfig | undefined, input: CrmAlertInput): Promise<"posee" | "ignoree" | string> {
  if (!config || !CRM_MOTIFS.includes(input.motif)) return "ignoree";
  const qui = input.contactName?.trim() || `+${input.contactId}`;
  const body = {
    p_cle: `${input.motif === "Je veux le mien" ? "mien" : "bot"}:${input.conversationId || input.contactId}`,
    p_titre: `🔔 ${input.motif} : ${qui}`.slice(0, 120),
    p_corps: (input.extrait ? `« ${input.extrait.replace(/\s+/g, " ").trim()} »` : "Un prospect attend sa démo.").slice(0, 300),
    p_url: "/crm#bots",
  };
  try {
    const res = await (config.fetch ?? fetch)(`${config.url}/rest/v1/rpc/app_alerte_bot`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok ? "posee" : `crm ${res.status}`;
  } catch (error) {
    return `crm : ${error instanceof Error ? error.message : String(error)}`;
  }
}
