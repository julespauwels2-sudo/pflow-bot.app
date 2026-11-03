"use client";

import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { memo, useEffect, type ReactNode } from "react";
import type { FlowNode } from "@/engine";
import { TEXTS, smartDelayMs } from "@/engine";
import { BLOCKS, hasInput, nodeOutputs, shortId } from "@/editor/catalog";
import { WA_LIMITS } from "@/editor/limits";
import { describeRule } from "@/editor/describe";
import type { RFNode } from "./state";
import { useEditor } from "./context";

/** Texte avec les variables {{...}} affichées en pastilles. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\{\{\s*[a-zA-Z0-9_]+\s*\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/.exec(part);
        return m ? (
          <span key={i} className="mx-0.5 rounded bg-pink/15 px-1 font-mono text-[11px] font-semibold text-pink">
            {m[1]}
          </span>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

/** Bulle de message telle que le client la verra dans WhatsApp. */
function Bubble({ text, placeholder, children }: { text?: string; placeholder?: string; children?: ReactNode }) {
  const empty = !text?.trim();
  return (
    <div className="rounded-xl rounded-tl-sm bg-white px-2.5 py-1.5 text-[12.5px] leading-snug whitespace-pre-wrap text-navy shadow-[0_1px_1px_rgb(0_0_0/0.08)]">
      {empty ? <span className="text-muted/70 italic">{placeholder ?? "Texte vide"}</span> : <RichText text={text!} />}
      {children}
    </div>
  );
}

/** Ligne avec sa propre sortie (bouton, choix de liste, vrai / faux…). */
function OutputRow({ id, children, tone = "default" }: { id: string; children: ReactNode; tone?: "default" | "danger" }) {
  return (
    <div className="relative -mx-3 px-3">
      <div
        className={`rounded-lg border px-2 py-1 text-center text-[12px] font-semibold ${
          tone === "danger" ? "border-coral/30 bg-coral/5 text-coral" : "border-blue/20 bg-white text-blue"
        }`}
      >
        {children}
      </div>
      <Handle type="source" position={Position.Right} id={id} className="!size-3 !border-2 !border-white !bg-blue" />
    </div>
  );
}

/** « + Ajouter un bouton » directement sur le bloc Message. */
function AddButton({ node, visible }: { node: Extract<FlowNode, { type: "message" }>; visible: boolean }) {
  const { updateData } = useEditor();
  const buttons = node.data.buttons ?? [];
  if (buttons.length >= WA_LIMITS.buttonsMax) return null;
  return (
    <button
      type="button"
      className={`nodrag nopan w-full rounded-lg border border-dashed border-blue/40 py-1 text-[12px] font-semibold text-blue hover:bg-blue/5 ${visible ? "" : "hidden group-hover:block"}`}
      onClick={(e) => {
        e.stopPropagation();
        const next = [...buttons, { id: `b${shortId()}`, title: `Option ${buttons.length + 1}` }];
        updateData(node.id, { ...node.data, buttons: next }, `${node.id}:buttons:add`);
      }}
    >
      + Ajouter un bouton
    </button>
  );
}

