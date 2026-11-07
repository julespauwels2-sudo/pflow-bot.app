/**
 * Configuration et dépendances des canaux côté serveur. Chaque plateforme n'est active que si ses
 * variables sont définies ; rien n'est actif sans elles. Stockage :
 * - « supabase » (prod) : tables de la migration C, clé SUPABASE_SERVICE_ROLE_KEY ;
 * - « memory » (tests locaux, CHANNELS_STORE=memory ou WHATSAPP_STORE=memory, données de démonstration) :
 *   jamais sur Vercel.
 */
import { createClient } from "@supabase/supabase-js";
import { serverAiPort } from "@/ai/server-port";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import type { Repositories } from "@/data/repositories";
import { supabaseDb } from "@/data/supabase/db";
import { createSupabaseStore } from "@/data/supabase/store";
import { createMasterTemplate } from "@/data/template-seed";
import type { WorkspaceData } from "@/data/types";
import { createInstagramSender } from "../instagram/send";
import { createGraphClient } from "../whatsapp/graph";
import { transcriberFromEnv } from "../voice/transcriber";
import { orderBridgeFromEnv } from "../pflow-order/pont";
import { demoDirectory } from "@/demos/lifecycle";
import { loadBotFromWorkspace } from "./bot-loader";
import { createMemoryChannelStore } from "./memory-store";
import type { ProcessorDeps } from "./processor";
import { createSupabaseChannelStore } from "./supabase-store";
import type { Canal, ChannelSender, ChannelStore, Plateforme } from "./types";

export const DEFAULT_GRAPH_BASE = "https://graph.facebook.com";
export const DEFAULT_INSTAGRAM_BASE = "https://graph.instagram.com";
export const DEFAULT_GRAPH_VERSION = "v24.0";

const env = (name: string) => process.env[name]?.trim() || "";

export function storeMode(): "supabase" | "memory" {
  return env("CHANNELS_STORE") === "memory" || env("WHATSAPP_STORE") === "memory" ? "memory" : "supabase";
}

function storeMissing(): string[] {
  if (storeMode() === "memory") return env("VERCEL") ? ["CHANNELS_STORE=memory interdit sur Vercel"] : [];
  return ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((name) => !env(name));
}

export type PlatformConfig =
  | { ready: false; missing: string[] }
  | { ready: true; appSecret: string; verifyToken: string; token: string; graphBase: string; graphVersion: string };

function platformConfig(prefix: "WHATSAPP" | "INSTAGRAM", defaultBase: string): PlatformConfig {
  const missing = [`${prefix}_APP_SECRET`, `${prefix}_VERIFY_TOKEN`, `${prefix}_TOKEN`].filter((name) => !env(name)).concat(storeMissing());
  if (missing.length) return { ready: false, missing };
  return {
    ready: true,
    appSecret: env(`${prefix}_APP_SECRET`),
    verifyToken: env(`${prefix}_VERIFY_TOKEN`),
    token: env(`${prefix}_TOKEN`),
    graphBase: env(`${prefix}_GRAPH_BASE`) || defaultBase,
    graphVersion: env(`${prefix}_GRAPH_VERSION`) || DEFAULT_GRAPH_VERSION,
  };
}

export const readWhatsAppConfig = () => platformConfig("WHATSAPP", DEFAULT_GRAPH_BASE);
export const readInstagramConfig = () => platformConfig("INSTAGRAM", DEFAULT_INSTAGRAM_BASE);
export const readPlatformConfig = (p: Plateforme) => (p === "whatsapp" ? readWhatsAppConfig() : readInstagramConfig());

export interface ChannelsRuntime {
  mode: "supabase" | "memory";
  store: ChannelStore;
  /** Envoi par plateforme (absent si la plateforme n'est pas configurée). */
  senders: Partial<Record<Plateforme, ChannelSender>>;
  /** Dépendances du traitement d'une notification de cette plateforme. */
  deps(plateforme: Plateforme): ProcessorDeps | null;
  /** Données des bots (clients, flux, fiches). */
  workspace(): Promise<WorkspaceData>;
}

/** Code de démo fictif (mode mémoire) : la page de démonstration du CRM l'attend sur 20 caractères. */
export const MEMORY_DEMO_CODE = "0123456789abcdef0123";

/**
 * Données de démonstration (mode mémoire) : le modèle maître et un resto lié, comme Cookies An Nou ;
 * plus, pour le numéro PFlow, une démo en cours (« Byron ») et une démo expirée (« Gwada Food »).
 */
async function demoWorkspace(): Promise<WorkspaceData> {
  const repos = createLocalRepositories(createMemoryStore());
  const template = await createMasterTemplate(repos);
  const client = await repos.clients.create({ nomResto: "Cookies An Nou (démo)", orderSlug: "cookies-an-nou" });
  await repos.bots.link(client.id, template.id);
  await repos.infoSheets.save(client.id, {
    horaires: [2, 3, 4, 5].map((jour) => ({ jour: jour as 2 | 3 | 4 | 5, plages: [{ de: "08:00", a: "12:00" }] })),
    livraison: true,
    zonesLivraison: "• Jarry : livraison offerte",
    joursLivraison: [{ id: "j1", zone: "Jarry", jours: [2, 3, 5] }],
    pointsDeVente: "• Station Vito, Le Gosier",
    modesPaiement: "Espèces, carte",
  });
  const byron = await repos.clients.create({ nomResto: "Byron", orderSlug: "byron-vrai-slug" });
  await repos.bots.link(byron.id, template.id);
  await repos.infoSheets.save(byron.id, { horaires: [1, 2, 3, 4, 5, 6, 7].map((jour) => ({ jour: jour as 1, plages: [{ de: "00:00", a: "23:59" }] })), retrait: true });
  await repos.demos.start(byron.id);
  const gwada = await repos.clients.create({ nomResto: "Gwada Food", orderSlug: "gwada-food" });
  await repos.bots.link(gwada.id, template.id);
  await repos.demos.start(gwada.id);
  const data = await repos.workspace.exportAll();
  data.clients.find((c) => c.id === byron.id)!.demoCode = MEMORY_DEMO_CODE;
  const expired = data.demos.find((d) => d.clientId === gwada.id)!;
  expired.expiresAt = new Date(Date.now() - 86_400_000).toISOString();
  return data;
}

