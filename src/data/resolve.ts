/**
 * Assemblage du bot d'un client : flux publiés du modèle maître (ou leur personnalisation pour
 * ce client) + flux propres au client, filtrés selon ses options. C'est la seule source des flux
 * donnés au moteur (simulateur, webhook WhatsApp).
 */
import { findTrigger, infoSheetVariables, type Flow, type InfoSheet } from "@/engine";
import { lintFlow, nodeTexts } from "@/editor/lint";
import { usedVariables } from "@/editor/variables";
import { BOT_OPTIONS, optionForEvent } from "./options";
import { toEngineFlow, type BotClient, type BotFolder, type StoredFlow } from "./types";

export type FlowOrigin = "modele" | "personnalise" | "client";

export interface ResolvedFlow {
  /** Id du flux dans le bot (pour un flux du modèle ou sa personnalisation : id du flux du modèle). */
  botId: string;
  origin: FlowOrigin;
  name: string;
  /** Flux réellement utilisé (le flux du modèle, la copie personnalisée, ou le flux du client). */
  source: StoredFlow;
  /** Flux du modèle d'origine (modèle ou personnalisé). */
  templateFlow?: StoredFlow;
  /** Nom du dossier (dossier du modèle pour un flux du modèle). */
  folderName?: string;
  /** Faux : le flux n'est pas donné au moteur. */
  active: boolean;
  inactiveReason?: string;
  /** Personnalisé, mais le flux du modèle a été republié depuis. */
  templateChanged?: boolean;
  engineFlow: Flow | null;
}

export interface BotInput {
  client: BotClient;
  /** Flux du modèle lié (vide si le client n'est pas lié). */
  templateFlows: StoredFlow[];
  templateFolders?: BotFolder[];
  clientFlows: StoredFlow[];
  clientFolders?: BotFolder[];
  /** Simulateur : utiliser les brouillons au lieu des versions publiées. */
  useDrafts?: boolean;
}

/** Version donnée au moteur : publiée, ou brouillon (simulateur). */
function engineVersion(flow: StoredFlow, useDrafts: boolean | undefined): Flow | null {
  if (useDrafts) return { id: flow.id, name: flow.name, description: flow.description, nodes: flow.draft.nodes, edges: flow.draft.edges };
  return toEngineFlow(flow);
}

function folderName(folders: BotFolder[] | undefined, id: string | undefined) {
  return id ? folders?.find((f) => f.id === id)?.name : undefined;
}

export function resolveBot(input: BotInput): { entries: ResolvedFlow[]; flows: Flow[] } {
  const { client, clientFlows } = input;
  const linked = Boolean(client.template);
  const templateFlows = linked ? input.templateFlows.filter((f) => f.ownerKind === "template" && f.ownerId === client.template!.templateId) : [];
  const templateIds = new Set(templateFlows.map((f) => f.id));
  const overrides = new Map<string, StoredFlow>();
  for (const f of clientFlows) if (f.overridesTemplateFlowId && templateIds.has(f.overridesTemplateFlowId)) overrides.set(f.overridesTemplateFlowId, f);

  const entries: ResolvedFlow[] = [];
  // Flux du client d'abord : en cas de mot-clé identique, ils l'emportent sur le modèle.
  for (const f of clientFlows) {
    if (f.overridesTemplateFlowId && overrides.get(f.overridesTemplateFlowId) === f) continue;
    entries.push({
      botId: f.id,
      origin: "client",
      name: f.name,
      source: f,
      folderName: folderName(input.clientFolders, f.folderId),
      active: true,
      engineFlow: engineVersion(f, input.useDrafts),
    });
  }
  for (const t of templateFlows) {
    const override = overrides.get(t.id);
    const source = override ?? t;
    entries.push({
      botId: t.id,
      origin: override ? "personnalise" : "modele",
      name: source.name,
      source,
      templateFlow: t,
      folderName: folderName(input.templateFolders, t.folderId),
      active: true,
      templateChanged: override ? t.version > (override.basedOnTemplateVersion ?? 0) : undefined,
      engineFlow: engineVersion(source, input.useDrafts),
    });
  }

  for (const e of entries) {
    if (client.botDisabledAt) {
      e.active = false;
      e.inactiveReason = "Bot désactivé";
      continue;
    }
    if (!e.engineFlow) {
      e.active = false;
      e.inactiveReason = "Jamais publié";
      continue;
    }
    const option = optionForEvent(findTrigger(e.engineFlow)?.data.event);
    if (option && !client.options?.[option]) {
      e.active = false;
      e.inactiveReason = `Option « ${BOT_OPTIONS[option].label} » non activée`;
    }
  }

  const flows = entries.filter((e) => e.active && e.engineFlow).map((e) => ({ ...e.engineFlow!, id: e.botId }));
  return { entries, flows };
}

