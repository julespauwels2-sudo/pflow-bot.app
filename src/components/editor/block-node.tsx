"use client";

import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import type { FlowNode, MessageBubble } from "@/engine";
import { ORDER_EVENTS, TEXTS, smartDelayMs } from "@/engine";
import { addBubble, addLinkButton, addReplyButton, canAddBubble, canAddLink, canAddReply } from "@/editor/bubbles";
import { BLOCKS, hasInput, nodeOutputs } from "@/editor/catalog";
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
    <div className="rounded-xl rounded-tl-sm bg-verre px-2.5 py-1.5 text-[12.5px] leading-snug whitespace-pre-wrap text-ink shadow-[0_1px_1px_rgb(0_0_0/0.08)]">
      {empty ? <span className="text-muted/70 italic">{placeholder ?? "Texte vide"}</span> : <RichText text={text!} />}
      {children}
    </div>
  );
}

/** Ligne avec sa propre sortie (bouton, choix de liste, vrai / faux…). */
function OutputRow({ id, children, tone = "default" }: { id: string; children: ReactNode; tone?: "default" | "danger" | "muted" }) {
  const tones = {
    default: "border-blue/20 bg-verre text-blue",
    danger: "border-coral/30 bg-coral/5 text-coral",
    muted: "border-line bg-white/60 text-muted",
  };
  return (
    <div className="relative -mx-3 px-3">
      <div className={`rounded-lg border px-2 py-1 text-center text-[12px] font-semibold ${tones[tone]}`}>
        {children}
      </div>
      <Handle type="source" position={Position.Right} id={id} className="!size-3 !border-2 !border-navy-3 !bg-blue" />
    </div>
  );
}

