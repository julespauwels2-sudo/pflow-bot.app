/** Dépendances serveur de la démo automatique (routes /api/demo/* et /api/cron/demo). */
import { getChannelsRuntime } from "@/channels/core/runtime";
import { DEFAULT_BOTS_URL, etape3Seconds, type DemoAutoDeps } from "./demo-auto";

export async function demoAutoDeps(): Promise<DemoAutoDeps | null> {
  const runtime = await getChannelsRuntime();
  const graph = runtime.senders.whatsapp;
  if (!graph) return null;
  return {
    store: runtime.store,
    graph,
    secret: process.env.PFLOW_BOTS_SECRET?.trim() || undefined,
    botsUrl: process.env.PFLOW_BOTS_PUBLIC_URL?.trim() || DEFAULT_BOTS_URL,
    etape3Seconds: etape3Seconds(process.env.PFLOW_DEMO_ETAPE3_SECONDES),
  };
}
