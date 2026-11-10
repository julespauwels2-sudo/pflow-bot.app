/**
 * Schémas de validation (zod) : tout JSON qui entre dans l'app (import, et plus tard API)
 * passe par ici. Ils reflètent les types de `src/engine/types.ts`.
 */
import { z } from "zod";
import { migrateRawGraph, migrateRawNode } from "./migrate";
import { ORDER_EVENT_TYPES, type OrderEvent } from "@/engine/events";

const id = z.string().min(1).max(200);
const hhmm = z.string().regex(/^([01]?\d|2[0-4]):[0-5]\d$/, "Heure au format HH:MM");
const weekday = z.literal([1, 2, 3, 4, 5, 6, 7]);
const position = z.object({ x: z.number(), y: z.number() });
const option = z.object({ id, title: z.string(), description: z.string().optional() });

export const conditionRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("variable"),
    variable: z.string(),
    operator: z.enum(["egal", "different", "contient", "existe", "vide", "superieur", "inferieur"]),
    value: z.string().optional(),
  }),
  z.object({ kind: z.literal("jour"), jours: z.array(weekday) }),
  z.object({ kind: z.literal("heure"), de: hhmm, a: hhmm }),
  z.object({ kind: z.literal("ouvert_maintenant") }),
]);

const nodeBase = { id, position };

