/** Export / import JSON : un flux seul, ou la sauvegarde complète. */
import type { z } from "zod";
import {
  BACKUP_FORMAT,
  FLOW_EXPORT_FORMAT,
  backupSchema,
  flowExportSchema,
} from "./schemas";
import type { StoredFlow, WorkspaceData } from "./types";

export type FlowExport = z.infer<typeof flowExportSchema>;
export type ParseResult<T> = { ok: true; value: T; warnings: string[] } | { ok: false; error: string };

/** Exporte le brouillon d'un flux (c'est la version qu'on édite). */
export function exportFlow(flow: StoredFlow, now = new Date()): FlowExport {
  return {
    format: FLOW_EXPORT_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    flow: { id: flow.id, name: flow.name, description: flow.description, graph: structuredClone(flow.draft) },
  };
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue.path.length ? ` (${issue.path.join(".")})` : "";
  return `${issue.message}${path}`;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Le fichier n'est pas un JSON valide" };
  }
}

/**
 * Lit un fichier de flux. `knownFlowIds` sert à signaler les blocs « Aller à un flux »
 * qui pointent vers un flux absent chez ce client.
 */
export function parseFlowImport(text: string, knownFlowIds: string[] = []): ParseResult<FlowExport["flow"]> {
  const json = parseJson(text);
  if (!json.ok) return json;
  const format = (json.value as { format?: unknown } | null)?.format;
  if (format === BACKUP_FORMAT) {
    return { ok: false, error: "Ce fichier est une sauvegarde complète, pas un flux. Utilisez « Restaurer une sauvegarde »." };
  }
  const parsed = flowExportSchema.safeParse(json.value);
  if (!parsed.success) return { ok: false, error: `Fichier de flux invalide : ${firstIssue(parsed.error)}` };

  const flow = parsed.data.flow;
  const warnings: string[] = [];
  const triggers = flow.graph.nodes.filter((n) => n.type === "trigger").length;
  if (triggers !== 1) warnings.push(`Le flux contient ${triggers} déclencheurs (il en faut exactement 1).`);
  for (const node of flow.graph.nodes) {
    if (node.type === "goto_flow" && !knownFlowIds.includes(node.data.flowId)) {
      warnings.push(`Le bloc « Aller à un flux » (${node.id}) pointe vers un flux absent : à reconfigurer.`);
    }
  }
  return { ok: true, value: flow, warnings };
}

export function exportBackup(data: WorkspaceData, now = new Date()) {
  return { format: BACKUP_FORMAT, version: 1 as const, exportedAt: now.toISOString(), data };
}

export function parseBackup(text: string): ParseResult<WorkspaceData> {
  const json = parseJson(text);
  if (!json.ok) return json;
  const parsed = backupSchema.safeParse(json.value);
  if (!parsed.success) return { ok: false, error: `Sauvegarde invalide : ${firstIssue(parsed.error)}` };
  return { ok: true, value: parsed.data.data, warnings: [] };
}

/** Nom de fichier lisible : « flux-accueil-2026-11-03.json ». */
export function exportFileName(prefix: string, name: string, now = new Date()): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${slug || "sans-nom"}-${now.toISOString().slice(0, 10)}.json`;
}