/** Menu « + Ajouter un bouton » sous une bulle : bouton de réponse ou bouton lien. */
function AddButtonMenu({ node, bubble, visible }: { node: Extract<FlowNode, { type: "message" }>; bubble: MessageBubble; visible: boolean }) {
  const { updateData, readOnly } = useEditor();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const reply = canAddReply(bubble);
  const link = canAddLink(bubble);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (readOnly || (!reply.allowed && !link.allowed)) return null;
  const choose = (data: typeof node.data, key: string) => {
    updateData(node.id, data, `${node.id}:${key}`);
    setOpen(false);
  };
  const item = "block w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div ref={ref} className={`nodrag nopan relative ${visible || open ? "" : "hidden group-hover:block"}`}>
      <button
        type="button"
        className="w-full rounded-lg border border-dashed border-blue/40 py-1 text-[12px] font-semibold text-blue hover:bg-blue/5"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        + Ajouter un bouton
      </button>
      {open && (
        <div role="menu" className="absolute top-8 left-0 z-20 w-full overflow-hidden rounded-xl border border-line bg-verre shadow-pop">
          <button role="menuitem" type="button" className={item} disabled={!reply.allowed} title={reply.reason} onClick={() => choose(addReplyButton(node.data, bubble.id), "reply:add")}>
            <span className="font-semibold">↩︎ Bouton de réponse</span>
            <span className="block text-[11px] text-muted">{reply.reason ?? "Mène à une suite du flux"}</span>
          </button>
          <button role="menuitem" type="button" className={item} disabled={!link.allowed} title={link.reason} onClick={() => choose(addLinkButton(node.data, bubble.id), "link:add")}>
            <span className="font-semibold">🔗 Bouton lien</span>
            <span className="block text-[11px] text-muted">{link.reason ?? "Ouvre une page (lien de commande par défaut)"}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Bulles du bloc Message, chacune avec ses boutons. */
function MessageBody({ node, selected }: { node: Extract<FlowNode, { type: "message" }>; selected: boolean }) {
  const { updateData, orderUrl, readOnly } = useEditor();
  return (
    <div className="space-y-2.5">
      {node.data.bubbles.map((bubble, i) => (
        <div key={bubble.id} className="space-y-1">
          {node.data.bubbles.length > 1 && <p className="text-[10px] font-semibold tracking-wide text-muted uppercase">Bulle {i + 1}</p>}
          <Bubble text={bubble.text} placeholder="Bulle vide">
            {bubble.buttons
              .filter((b) => b.kind === "link")
              .map((b) => (
                <div key={b.id} className="mt-1.5 border-t border-rule pt-1 text-center">
                  <div className="text-[12px] font-semibold text-blue">🔗 {b.title || "Sans titre"}</div>
                  <div className="truncate text-[10px] text-muted">{b.kind === "link" && b.orderLink ? orderUrl : b.kind === "link" ? b.url : ""}</div>
                </div>
              ))}
          </Bubble>
          {bubble.buttons
            .filter((b) => b.kind === "reply")
            .map((b) => (
              <OutputRow key={b.id} id={b.id}>
                {b.title || "Sans titre"}
              </OutputRow>
            ))}
          <AddButtonMenu node={node} bubble={bubble} visible={selected} />
        </div>
      ))}
      {!readOnly && canAddBubble(node.data) && (
        <button
          type="button"
          className={`nodrag nopan w-full rounded-lg py-1 text-[12px] font-semibold text-muted hover:bg-white/70 hover:text-ink ${selected ? "" : "hidden group-hover:block"}`}
          onClick={(e) => {
            e.stopPropagation();
            updateData(node.id, addBubble(node.data), `${node.id}:bubble:add`);
          }}
        >
          + Ajouter une bulle
        </button>
      )}
      <OutputRow id="next" tone="muted">
        Étape suivante
      </OutputRow>
    </div>
  );
}

function Body({ node, selected }: { node: FlowNode; selected: boolean }) {
  const { flows } = useEditor();
  switch (node.type) {
    case "trigger":
      if (node.data.event) {
        const info = ORDER_EVENTS[node.data.event];
        return (
          <div className="space-y-1">
            <span className="inline-block rounded-full bg-navy-2 px-2 py-0.5 text-[11px] font-semibold text-white">
              {info.icon} Événement : {info.label}
            </span>
            <p className="text-[11px] text-muted">Envoyé par PFlow Order, seulement si le client a écrit au bot depuis moins de 24 h.</p>
          </div>
        );
      }
      if (node.data.isDefault) {
        return (
          <div className="space-y-1">
            <span className="inline-block rounded-full bg-navy-2 px-2 py-0.5 text-[11px] font-semibold text-white">Flux par défaut</span>
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
      return <MessageBody node={node} selected={selected} />;

    case "delay":
      return (
        <p className="flex items-center gap-2 text-[12.5px]">
          <span className="inline-flex gap-0.5 rounded-full bg-verre px-2 py-1 shadow-[0_1px_1px_rgb(0_0_0/0.08)]" aria-hidden>
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

    case "ai":
      return (
        <div className="space-y-1.5">
          {node.data.intro?.trim() && <Bubble text={node.data.intro} />}
          {node.data.input?.trim() && (
            <p className="rounded-lg bg-pink/10 px-2 py-1 text-[11px] text-ink">
              <span className="font-semibold">Entrée :</span> {node.data.input.trim().slice(0, 90)}
            </p>
          )}
          <p className="text-[11px] text-muted">
            {node.data.functions
              ? node.data.functions.length
                ? `Fonctions : ${node.data.functions.join(", ")}`
                : "Aucune fonction : répond ou passe la main"
              : "Toutes les fonctions de l'agent"}
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

    case "commande":
      return (
        <div className="space-y-1.5">
          <p className="text-[13px] font-semibold">
            {node.data.action === "annulation" ? "Annuler sa dernière commande" : node.data.action === "annulable" ? "Commande annulable ?" : "Suivi de sa dernière commande"}
          </p>
          <p className="text-[11px] text-muted">Réponse de PFlow Order envoyée au client</p>
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
  const rowOutputs = node.type === "list" || node.type === "question" || node.type === "condition" || node.type === "message";
  const outputKey = outputs.map((o) => o.id).join("|");

  // Les poignées changent quand on ajoute / retire un bouton : React Flow doit les remesurer.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, outputKey, updateNodeInternals]);

  const ring = selected
    ? "ring-2 ring-pink"
    : errors.length
      ? "ring-2 ring-coral"
      : warnings.length
        ? "ring-1 ring-amber-400"
        : "ring-1 ring-line";

  return (
    <div className={`group w-[260px] rounded-2xl bg-verre shadow-card ${ring}`} title={nodeIssues.map((i) => i.message).join("\n") || undefined}>
      {hasInput(node) && <Handle type="target" position={Position.Left} className="!top-6 !size-3 !border-2 !border-navy-3 !bg-navy" />}
      <div className="flex items-center gap-2 rounded-t-2xl border-b border-rule px-3 py-2">
        <span className={`grid size-6 place-items-center rounded-lg text-[13px] ${info.accent}`}>{info.icon}</span>
        <span className="flex-1 truncate font-title text-[13px] font-semibold">{info.label}</span>
        {errors.length > 0 && <span className="rounded-full bg-coral px-1.5 text-[11px] font-bold text-white">{errors.length}</span>}
        {errors.length === 0 && warnings.length > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-white">!</span>}
      </div>
      <div className="rounded-b-2xl bg-white/5 px-3 py-2.5">
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
          <ul className="mt-2 space-y-0.5 text-[11px] text-amber-300">
            {warnings.slice(0, 2).map((w, i) => (
              <li key={i}>• {w.message}</li>
            ))}
          </ul>
        )}
      </div>
      {!rowOutputs && outputs.length === 1 && (
        // En haut, à hauteur du titre : la poignée ne bouge pas quand le bloc change de taille.
        <Handle type="source" position={Position.Right} id={outputs[0].id} className="!top-6 !size-3 !border-2 !border-navy-3 !bg-blue" />
      )}
    </div>
  );
}

export const BlockNode = memo(BlockNodeComponent);
