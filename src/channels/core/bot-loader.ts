/** Bot d'un resto pour le canal : même assemblage que le simulateur (resolveBot + agent). */
import type { AgentConfig, ClientContext, Flow, InfoSheet } from "@/engine";
import { agentConfigFor, aiDailyLimit } from "@/data/agent";
import { resolveBot } from "@/data/resolve";
import type { WorkspaceData } from "@/data/types";
import { demoOrderUrl } from "@/demos/keyword";
import { MASTER_TEMPLATE_NAME } from "@/data/template-seed";
import { PFLOW_DEMO_BUTTONS } from "@/demos/pflow-bot";

export interface LoadedBot {
  client: ClientContext;
  flows: Flow[];
  infoSheet: InfoSheet;
  agent?: AgentConfig;
  aiDailyLimit: number;
}

/**
 * Null si le resto n'a pas de bot actif (pas de bot, désactivé, aucun flux publié).
 * demo : bot joué sur le numéro PFlow. Le bouton « Commander » ouvre TOUJOURS la page de commande de
 * démonstration du CRM (rien n'est écrit, aucun message ne part), jamais le vrai slug du resto ; sans
 * code de démo dans le CRM, pas de bouton.
 * Démo d'un resto qui n'a pas (encore) de bot publié (pas relié au modèle, brouillon seulement) : elle
 * joue le modèle maître, au nom du resto, avec sa fiche. Une démo active doit toujours répondre.
 */
/**
 * Démo dont ni la carte ni la fiche n'ont été remplies : aucun des champs saisis à la main (carte, FAQ, règles,
 * points de vente, précisions sur les horaires ou le paiement, jours de livraison, tournées). Restent alors
 * seulement les champs du CRM, qui ont des valeurs par défaut (livraison non, retrait oui) : pas fiables.
 */
export function isEmptyDemoSheet(sheet: InfoSheet): boolean {
  const filled = [sheet.resumeCarte, sheet.faq, sheet.reglesSpeciales, sheet.pointsDeVente, sheet.horairesNote, sheet.modesPaiement]
    .some((x) => Boolean(x?.trim()));
  return !filled && !sheet.joursLivraison?.length && !sheet.tournees?.length;
}

export function loadBotFromWorkspace(data: WorkspaceData, restaurantId: string, options: { demo?: boolean } = {}): LoadedBot | null {
  const found = data.clients.find((c) => c.id === restaurantId);
  if (!found || found.botDisabledAt) return null;
  let client = found;
  const resolveFor = (c: typeof found, own: boolean) => {
    const template = data.templates.find((t) => t.id === c.template?.templateId) ?? null;
    const templateFlows = template ? data.flows.filter((f) => f.ownerKind === "template" && f.ownerId === template.id) : [];
    const clientFlows = own ? data.flows.filter((f) => f.ownerKind === "client" && f.ownerId === c.id) : [];
    return { template, flows: resolveBot({ client: c, templateFlows, clientFlows }).flows };
  };
  let { template, flows } = resolveFor(client, true);
  if (!flows.length && options.demo) {
    const master = data.templates.find((t) => t.name === MASTER_TEMPLATE_NAME) ?? data.templates[0];
    if (master) {
      client = { ...found, template: { templateId: master.id, linkedAt: found.createdAt } };
      ({ template, flows } = resolveFor(client, false));
    }
  }
  if (!flows.length) return null;
  const infoSheet: InfoSheet = data.infoSheets[client.id] ?? { horaires: [] };
  return {
    client: options.demo
      ? {
          id: client.id,
          nomResto: client.nomResto,
          orderSlug: "",
          timezone: client.timezone,
          ...(demoOrderUrl(client.demoCode) ? { orderUrl: demoOrderUrl(client.demoCode) } : {}),
          // Sans carte dans la démo : l'IA ne cite aucun produit ni prix, et propose les boutons PFlow.
          // Ni carte ni fiche remplie : les champs du CRM ne sont que ses valeurs par défaut (inconnus pour l'IA).
          demo: { sansCarte: !infoSheet.resumeCarte?.trim(), ficheVide: isEmptyDemoSheet(infoSheet), boutons: structuredClone(PFLOW_DEMO_BUTTONS) },
        }
      : { id: client.id, nomResto: client.nomResto, orderSlug: client.orderSlug, timezone: client.timezone },
    flows,
    infoSheet,
    agent: agentConfigFor(client.template ? template : null, flows),
    aiDailyLimit: aiDailyLimit(client.template ? template : null),
  };
}
