/**
 * Configuration et dépendances du canal WhatsApp côté serveur. Rien n'est actif tant que les variables
 * Meta ne sont pas définies. Stockage :
 * - « supabase » (prod) : tables de la migration C, clé SUPABASE_SERVICE_ROLE_KEY ;
 * - « memory » (tests locaux, WHATSAPP_STORE=memory, données de démonstration) : jamais sur Vercel.
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
import { loadBotFromWorkspace } from "./bot-loader";
import { createGraphClient } from "./graph";
import { createMemoryChannelStore } from "./memory-store";
import type { ProcessorDeps } from "./processor";
import { createSupabaseChannelStore } from "./supabase-store";
import type { Canal, ChannelStore } from "./types";

export const DEFAULT_GRAPH_BASE = "https://graph.facebook.com";
export const DEFAULT_GRAPH_VERSION = "v24.0";

export type WhatsAppConfig =
  | { ready: false; missing: string[] }
  | {
      ready: true;
      appSecret: string;
      verifyToken: string;
      token: string;
      graphBase: string;
      graphVersion: string;
      store: "supabase" | "memory";
    };

const env = (name: string) => process.env[name]?.trim() || "";

export function readWhatsAppConfig(): WhatsAppConfig {
  const memory = env("WHATSAPP_STORE") === "memory";
  const required = ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_TOKEN"];
  if (!memory) required.push("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const missing = required.filter((name) => !env(name));
  // Le stockage en mémoire ne sert qu'aux tests locaux : refusé sur Vercel.
  if (memory && env("VERCEL")) missing.push("WHATSAPP_STORE=memory interdit sur Vercel");
  if (missing.length) return { ready: false, missing };
  return {
    ready: true,
    appSecret: env("WHATSAPP_APP_SECRET"),
    verifyToken: env("WHATSAPP_VERIFY_TOKEN"),
    token: env("WHATSAPP_TOKEN"),
    graphBase: env("WHATSAPP_GRAPH_BASE") || DEFAULT_GRAPH_BASE,
    graphVersion: env("WHATSAPP_GRAPH_VERSION") || DEFAULT_GRAPH_VERSION,
    store: memory ? "memory" : "supabase",
  };
}

export interface WhatsAppRuntime {
  store: ChannelStore;
  deps: ProcessorDeps;
  /** Données des bots (clients, flux, fiches) : pour la boîte de réception (noms des restos). */
  workspace(): Promise<WorkspaceData>;
  mode: "supabase" | "memory";
}

/** Données de démonstration (mode mémoire) : le modèle maître et un resto lié, comme Cookies An Nou. */
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
  return repos.workspace.exportAll();
}

const globalRuntime = globalThis as unknown as { __pflowWhatsApp?: Promise<WhatsAppRuntime> };

export function getWhatsAppRuntime(config: Extract<WhatsAppConfig, { ready: true }>): Promise<WhatsAppRuntime> {
  globalRuntime.__pflowWhatsApp ??= buildRuntime(config).catch((error) => {
    globalRuntime.__pflowWhatsApp = undefined;
    throw error;
  });
  return globalRuntime.__pflowWhatsApp;
}

async function buildRuntime(config: Extract<WhatsAppConfig, { ready: true }>): Promise<WhatsAppRuntime> {
  const graph = createGraphClient({ token: config.token, base: config.graphBase, version: config.graphVersion });
  const ai = serverAiPort();

  if (config.store === "memory") {
    const data = await demoWorkspace();
    const repos: Repositories = createLocalRepositories(createMemoryStore(data));
    const client = data.clients.find((c) => c.template) ?? data.clients[0];
    const canal: Canal = {
      id: "canal-demo",
      restaurantId: client?.id ?? "",
      phoneNumberId: env("WHATSAPP_DEMO_PHONE_ID") || "1000000000",
      wabaId: "waba-demo",
      numeroAffiche: "+590 690 00 00 00",
      triggerMode: client?.triggerMode ?? "mots_cles_uniquement",
      coexistence: true,
      echoPauseHours: 12,
      handoffPauseHours: 24,
      sessionMinutes: 30,
      etat: "actif",
      testNumeros: [],
    };
    const store = createMemoryChannelStore([canal]);
    return {
      mode: "memory",
      store,
      workspace: () => repos.workspace.exportAll(),
      deps: {
        store,
        graph,
        ai,
        loadBot: async (id) => loadBotFromWorkspace(await repos.workspace.exportAll(), id),
        onAiCall: async (info) => void (await logAiCall(repos, info)),
      },
    };
  }

  const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const db = supabaseDb(sb);
  const workspaceStore = createSupabaseStore(db);
  const repos = createLocalRepositories(workspaceStore, { crmClients: true, lockedFields: (id) => workspaceStore.lockedFields(id) });
  const store = createSupabaseChannelStore(db);
  return {
    mode: "supabase",
    store,
    workspace: () => workspaceStore.read(),
    deps: {
      store,
      graph,
      ai,
      loadBot: async (id) => loadBotFromWorkspace(await workspaceStore.read(), id),
      onAiCall: async (info) => void (await logAiCall(repos, info)),
    },
  };
}

async function logAiCall(repos: Repositories, info: Parameters<NonNullable<ProcessorDeps["onAiCall"]>>[0]) {
  await repos.aiCalls.add({
    clientId: info.restaurantId,
    at: new Date().toISOString(),
    source: "whatsapp",
    model: info.result?.model ?? info.request.model,
    message: info.request.message,
    ...(info.result ? { decision: info.result.decision, usage: info.result.usage, costUsd: info.result.costUsd } : {}),
    ...(info.error ? { error: info.error } : {}),
  });
}
