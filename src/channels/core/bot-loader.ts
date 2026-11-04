/** Bot d'un resto pour le canal : même assemblage que le simulateur (resolveBot + agent). */
import type { AgentConfig, ClientContext, Flow, InfoSheet } from "@/engine";
import { agentConfigFor, aiDailyLimit } from "@/data/agent";
import { resolveBot } from "@/data/resolve";
import type { WorkspaceData } from "@/data/types";

export interface LoadedBot {
  client: ClientContext;
  flows: Flow[];
  infoSheet: InfoSheet;
  agent?: AgentConfig;
  aiDailyLimit: number;
}

/** Null si le resto n'a pas de bot actif (pas de bot, désactivé, aucun flux publié). */
export function loadBotFromWorkspace(data: WorkspaceData, restaurantId: string): LoadedBot | null {
  const client = data.clients.find((c) => c.id === restaurantId);
  if (!client || client.botDisabledAt) return null;
  const template = data.templates.find((t) => t.id === client.template?.templateId) ?? null;
  const templateFlows = template ? data.flows.filter((f) => f.ownerKind === "template" && f.ownerId === template.id) : [];
  const clientFlows = data.flows.filter((f) => f.ownerKind === "client" && f.ownerId === client.id);
  const { flows } = resolveBot({ client, templateFlows, clientFlows });
  if (!flows.length) return null;
  return {
    client: { id: client.id, nomResto: client.nomResto, orderSlug: client.orderSlug, timezone: client.timezone },
    flows,
    infoSheet: data.infoSheets[client.id] ?? { horaires: [] },
    agent: agentConfigFor(client.template ? template : null, flows),
    aiDailyLimit: aiDailyLimit(client.template ? template : null),
  };
}
