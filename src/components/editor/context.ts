"use client";

import { createContext, useContext } from "react";
import type { FlowNode } from "@/engine";
import type { Issue } from "@/editor/lint";
import type { VariableInfo } from "@/editor/variables";

export interface EditorContextValue {
  issues: Map<string, Issue[]>;
  variables: VariableInfo[];
  /** Autres flux du client (pour « Aller à un flux »). */
  flows: { id: string; name: string }[];
  flowId: string;
  orderUrl: string;
  updateData: (id: string, data: FlowNode["data"], key: string) => void;
  deleteEdge: (id: string) => void;
  /** Vue en lecture seule (simulateur) : pas de boutons d'ajout sur les blocs. */
  readOnly?: boolean;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor doit être utilisé dans l'éditeur");
  return ctx;
}