export const flowNodeSchema = z.discriminatedUnion("type", [
  z.object({
    ...nodeBase,
    type: z.literal("trigger"),
    data: z.object({
      keywords: z.array(z.string()),
      matchMode: z.enum(["contient", "exact"]).optional(),
      isDefault: z.boolean().optional(),
      event: z.enum(ORDER_EVENT_TYPES as [OrderEvent, ...OrderEvent[]]).optional(),
    }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal("message"),
    data: z.object({
      bubbles: z.array(
        z.object({
          id,
          text: z.string(),
          buttons: z.array(
            z.discriminatedUnion("kind", [
              z.object({ id, kind: z.literal("reply"), title: z.string() }),
              z.object({ id, kind: z.literal("link"), title: z.string(), url: z.string().optional(), orderLink: z.boolean().optional() }),
            ]),
          ),
        }),
      ),
    }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal("list"),
    data: z.object({ text: z.string(), buttonLabel: z.string(), items: z.array(option) }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal("question"),
    data: z.object({
      text: z.string(),
      variable: z.string(),
      validation: z.enum(["texte", "nombre", "telephone", "oui_non"]),
      errorText: z.string().optional(),
      maxRetries: z.number().int().min(0).max(10).optional(),
    }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal("condition"),
    data: z.object({ rules: z.array(conditionRuleSchema), match: z.enum(["toutes", "une"]).optional() }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal("ai"),
    data: z.object({
      intro: z.string().optional(),
      input: z.string().optional(),
      instructions: z.string().optional(),
      functions: z.array(z.string()).optional(),
      inactivityMinutes: z.number().int().min(1).max(1440).optional(),
      choixCarte: z.boolean().optional(),
    }),
  }),
  z.object({ ...nodeBase, type: z.literal("handoff"), data: z.object({ text: z.string().optional() }) }),
  z.object({ ...nodeBase, type: z.literal("commande"), data: z.object({ action: z.enum(["suivi", "annulable", "annulation"]) }) }),
  z.object({ ...nodeBase, type: z.literal("goto_flow"), data: z.object({ flowId: z.string() }) }),
  z.object({ ...nodeBase, type: z.literal("end"), data: z.object({ text: z.string().optional() }) }),
  z.object({
    ...nodeBase,
    type: z.literal("delay"),
    data: z.object({ mode: z.enum(["fixe", "intelligent"]), seconds: z.number().min(0).max(60).optional() }),
  }),
]);

export const flowEdgeSchema = z.object({
  id,
  source: id,
  sourceHandle: z.string().nullable().optional(),
  target: id,
});

/** Graphe au format actuel. Les anciens formats sont convertis avant validation. */
export const flowGraphSchema = z.preprocess(
  migrateRawGraph,
  z.object({
    nodes: z.array(flowNodeSchema),
    edges: z.array(flowEdgeSchema),
  }),
);

/** Un bloc seul (presse-papiers) : ancien format converti avant validation. */
export const flowNodeInputSchema = z.preprocess(migrateRawNode, flowNodeSchema);

export const infoSheetSchema = z.object({
  horaires: z.array(z.object({ jour: weekday, plages: z.array(z.object({ de: hhmm, a: hhmm })) })),
  horairesNote: z.string().optional(),
  adresse: z.string().optional(),
  livraison: z.boolean().optional(),
  livraisonMode: z.enum(["zones", "planning"]).optional(),
  tournees: z
    .array(
      z.object({
        id,
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ"),
        de: hhmm.optional(),
        a: hhmm.optional(),
        lieux: z.string(),
      }),
    )
    .optional(),
  joursLivraison: z
    .array(z.object({ id, zone: z.string(), jours: z.array(weekday), note: z.string().optional() }))
    .optional(),
  retrait: z.boolean().optional(),
  paiementEnLigne: z.object({ mode: z.enum(["choix", "obligatoire", "non"]), aConfigurer: z.boolean() }).optional(),
  modesPaiement: z.string().optional(),
  zonesLivraison: z.string().optional(),
  pointsDeVente: z.string().optional(),
  resumeCarte: z.string().optional(),
  faq: z.string().optional(),
  reglesSpeciales: z.string().optional(),
  familles: z.array(z.object({ titre: z.string(), precision: z.string().optional(), jours: z.array(weekday).optional() })).optional(),
  conseilChoix: z.string().optional(),
});

export const slugSchema = z
  .string()
  .min(1, "Slug obligatoire")
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug : minuscules, chiffres et tirets uniquement (ex. chez-paul)");

const timestamp = z.string();

export const clientSchema = z.object({
  id,
  nomResto: z.string().min(1),
  /** Vide possible pour un resto du CRM sans slug (ex. démo) ; un client créé ici a toujours un slug. */
  orderSlug: z.union([slugSchema, z.literal("")]),
  timezone: z.string().min(1),
  /** Anciennes sauvegardes sans ce champ : mode le plus prudent. */
  triggerMode: z.enum(["mots_cles_uniquement", "toujours"]).default("mots_cles_uniquement"),
  template: z.object({ templateId: id, linkedAt: z.string() }).optional(),
  options: z.object({ panier_abandonne: z.boolean().optional() }).optional(),
  crmStatut: z.string().optional(),
  hasBotRecord: z.boolean().optional(),
  botDisabledAt: z.string().optional(),
  demoCode: z.string().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const folderSchema = z.object({
  id,
  ownerId: id,
  name: z.string().min(1),
  order: z.number().int().min(0),
});

/** Anciennes données : `clientId` devient le propriétaire « client ». */
function migrateFlowOwner(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const flow = raw as Record<string, unknown>;
  if (flow.ownerId !== undefined || typeof flow.clientId !== "string") return raw;
  const { clientId, ...rest } = flow;
  return { ...rest, ownerKind: "client", ownerId: clientId };
}

export const templateSchema = z.object({
  id,
  name: z.string().min(1),
  agent: z
    .object({
      consigne: z.string().optional(),
      model: z.string().optional(),
      dailyLimit: z.number().int().min(1).max(500).optional(),
      inactivityMinutes: z.number().int().min(1).max(1440).optional(),
      functions: z
        .array(
          z.object({
            name: z.string(),
            flowId: z.string(),
            description: z.string(),
            aiText: z.enum(["silence", "avant", "variable"]).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const storedFlowObject = z.object({
  id,
  ownerKind: z.enum(["client", "template"]),
  ownerId: id,
  folderId: id.optional(),
  overridesTemplateFlowId: id.optional(),
  basedOnTemplateVersion: z.number().int().min(0).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  draft: flowGraphSchema,
  published: flowGraphSchema.nullable(),
  publishedMeta: z.object({ name: z.string(), description: z.string().optional() }).nullable(),
  publishedAt: timestamp.nullable(),
  version: z.number().int().min(0),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const storedFlowSchema = z.preprocess(migrateFlowOwner, storedFlowObject);

const usageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
});

export const aiCallSchema = z.object({
  id,
  clientId: id,
  at: z.string(),
  source: z.enum(["simulateur", "whatsapp"]),
  model: z.string().optional(),
  message: z.string(),
  decision: z
    .object({ action: z.enum(["repondre", "fonction", "transfert_humain"]), fonction: z.string().optional(), texte: z.string().optional() })
    .optional(),
  usage: usageSchema.optional(),
  costUsd: z.number().nullable().optional(),
  error: z.string().optional(),
});

export const demoSchema = z.object({
  clientId: z.string().min(1),
  keyword: z.string().min(1).max(40),
  days: z.number().int().min(1).max(60),
  startedAt: z.string(),
  expiresAt: z.string(),
  deletedAt: z.string().optional(),
});

export const workspaceSchema = z.object({
  clients: z.array(clientSchema),
  flows: z.array(storedFlowSchema),
  /** Absent dans les sauvegardes d'avant les dossiers. */
  folders: z.array(folderSchema).default([]),
  /** Absent dans les sauvegardes d'avant le modèle maître. */
  templates: z.array(templateSchema).default([]),
  infoSheets: z.record(z.string(), infoSheetSchema),
  /** Absent dans les sauvegardes d'avant l'agent IA. */
  aiCalls: z.array(aiCallSchema).default([]),
  /** Absent dans les sauvegardes d'avant les démos. */
  demos: z.array(demoSchema).default([]),
});

/** Fichier d'export d'un flux. */
export const FLOW_EXPORT_FORMAT = "pflow-bots/flow";
export const flowExportSchema = z.object({
  format: z.literal(FLOW_EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: z.string(),
  flow: z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    graph: flowGraphSchema,
  }),
});

/** Fichier de sauvegarde complète. */
export const BACKUP_FORMAT = "pflow-bots/backup";
export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  exportedAt: z.string(),
  data: workspaceSchema,
});
