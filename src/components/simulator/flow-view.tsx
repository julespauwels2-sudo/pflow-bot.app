"use client";

import "@xyflow/react/dist/style.css";
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, type NodeChange, type NodeTypes } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type { Flow } from "@/engine";
import { BLOCKS } from "@/editor/catalog";
import { BlockNode } from "@/components/editor/block-node";
import { EditorContext, type EditorContextValue } from "@/components/editor/context";
import type { RFNode } from "@/components/editor/state";
import { flowVariables } from "@/editor/variables";

const nodeTypes: NodeTypes = Object.fromEntries(Object.keys(BLOCKS).map((t) => [t, BlockNode]));

/**
 * Le flux en cours, en lecture seule : le bloc en attente (ou le dernier exécuté) est surligné,
 * les blocs exécutés pendant le dernier tour sont marqués.
 */
export function FlowView({
  flow,
  flows,
  activeNodeId,
  trail,
  orderUrl,
}: {
  flow: Flow;
  flows: Flow[];
  activeNodeId?: string;
  trail: Set<string>;
  orderUrl: string;
}) {
  const ctx: EditorContextValue = useMemo(
    () => ({
      issues: new Map(),
      variables: flowVariables(flow.nodes),
      flows: flows.map((f) => ({ id: f.id, name: f.name })),
      flowId: flow.id,
      orderUrl,
      updateData: () => {},
      deleteEdge: () => {},
      readOnly: true,
    }),
    [flow, flows, orderUrl],
  );
  // Tailles mesurées par React Flow : nécessaires pour cadrer le flux (vue contrôlée).
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const onNodesChange = (changes: NodeChange<RFNode>[]) => {
    const next: Record<string, { width: number; height: number }> = {};
    for (const c of changes) if (c.type === "dimensions" && c.dimensions) next[`${flow.id}:${c.id}`] = c.dimensions;
    if (Object.keys(next).length) setMeasured((m) => ({ ...m, ...next }));
  };
  const nodes = useMemo(
    () =>
      flow.nodes.map(
        (n) =>
          ({
            ...structuredClone(n),
            ...(measured[`${flow.id}:${n.id}`] ? { measured: measured[`${flow.id}:${n.id}`] } : {}),
            selected: n.id === activeNodeId,
            className: n.id === activeNodeId ? "sim-active" : trail.has(n.id) ? "sim-trail" : "sim-idle",
          }) as RFNode,
      ),
    [flow, activeNodeId, trail, measured],
  );
  const edges = useMemo(
    () =>
      flow.edges.map((e) => ({
        ...e,
        sourceHandle: e.sourceHandle ?? "next",
        animated: trail.has(e.source) && (trail.has(e.target) || e.target === activeNodeId),
        style: { stroke: trail.has(e.source) && (trail.has(e.target) || e.target === activeNodeId) ? "#FF4FB5" : "rgba(243,238,230,0.45)", strokeWidth: 2 },
      })),
    [flow, trail, activeNodeId],
  );

  return (
    <EditorContext.Provider value={ctx}>
      <ReactFlowProvider>
        <ReactFlow<RFNode>
          colorMode="dark"
          key={flow.id}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="rgba(243,238,230,0.14)" />
          <FitOnReady />
        </ReactFlow>
      </ReactFlowProvider>
    </EditorContext.Provider>
  );
}

/** Cadre le flux une fois les blocs mesurés (leur taille dépend de leur contenu). */
function FitOnReady() {
  const ready = useNodesInitialized();
  const rf = useReactFlow();
  useEffect(() => {
    if (ready) rf.fitView({ padding: 0.15, maxZoom: 1 });
  }, [ready, rf]);
  return null;
}
