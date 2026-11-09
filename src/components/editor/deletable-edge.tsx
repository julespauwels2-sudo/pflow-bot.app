"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { useEditor } from "./context";

/** Flèche avec un bouton « supprimer » quand elle est sélectionnée. */
export function DeletableEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style } = props;
  const { deleteEdge } = useEditor();
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 16 });

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeWidth: selected ? 2.5 : 2, stroke: selected ? "#FF4FB5" : "rgba(243,238,230,0.45)" }} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="nodrag nopan pointer-events-auto absolute grid size-6 place-items-center rounded-full bg-coral text-xs font-bold text-white shadow-card"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            aria-label="Supprimer la flèche"
            title="Supprimer la flèche (Suppr)"
            onClick={() => deleteEdge(id)}
          >
            ✕
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
