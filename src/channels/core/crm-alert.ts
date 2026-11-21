/**
 * L'appli iPhone « PFlow » de Jules (dépôt Pflow-Crm, sql/qg160) : TOUTES les alertes qui lui sont destinées y
 * partent aussi (21/11) : transferts de tous les canaux (restos compris), questions sans réponse, « Je veux le mien »,
 * alertes techniques. Le Web Push reste envoyé en plus (src/channels/core/alerts.ts).
 *
 * PFlow Bots pose l'alerte dans la file du CRM (rpc public.app_alerte_bot, clé de service du projet Supabase du CRM) ;
 * la fonction qg-notifier du CRM l'envoie à l'appli (toutes les 2 min au plus).
 *   PFLOW_CRM_SUPABASE_URL           https://<projet du CRM>.supabase.co
 *   PFLOW_CRM_SERVICE_ROLE_KEY       clé service_role de ce projet
 * Sans PFLOW_CRM_SERVICE_ROLE_KEY (décision de Jules du 20/11) : PFlow Bots et le CRM partagent le même projet Supabase
 * (tekntxvkjhgyvbbwbogt), donc les variables déjà posées servent : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.
 * Garde-fou : si PFLOW_CRM_SUPABASE_URL désigne un AUTRE projet, la clé de PFlow Bots n'y est jamais envoyée.
 *
 * « Reçue par l'appli » = posée dans la file (la fonction rend un numéro) ET au moins un iPhone actif (app_appareils).
 * Sinon : « aucun_appareil » (aucun iPhone), « coupee » (notifications coupées dans le QG, ou clé déjà posée),
 * « non_configure », ou l'erreur. Ne lève jamais d'erreur.
 */
export interface CrmAlertConfig {
  url: string;
  serviceKey: string;
  /** Pour les tests. */
  fetch?: typeof fetch;
}


export function crmAlertConfigFromEnv(env: (name: string) => string): CrmAlertConfig | undefined {
  const propre = (v: string | undefined) => v?.trim().replace(/\/+$/, "") || undefined;
  const urlCrm = propre(env("PFLOW_CRM_SUPABASE_URL"));
  const cleCrm = env("PFLOW_CRM_SERVICE_ROLE_KEY")?.trim();
  if (cleCrm) {
    const url = urlCrm ?? propre(env("NEXT_PUBLIC_SUPABASE_URL"));
    return url ? { url, serviceKey: cleCrm } : undefined;
  }
  // Même projet Supabase que PFlow Bots : ses propres variables.
  const urlBots = propre(env("NEXT_PUBLIC_SUPABASE_URL"));
  const cleBots = env("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!urlBots || !cleBots) return undefined;
  if (urlCrm && urlCrm !== urlBots) return undefined; // autre projet : jamais la clé de PFlow Bots
  return { url: urlBots, serviceKey: cleBots };
}

export interface CrmAlertInput {
  motif: string;
  /** Resto du canal (ou « PFlow Démo ») : dans le titre, pour savoir d'où vient l'alerte. */
  resto?: string;
  contactName?: string;
  contactId: string;
  extrait?: string;
  conversationId?: string;
}

export type AppAlertStatut = "posee" | "aucun_appareil" | "coupee" | "non_configure" | "echec";
export interface AppAlertResult {
  statut: AppAlertStatut;
  erreur?: string;
}

/** Titre et texte de la notification de l'appli (qg_notifs : titre 80, corps 110 caractères au plus). */
export function appAlertTexts(input: CrmAlertInput): { titre: string; corps: string } {
  const qui = input.contactName?.trim() || (input.contactId ? `+${input.contactId}` : "");
  const titre = `🔔 ${input.resto ? `${input.resto} · ` : ""}${input.motif}`.slice(0, 80);
  const extrait = input.extrait ? `« ${input.extrait.replace(/\s+/g, " ").trim()} »` : "";
  const corps = [qui, extrait].filter(Boolean).join(" : ") || "Un client attend une réponse.";
  return { titre, corps: corps.slice(0, 110) };
}

/** Pose l'alerte dans la file de l'appli. Une alerte = une notification (l'heure est dans la clé). */
export async function sendCrmAlert(config: CrmAlertConfig | undefined, input: CrmAlertInput, now: Date = new Date()): Promise<AppAlertResult> {
  if (!config) return { statut: "non_configure" };
  const f = config.fetch ?? fetch;
  const headers = { "Content-Type": "application/json", apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` };
  const { titre, corps } = appAlertTexts(input);
  try {
    const appareils = await f(`${config.url}/rest/v1/app_appareils?actif=eq.true&select=id&limit=1`, { headers, signal: AbortSignal.timeout(4000) });
    if (!appareils.ok) return { statut: "echec", erreur: `appli : appareils ${appareils.status}` };
    const actifs = (await appareils.json().catch(() => [])) as unknown[];
    const res = await f(`${config.url}/rest/v1/rpc/app_alerte_bot`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_cle: `${input.motif === "Je veux le mien" ? "mien" : "alerte"}:${input.conversationId || input.contactId || "pflow"}:${now.toISOString()}`,
        p_titre: titre,
        p_corps: corps,
        p_url: "/crm#bots",
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { statut: "echec", erreur: `appli : file ${res.status}` };
    const id = await res.json().catch(() => null);
    if (id === null || id === undefined) return { statut: "coupee", erreur: "appli : notifications coupées dans le QG" };
    if (!Array.isArray(actifs) || actifs.length === 0) return { statut: "aucun_appareil", erreur: "appli : aucun iPhone enregistré" };
    return { statut: "posee" };
  } catch (error) {
    return { statut: "echec", erreur: `appli : ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Nombre d'iPhone actifs de l'appli (page État) ; null si l'appli n'est pas configurée ou ne répond pas. */
export async function countAppDevices(config: CrmAlertConfig | undefined): Promise<number | null> {
  if (!config) return null;
  try {
    const res = await (config.fetch ?? fetch)(`${config.url}/rest/v1/app_appareils?actif=eq.true&select=id`, {
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const rows = (await res.json().catch(() => null)) as unknown;
    return Array.isArray(rows) ? rows.length : null;
  } catch {
    return null;
  }
}