function Body({ node, selected }: { node: FlowNode; selected: boolean }) {
  const { flows, orderUrl } = useEditor();
  switch (node.type) {
    case "trigger":
      if (node.data.isDefault) {
        return (
          <div className="space-y-1">
            <span className="inline-block rounded-full bg-navy px-2 py-0.5 text-[11px] font-semibold text-white">Flux par défaut</span>
            <p className="text-[11px] text-muted">N&apos;importe quel message, si aucun mot-clé ne correspond et qu&apos;aucune conversation n&apos;est en cours.</p>
            {node.data.keywords.length > 0 && <p className="text-[11px] text-muted">+ mots-clés : {node.data.keywords.join(", ")}</p>}
          </div>
        );
      }
      return node.data.keywords.length ? (
        <div className="flex flex-wrap gap-1">
          {node.data.keywords.map((k, i) => (
            <span key={i} className="rounded-full bg-pink/10 px-2 py-0.5 text-[12px] font-semibold text-pink">
              {k}
            </span>
          ))}
          {node.data.matchMode === "exact" && <span className="text-[11px] text-muted">(message exact)</span>}
        </div>
      ) : (
        <p className="text-[12px] text-muted italic">Aucun mot-clé</p>
      );

    case "message":
      return (
        <div className="space-y-1.5">
          <Bubble text={node.data.text} placeholder="Message vide" />
          {(node.data.buttons ?? []).map((b) => (
            <OutputRow key={b.id} id={b.id}>
              {b.title || "Sans titre"}
            </OutputRow>
          ))}
          <AddButton node={node} visible={selected} />
        </div>
      );

    case "delay":
      return (
        <p className="flex items-center gap-2 text-[12.5px]">
          <span className="inline-flex gap-0.5 rounded-full bg-white px-2 py-1 shadow-[0_1px_1px_rgb(0_0_0/0.08)]" aria-hidden>
            <span className="size-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted" />
          </span>
          {node.data.mode === "intelligent" ? (
            <span>
              Délai intelligent <span className="text-muted">({smartDelayMs("") / 1000} à 5 s selon le message suivant)</span>
            </span>
          ) : (
            <span>{(node.data.seconds ?? 2).toLocaleString("fr-FR")} s · en train d&apos;écrire…</span>
          )}
        </p>
      );

    case "buttons":
      return (
        <div className="space-y-1.5">
          <Bubble text={node.data.text} />
          {node.data.buttons.map((b) => (
            <OutputRow key={b.id} id={b.id}>
              {b.title || "Sans titre"}
            </OutputRow>
          ))}
        </div>
      );

    case "list":
      return (
        <div className="space-y-1.5">
          <Bubble text={node.data.text}>
            <div className="mt-1.5 border-t border-rule pt-1 text-center text-[12px] font-semibold text-blue">☰ {node.data.buttonLabel || "…"}</div>
          </Bubble>
          {node.data.items.map((item) => (
            <OutputRow key={item.id} id={item.id}>
              {item.title || "Sans titre"}
            </OutputRow>
          ))}
        </div>
      );

    case "question":
      return (
        <div className="space-y-1.5">
          <Bubble text={node.data.text} placeholder="Question vide" />
          <p className="text-[11px] text-muted">
            Réponse → <span className="font-mono font-semibold text-pink">{node.data.variable || "?"}</span> ({node.data.validation.replace("_", "/")})
          </p>
          <OutputRow id="next">Réponse valide</OutputRow>
          <OutputRow id="echec" tone="danger">
            Après {(node.data.maxRetries ?? 2) + 1} réponses invalides
          </OutputRow>
        </div>
      );

    case "condition":
      return (
        <div className="space-y-1.5">
          <ul className="space-y-0.5 text-[12px]">
            {node.data.rules.length === 0 && <li className="text-muted italic">Aucune règle</li>}
            {node.data.rules.map((r, i) => (
              <li key={i}>
                {i > 0 && <span className="mr-1 text-[10px] font-semibold text-muted uppercase">{node.data.match === "une" ? "ou" : "et"}</span>}
                {describeRule(r)}
              </li>
            ))}
          </ul>
          <OutputRow id="vrai">✓ Vrai</OutputRow>
          <OutputRow id="faux" tone="danger">
            ✕ Faux
          </OutputRow>
        </div>
      );

    case "order_link":
      return (
        <Bubble text={node.data.text || TEXTS.orderLink}>
          <div className="mt-1.5 border-t border-rule pt-1 text-center text-[12px] font-semibold text-blue">🔗 {node.data.buttonLabel || TEXTS.orderButton}</div>
          <div className="truncate text-center text-[10px] text-muted">{orderUrl}</div>
        </Bubble>
      );

    case "ai":
      return (
        <div className="space-y-1.5">
          {node.data.intro?.trim() && <Bubble text={node.data.intro} />}
          <p className="text-[11px] text-muted">
            Répond avec la fiche d&apos;infos jusqu&apos;à un mot-clé ou un transfert.
            {node.data.instructions?.trim() && <span className="block italic">« {node.data.instructions.trim().slice(0, 80)} »</span>}
          </p>
        </div>
      );

    case "handoff":
      return (
        <div className="space-y-1.5">
          <Bubble text={node.data.text || TEXTS.handoff} />
          <p className="text-[11px] text-muted">Bot en pause pour ce contact · gérant prévenu</p>
        </div>
      );

    case "goto_flow": {
      const target = flows.find((f) => f.id === node.data.flowId);
      return <p className="text-[13px] font-semibold">→ {target ? target.name : <span className="text-coral">Flux à choisir</span>}</p>;
    }

    case "end":
      return (
        <div className="space-y-1.5">
          {node.data.text?.trim() && <Bubble text={node.data.text} />}
          <p className="text-[11px] text-muted">Fin de la conversation</p>
        </div>
      );
  }
}