/** Liste des flux du bot pour l'éditeur (Aller à un flux, unicité du flux par défaut et des événements). */
export function botFlowList(entries: ResolvedFlow[]): { id: string; name: string; isDefault?: boolean; event?: string }[] {
  return entries.map((e) => {
    const trigger = findTrigger({ id: e.botId, name: e.name, ...e.source.draft })?.data;
    return { id: e.botId, name: e.name, isDefault: trigger?.isDefault, event: trigger?.event };
  });
}

/**
 * Variables de la fiche d'infos sans lesquelles le bot répond mal : vides = point à vérifier.
 * {{infos_livraison}} s'y ajoute quand le resto livre. Toutes les autres sont facultatives.
 */
export const REQUIRED_INFO_VARIABLES = ["horaires", "horaires_du_jour", "adresse", "modes_service", "infos_pratiques"] as const;

export type ClientTab = "clients" | "demos";

/**
 * Onglet de la page Clients : « Démos » pour le statut démo du CRM, « Clients » pour les autres (signé,
 * actif, ou un ancien statut d'un resto qui a déjà un bot). Recalculé à chaque chargement depuis le CRM :
 * un resto qui passe de démo à signé change d'onglet tout seul.
 */
export function clientTab(crmStatut: string | undefined): ClientTab {
  return crmStatut === "demo" ? "demos" : "clients";
}

export interface ChecklistItem {
  level: "error" | "warning" | "info";
  message: string;
}

/** Points à vérifier pour ce client (onboarding) : fiche incomplète, réglages, flux du modèle. */
export function botChecklist(input: BotInput, infoSheet: InfoSheet, now: Date): ChecklistItem[] {
  const { client } = input;
  const { entries, flows } = resolveBot(input);
  const items: ChecklistItem[] = [];
  const seen = new Set<string>();
  const add = (level: ChecklistItem["level"], message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    items.push({ level, message });
  };

  if (!client.orderSlug) add("error", "Pas de slug du mini-site : les boutons « Commander » sont impossibles.");

  // Erreurs des flux actifs, vérifiées avec les réglages de ce client.
  const list = botFlowList(entries.filter((e) => e.active));
  for (const flow of flows) {
    for (const issue of lintFlow(flow, { flowId: flow.id, flows: list, orderSlug: client.orderSlug, triggerMode: "toujours" })) {
      if (issue.level === "error") add("error", `« ${flow.name} » : ${issue.message}`);
    }
  }

  // Variables de la fiche d'infos utilisées par le bot mais vides.
  const values = infoSheetVariables(infoSheet, now, client.timezone) as unknown as Record<string, string>;
  const usage = new Map<string, Set<string>>();
  for (const flow of flows) {
    for (const node of flow.nodes) {
      for (const text of nodeTexts(node)) {
        for (const v of usedVariables(text)) {
          if (v in values && !values[v]) usage.set(v, (usage.get(v) ?? new Set()).add(flow.name));
        }
      }
    }
  }
  // Infos obligatoires (le bot ne peut pas bien répondre sans) : point à vérifier. Les autres sont
  // facultatives (points de vente, paiement…) : leur titre n'est pas envoyé si elles sont vides, simple info.
  const required = new Set<string>(REQUIRED_INFO_VARIABLES);
  if (infoSheet.livraison) required.add("infos_livraison");
  for (const [v, names] of usage) {
    const used = [...names].map((n) => `« ${n} »`).join(", ");
    if (required.has(v)) add("warning", `{{${v}}} est vide dans la fiche d'infos (utilisé par ${used}).`);
    else add("info", `Facultatif : {{${v}}} est vide, rien n'est envoyé à sa place (utilisé par ${used}).`);
  }

  const defaultFlow = flows.find((f) => {
    const t = findTrigger(f)?.data;
    return t?.isDefault && !t.event;
  });
  if (client.triggerMode === "mots_cles_uniquement" && defaultFlow) {
    add("info", `Mode « mots-clés uniquement » : le flux par défaut « ${defaultFlow.name} » ne se lance pas sur ce numéro (seuls les mots-clés comptent).`);
  }
  for (const e of entries) {
    if (e.inactiveReason && e.inactiveReason !== "Jamais publié") add("info", `« ${e.name} » est inactif : ${e.inactiveReason}.`);
    if (e.templateChanged) add("warning", `Le modèle a changé depuis la personnalisation de « ${e.name} » : à revoir (ou « Revenir au modèle »).`);
  }
  return items;
}
