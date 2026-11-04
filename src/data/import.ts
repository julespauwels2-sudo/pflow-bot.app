/**
 * Import des données de l'étape A (navigateur) dans Supabase : modèle maître, agent IA, flux,
 * dossiers, fiche du bot et journal IA, rattachés aux restos du CRM. Fonction pure : elle prépare
 * les nouvelles données, l'écriture se fait ensuite (tables bot_ uniquement).
 */
import type { FlowNode, InfoSheet } from "@/engine";
import type { FlowGraph, StoredFlow, WorkspaceData } from "./types";

export interface ImportOptions {
  /** Id du client du navigateur → id du resto du CRM ("" ou absent : pas importé). */
  mapping: Record<string, string>;
  /** Champs de la fiche venant du CRM, par resto (jamais remplacés). */
  locked: Record<string, (keyof InfoSheet)[]>;
}

export interface ImportResult {
  data: WorkspaceData;
  done: string[];
  warnings: string[];
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Correspondance proposée : même slug, sinon même nom (sans accents ni casse). */
export function suggestMapping(local: WorkspaceData, remote: WorkspaceData): Record<string, string> {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const mapping: Record<string, string> = {};
  for (const c of local.clients) {
    const match =
      remote.clients.find((r) => r.orderSlug && r.orderSlug === c.orderSlug) ?? remote.clients.find((r) => norm(r.nomResto) === norm(c.nomResto));
    mapping[c.id] = match?.id ?? "";
  }
  return mapping;
}

function remapGraph(graph: FlowGraph, flowIds: Map<string, string>): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n): FlowNode => (n.type === "goto_flow" && flowIds.has(n.data.flowId) ? { ...n, data: { flowId: flowIds.get(n.data.flowId)! } } : n)),
  };
}

export function planImport(local: WorkspaceData, remote: WorkspaceData, options: ImportOptions): ImportResult {
  const data = structuredClone(remote);
  const done: string[] = [];
  const warnings: string[] = [];
  const existingFlowIds = new Set(data.flows.map((f) => f.id));
  const existingFolderIds = new Set(data.folders.map((f) => f.id));
  const existingCallIds = new Set(data.aiCalls.map((c) => c.id));
  /** Ids des flux du navigateur → ids dans Supabase (pour « Aller à un flux » et les personnalisations). */
  const flowIds = new Map<string, string>();

  // 1. Modèle maître
  const localTemplate = local.templates[0];
  const remoteTemplate = data.templates[0];
  let templateId: string | undefined;
  if (localTemplate && !remoteTemplate) {
    data.templates.push(structuredClone(localTemplate));
    templateId = localTemplate.id;
    for (const f of local.folders.filter((f) => f.ownerId === localTemplate.id)) if (!existingFolderIds.has(f.id)) data.folders.push(structuredClone(f));
    const flows = local.flows.filter((f) => f.ownerKind === "template" && f.ownerId === localTemplate.id);
    for (const f of flows) {
      flowIds.set(f.id, f.id);
      if (!existingFlowIds.has(f.id)) data.flows.push(structuredClone(f));
    }
    done.push(`Modèle maître « ${localTemplate.name} » : ${flows.length} flux${localTemplate.agent ? ", agent IA" : ""}.`);
  } else if (localTemplate && remoteTemplate) {
    templateId = remoteTemplate.id;
    // Les flux du modèle se retrouvent par leur nom.
    const remoteByName = new Map(data.flows.filter((f) => f.ownerId === remoteTemplate.id).map((f) => [f.name.trim().toLowerCase(), f.id]));
    for (const f of local.flows.filter((f) => f.ownerId === localTemplate.id)) {
      const id = remoteByName.get(f.name.trim().toLowerCase());
      if (id) flowIds.set(f.id, id);
    }
    warnings.push(`Un modèle maître existe déjà dans Supabase (« ${remoteTemplate.name} ») : celui du navigateur n'est pas importé.`);
  }

  // 2. Clients
  for (const client of local.clients) {
    const restaurantId = options.mapping[client.id];
    if (!restaurantId) {
      warnings.push(`« ${client.nomResto} » : non importé (aucun resto du CRM choisi).`);
      continue;
    }
    const target = data.clients.find((c) => c.id === restaurantId);
    if (!target) {
      warnings.push(`« ${client.nomResto} » : resto du CRM introuvable, non importé.`);
      continue;
    }
    if (data.flows.some((f) => f.ownerId === restaurantId)) {
      warnings.push(`« ${target.nomResto} » avait déjà des flux dans Supabase : ceux du navigateur s'y ajoutent.`);
    }

    target.triggerMode = client.triggerMode;
    if (client.template && templateId) target.template = { templateId, linkedAt: client.template.linkedAt };

    const ownFlows = local.flows.filter((f) => f.ownerKind === "client" && f.ownerId === client.id);
    for (const f of ownFlows) flowIds.set(f.id, f.id);
    for (const f of local.folders.filter((f) => f.ownerId === client.id)) {
      if (!existingFolderIds.has(f.id)) data.folders.push({ ...structuredClone(f), ownerId: restaurantId });
    }
    let imported = 0;
    for (const f of ownFlows) {
      if (existingFlowIds.has(f.id)) {
        warnings.push(`Flux « ${f.name} » déjà importé : ignoré.`);
        continue;
      }
      const copy: StoredFlow = { ...structuredClone(f), ownerId: restaurantId };
      if (copy.overridesTemplateFlowId) {
        const mapped = flowIds.get(copy.overridesTemplateFlowId);
        if (mapped) copy.overridesTemplateFlowId = mapped;
        else {
          delete copy.overridesTemplateFlowId;
          delete copy.basedOnTemplateVersion;
          warnings.push(`« ${f.name} » : flux du modèle introuvable, importé comme flux propre au client.`);
        }
      }
      copy.draft = remapGraph(copy.draft, flowIds);
      if (copy.published) copy.published = remapGraph(copy.published, flowIds);
      data.flows.push(copy);
      imported += 1;
    }

    // Fiche : les champs du CRM ne sont jamais remplacés ; ailleurs, on ne remplit que le vide.
    const localSheet = local.infoSheets[client.id];
    const sheet: InfoSheet = data.infoSheets[restaurantId] ?? { horaires: [] };
    const locked = new Set(options.locked[restaurantId] ?? []);
    const filled: string[] = [];
    if (localSheet) {
      for (const [key, value] of Object.entries(localSheet) as [keyof InfoSheet, unknown][]) {
        if (locked.has(key) || isEmpty(value) || !isEmpty(sheet[key])) continue;
        (sheet as unknown as Record<string, unknown>)[key] = structuredClone(value);
        filled.push(key);
      }
    }
    data.infoSheets[restaurantId] = sheet;

    const calls = local.aiCalls.filter((c) => c.clientId === client.id && !existingCallIds.has(c.id));
    data.aiCalls.push(...calls.map((c) => ({ ...c, clientId: restaurantId })));

    done.push(
      `« ${client.nomResto} » → « ${target.nomResto} » : ${imported} flux${filled.length ? `, fiche (${filled.length} champ${filled.length > 1 ? "s" : ""})` : ""}${calls.length ? `, ${calls.length} appel${calls.length > 1 ? "s" : ""} IA` : ""}${target.template ? ", lié au modèle" : ""}.`,
    );
  }

  data.aiCalls.sort((a, b) => a.at.localeCompare(b.at));
  return { data, done, warnings };
}