function BlockNodeComponent({ id, type, data, selected }: NodeProps<RFNode>) {
  const { issues } = useEditor();
  const updateNodeInternals = useUpdateNodeInternals();
  const node = { id, type, data, position: { x: 0, y: 0 } } as FlowNode;
  const info = BLOCKS[node.type];
  const nodeIssues = issues.get(id) ?? [];
  const errors = nodeIssues.filter((i) => i.level === "error");
  const warnings = nodeIssues.filter((i) => i.level === "warning");
  const outputs = nodeOutputs(node);
  const rowOutputs =
    node.type === "buttons" ||
    node.type === "list" ||
    node.type === "question" ||
    node.type === "condition" ||
    (node.type === "message" && (node.data.buttons?.length ?? 0) > 0);
  const outputKey = outputs.map((o) => o.id).join("|");

  // Les poignées changent quand on ajoute / retire un bouton : React Flow doit les remesurer.
  useEffect(() => updateNodeInternals(id), [id, outputKey, updateNodeInternals]);

  const ring = selected
    ? "ring-2 ring-pink"
    : errors.length
      ? "ring-2 ring-coral"
      : warnings.length
        ? "ring-1 ring-amber-400"
        : "ring-1 ring-line";

  return (
    <div className={`group w-[260px] rounded-2xl bg-white shadow-card ${ring}`} title={nodeIssues.map((i) => i.message).join("\n") || undefined}>
      {hasInput(node) && <Handle type="target" position={Position.Left} className="!top-6 !size-3 !border-2 !border-white !bg-navy" />}
      <div className="flex items-center gap-2 rounded-t-2xl border-b border-rule px-3 py-2">
        <span className={`grid size-6 place-items-center rounded-lg text-[13px] ${info.accent}`}>{info.icon}</span>
        <span className="flex-1 truncate font-title text-[13px] font-semibold">{info.label}</span>
        {errors.length > 0 && <span className="rounded-full bg-coral px-1.5 text-[11px] font-bold text-white">{errors.length}</span>}
        {errors.length === 0 && warnings.length > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-white">!</span>}
      </div>
      <div className="rounded-b-2xl bg-[#efe7dd]/60 px-3 py-2.5">
        <Body node={node} selected={!!selected} />
        {errors.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px] font-semibold text-coral">
            {errors.slice(0, 3).map((e, i) => (
              <li key={i}>⚠ {e.message}</li>
            ))}
            {errors.length > 3 && <li>+ {errors.length - 3} autre(s)</li>}
          </ul>
        )}
        {errors.length === 0 && warnings.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px] text-amber-700">
            {warnings.slice(0, 2).map((w, i) => (
              <li key={i}>• {w.message}</li>
            ))}
          </ul>
        )}
      </div>
      {!rowOutputs && outputs.length === 1 && (
        // En haut, à hauteur du titre : la poignée ne bouge pas quand le bloc change de taille.
        <Handle type="source" position={Position.Right} id={outputs[0].id} className="!top-6 !size-3 !border-2 !border-white !bg-blue" />
      )}
    </div>
  );
}

export const BlockNode = memo(BlockNodeComponent);
