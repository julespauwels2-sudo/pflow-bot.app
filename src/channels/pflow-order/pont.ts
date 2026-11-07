/**
 * Pont vers PFlow Order (étape C5) : l'API existante /api/pont du CRM, la même que les bots UChat
 * (header x-pflow-cle = PONT_CLE du CRM). Actions utilisées : « suivi » (où en est la dernière commande
 * du client) et « annulation » (annulation automatique si possible, remboursée si payée). Le texte pour
 * le client est rédigé par PFlow Order.
 * Variables : PFLOW_ORDER_PONT_CLE (même valeur que PONT_CLE du projet CRM, copiée par Jules) et
 * PFLOW_ORDER_URL (facultatif, https://order.pflow.fr par défaut). Sans clé : pas de pont (texte de repli).
 */
import type { OrderBridge } from "@/engine";

export const DEFAULT_PFLOW_ORDER_URL = "https://order.pflow.fr";

export function createOrderBridge(config: { baseUrl: string; cle: string; fetch?: typeof fetch; timeoutMs?: number }): OrderBridge {
  const doFetch = config.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const url = `${config.baseUrl.replace(/\/$/, "")}/api/pont`;
  return async ({ action, slug, tel }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 8000);
    try {
      const response = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-pflow-cle": config.cle },
        body: JSON.stringify({ action, slug, client_tel: tel }),
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; texte?: string; code?: string } | null;
      if (!json || typeof json.texte !== "string") throw new Error(`réponse illisible (HTTP ${response.status})`);
      return { ok: response.ok && json.ok !== false, texte: json.texte, ...(json.code ? { code: json.code } : {}) };
    } finally {
      clearTimeout(timer);
    }
  };
}

export function orderBridgeFromEnv(env: Record<string, string | undefined> = process.env): OrderBridge | undefined {
  const cle = env.PFLOW_ORDER_PONT_CLE?.trim();
  if (!cle) return undefined;
  return createOrderBridge({ baseUrl: env.PFLOW_ORDER_URL?.trim() || DEFAULT_PFLOW_ORDER_URL, cle });
}