const globalRuntime = globalThis as unknown as { __pflowChannels?: Promise<ChannelsRuntime> };

export function getChannelsRuntime(): Promise<ChannelsRuntime> {
  globalRuntime.__pflowChannels ??= buildRuntime().catch((error) => {
    globalRuntime.__pflowChannels = undefined;
    throw error;
  });
  return globalRuntime.__pflowChannels;
}

function senders(): Partial<Record<Plateforme, ChannelSender>> {
  const result: Partial<Record<Plateforme, ChannelSender>> = {};
  const wa = readWhatsAppConfig();
  if (wa.ready) result.whatsapp = createGraphClient({ token: wa.token, base: wa.graphBase, version: wa.graphVersion });
  const ig = readInstagramConfig();
  if (ig.ready) result.instagram = createInstagramSender({ token: ig.token, base: ig.graphBase, version: ig.graphVersion });
  return result;
}

async function buildRuntime(): Promise<ChannelsRuntime> {
  const ai = serverAiPort();
  const sendersByPlatform = senders();
  const secret = env("PFLOW_BOTS_SECRET") || undefined;
  const transcriber = transcriberFromEnv();
  let store: ChannelStore;
  let repos: Repositories;
  let workspace: () => Promise<WorkspaceData>;

  if (storeMode() === "memory") {
    const data = await demoWorkspace();
    repos = createLocalRepositories(createMemoryStore(data));
    const client = data.clients.find((c) => c.template && !data.demos.some((d) => d.clientId === c.id)) ?? data.clients[0];
    const base = {
      restaurantId: client?.id ?? "",
      triggerMode: client?.triggerMode ?? ("mots_cles_uniquement" as const),
      echoPauseHours: 12,
      handoffPauseHours: 24,
      sessionMinutes: 30,
      etat: "actif" as const,
      testNumeros: [],
    };
    const canaux: Canal[] = [
      { ...base, id: "canal-demo", plateforme: "whatsapp", accountId: env("WHATSAPP_DEMO_PHONE_ID") || "1000000000", wabaId: "waba-demo", numeroAffiche: "+590 690 00 00 00", coexistence: true },
      { ...base, id: "canal-demo-instagram", plateforme: "instagram", accountId: env("INSTAGRAM_DEMO_ACCOUNT_ID") || "17841400000000000", numeroAffiche: "@cookies.an.nou (démo)", coexistence: true },
      // Numéro PFlow (démos) : partagé par toutes les démos.
      { ...base, id: "canal-pflow", role: "pflow", restaurantId: "", triggerMode: "toujours", plateforme: "whatsapp", accountId: env("WHATSAPP_PFLOW_PHONE_ID") || "1000000099", numeroAffiche: "Numéro PFlow (démos)", coexistence: false },
    ];
    store = createMemoryChannelStore(canaux);
    workspace = () => repos.workspace.exportAll();
  } else {
    const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    const db = supabaseDb(sb);
    const workspaceStore = createSupabaseStore(db);
    repos = createLocalRepositories(workspaceStore, { crmClients: true, lockedFields: (id) => workspaceStore.lockedFields(id) });
    store = createSupabaseChannelStore(db);
    workspace = () => workspaceStore.read();
  }

  return {
    mode: storeMode(),
    store,
    senders: sendersByPlatform,
    workspace,
    deps(plateforme) {
      const graph = sendersByPlatform[plateforme];
      if (!graph) return null;
      return {
        store,
        graph,
        ai,
        loadBot: async (id, options) => loadBotFromWorkspace(await workspace(), id, options),
        loadDemos: async () => demoDirectory(await workspace()),
        onAiCall: async (info) => void (await logAiCall(repos, info)),
        pflowBotsSecret: secret,
        transcriber,
        orderBridge: storeMode() === "memory" ? undefined : orderBridgeFromEnv(),
      };
    },
  };
}

async function logAiCall(repos: Repositories, info: Parameters<NonNullable<ProcessorDeps["onAiCall"]>>[0]) {
  await repos.aiCalls.add({
    clientId: info.restaurantId,
    at: new Date().toISOString(),
    // « whatsapp » = canal réel, Instagram compris : la contrainte de bot_appels_ia n'accepte pas encore
    // « instagram » (élargie dans la migration C, non appliquée).
    source: "whatsapp",
    model: info.result?.model ?? info.request.model,
    message: info.request.message,
    ...(info.result ? { decision: info.result.decision, usage: info.result.usage, costUsd: info.result.costUsd } : {}),
    ...(info.error ? { error: info.error } : {}),
  });
}
