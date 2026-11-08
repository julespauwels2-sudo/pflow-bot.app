/** Validation des échanges avec la route /api/ai (taille limitée pour borner le coût d'un appel). */
import { z } from "zod";
import { infoSheetSchema } from "@/data/schemas";

const text = (max: number) => z.string().max(max, `Texte trop long (${max} caractères maximum)`);

export const aiRequestSchema = z.object({
  message: text(2_000),
  history: z.array(z.object({ role: z.enum(["client", "assistant"]), text: text(4_000) })).max(20),
  client: z.object({
    nomResto: text(200),
    timezone: text(100),
    maintenantLocal: text(40),
    lienCommande: text(500),
    prenomContact: text(100).optional(),
    // Démo sur le numéro PFlow : sans ce champ, la route perdrait les règles de démo (zod retire l'inconnu).
    demo: z.object({ sansCarte: z.boolean(), ficheVide: z.boolean().optional() }).optional(),
  }),
  consigne: text(30_000),
  model: text(100).optional(),
  infoSheet: infoSheetSchema.refine((sheet) => JSON.stringify(sheet).length <= 60_000, "Fiche d'infos trop longue"),
  functions: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "Nom de fonction : minuscules, chiffres et _"),
        description: text(1_000),
      }),
    )
    .max(20),
  instructions: text(4_000).optional(),
});

export const aiDecisionSchema = z.object({
  action: z.enum(["repondre", "fonction", "transfert_humain"]),
  // Toujours présents avec les sorties structurées ; tolérés absents par sécurité.
  fonction: z.string().default(""),
  texte: z.string().default(""),
});
