"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DEFAULT_ORDER_BASE_URL, type FlowNode, type NodeType } from "@/engine";
import { getRepositories, errorText } from "@/data/browser";
import { exportFileName, exportFlow } from "@/data/transfer";
import { hasUnpublishedChanges, stableStringify, type BotClient, type FlowGraph, type StoredFlow } from "@/data/types";
import { BLOCKS, PALETTE, createNode } from "@/editor/catalog";
import { CLIPBOARD_KEY, parseClipboard } from "@/editor/clipboard";
import { issuesByNode, lintFlow, type Issue } from "@/editor/lint";
import { flowVariables } from "@/editor/variables";
import { downloadJson } from "@/lib/files";
import { BlockNode } from "./block-node";
import { EditorContext, type EditorContextValue } from "./context";
import { DeletableEdge } from "./deletable-edge";
import { NodeProperties } from "./properties";
import { copySelection, editorReducer, initEditor, type EditorState, type RFNode } from "./state";

/** Le flux tel que l'éditeur le voit au chargement (flèches invalides retirées). */
const initFlowGraph = (draft: FlowGraph) => initEditor(draft).history.present;

// Tous les types (y compris l'ancien bloc « Boutons », hors palette).
const nodeTypes: NodeTypes = Object.fromEntries(Object.keys(BLOCKS).map((t) => [t, BlockNode]));
const edgeTypes: EdgeTypes = { deletable: DeletableEdge };
const DRAG_TYPE = "application/x-pflow-block";
const AUTOSAVE_MS = 600;

interface Props {
  flow: StoredFlow;
  client: BotClient;
  /** Tous les flux du client (id, nom, flux par défaut ou non). */
  flows: { id: string; name: string; isDefault?: boolean }[];
}

export function FlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}

/** Première place libre en descendant à partir de `start` (évite d'empiler les blocs). */
function freeSpot(nodes: RFNode[], start: { x: number; y: number }) {
  const overlaps = (y: number) =>
    nodes.some((n) => {
      const w = n.measured?.width ?? 260;
      const h = n.measured?.height ?? 120;
      return start.x < n.position.x + w + 20 && start.x + 260 + 20 > n.position.x && y < n.position.y + h + 20 && y + 120 + 20 > n.position.y;
    });
  let y = start.y;
  for (let i = 0; i < 30 && overlaps(y); i++) y += 60;
  return { x: start.x, y };
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function EditorInner({ flow: initialFlow, client, flows }: Props) {
  const [state, dispatch] = useReducer(editorReducer, initialFlow.draft, initEditor);
  const [flow, setFlow] = useState(initialFlow);
  const [name, setName] = useState(initialFlow.name);
  const [savedJson, setSavedJson] = useState(() => stableStringify(initFlowGraph(initialFlow.draft)));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "info" | "error" | "success"; text: string } | null>(null);
  const rf = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<EditorState>(state);
  const pasteCount = useRef(0);

  const graph = state.history.present;
  const graphJson = useMemo(() => stableStringify(graph), [graph]);
  const issues = useMemo(() => lintFlow(graph, { flowId: flow.id, flows, orderSlug: client.orderSlug, triggerMode: client.triggerMode }),
    [graph, flow.id, flows, client.orderSlug, client.triggerMode],
  );
  const byNode = useMemo(() => issuesByNode(issues), [issues]);
  const errorCount = issues.filter((i) => i.level === "error").length;
  const selected = state.nodes.filter((n) => n.selected);
  const dirty = graphJson !== savedJson;
  const unpublished = hasUnpublishedChanges({ ...flow, draft: graph });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Cadrage initial, une fois les blocs mesurés (leur taille dépend de leur contenu).
  const nodesInitialized = useNodesInitialized();
  const framed = useRef(false);
  useEffect(() => {
    if (!nodesInitialized || framed.current) return;
    framed.current = true;
    rf.fitView({ padding: 0.15, maxZoom: 1 });
  }, [nodesInitialized, rf]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // --- Sauvegarde automatique du brouillon -------------------------------
  const pending = useRef<{ graph: FlowGraph; json: string } | null>(null);
  const saveNow = useCallback(() => {
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    // L'écriture dans le navigateur est synchrone : elle aboutit même si l'onglet se ferme.
    getRepositories()
      .flows.update(initialFlow.id, { draft: job.graph })
      .then(
        (saved) => {
          setFlow(saved);
          setSavedJson(job.json);
          setSaveError(null);
        },
        (error) => setSaveError(errorText(error)),
      );
  }, [initialFlow.id]);

  useEffect(() => {
    if (graphJson === savedJson) return;
    pending.current = { graph, json: graphJson };
    const timer = setTimeout(saveNow, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [graph, graphJson, savedJson, saveNow]);

  useEffect(() => {
    window.addEventListener("pagehide", saveNow);
    window.addEventListener("beforeunload", saveNow);
    return () => {
      window.removeEventListener("pagehide", saveNow);
      window.removeEventListener("beforeunload", saveNow);
      saveNow(); // navigation interne : on n'oublie rien
    };
  }, [saveNow]);

  // --- Actions -------------------------------------------------------------
  const now = () => Date.now();

  const addBlock = useCallback(
    (type: NodeType, screen?: { x: number; y: number }) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const point = screen ?? (rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 400, y: 300 });
      const pos = rf.screenToFlowPosition(point);
      const start = { x: Math.round(pos.x - 130), y: Math.round(pos.y - 40) };
      dispatch({ type: "add", node: createNode(type, screen ? start : freeSpot(stateRef.current.nodes, start)), now: now() });
    },
    [rf],
  );

  const copy = useCallback(() => {
    const payload = copySelection(stateRef.current);
    if (!payload) return;
    try {
      localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
    } catch {
      /* stockage plein : le copier échoue silencieusement */
    }
    pasteCount.current = 0;
    setToast({ tone: "info", text: `${payload.nodes.length} bloc(s) copié(s). Ctrl+V pour coller, ici ou dans un autre flux.` });
  }, []);

  const paste = useCallback(() => {
    const payload = parseClipboard(localStorage.getItem(CLIPBOARD_KEY));
    if (!payload) return;
    pasteCount.current += 1;
    dispatch({ type: "paste", payload, offset: 40 * pasteCount.current, now: now() });
    if (payload.nodes.some((n) => n.type === "trigger")) {
      setToast({ tone: "info", text: "Le déclencheur n'a pas été collé : un flux n'en a qu'un." });
    }
  }, []);

  const duplicate = useCallback(() => {
    const payload = copySelection(stateRef.current);
    if (payload) dispatch({ type: "paste", payload, offset: 40, now: now() });
  }, []);

  const focusNode = useCallback(
    (id: string) => {
      const node = stateRef.current.nodes.find((n) => n.id === id);
      if (!node) return;
      dispatch({ type: "selectOnly", ids: [id] });
      rf.setCenter(node.position.x + 130, node.position.y + 80, { zoom: 1, duration: 300 });
    },
    [rf],
  );

  const recenter = useCallback(() => rf.fitView({ padding: 0.2, duration: 300 }), [rf]);

  // --- Raccourcis clavier ---------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping(e.target)) return; // dans un champ : Ctrl+Z natif du champ
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z" && !e.shiftKey) dispatch({ type: "undo" });
      else if (mod && (key === "y" || (key === "z" && e.shiftKey))) dispatch({ type: "redo" });
      else if (mod && key === "c") copy();
      else if (mod && key === "v") paste();
      else if (mod && key === "d") duplicate();
      else if (mod && key === "a") dispatch({ type: "selectAll" });
      else if (!mod && (e.key === "Delete" || e.key === "Backspace")) dispatch({ type: "deleteSelected", now: now() });
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copy, paste, duplicate]);

  // --- Publication et réglages ---------------------------------------------
  async function publish() {
    if (errorCount > 0) return;
    try {
      const repos = getRepositories();
      pending.current = null;
      await repos.flows.update(flow.id, { draft: graph });
      const published = await repos.flows.publish(flow.id);
      setFlow(published);
      setSavedJson(graphJson);
      setToast({ tone: "success", text: `Flux publié (version ${published.version}). Le bot utilise maintenant cette version.` });
    } catch (error) {
      setToast({ tone: "error", text: errorText(error) });
    }
  }

  async function saveMeta(patch: { name?: string; description?: string }) {
    try {
      setFlow(await getRepositories().flows.update(flow.id, patch));
    } catch (error) {
      setToast({ tone: "error", text: errorText(error) });
      setName(flow.name);
    }
  }

  // --- Rendu ----------------------------------------------------------------
  const ctx: EditorContextValue = useMemo(
    () => ({
      issues: byNode,
      variables: flowVariables(graph.nodes),
      flows,
      flowId: flow.id,
      orderUrl: `${DEFAULT_ORDER_BASE_URL}${client.orderSlug}`,
      updateData: (id, data, key) => dispatch({ type: "updateData", id, data, key, now: Date.now() }),
      deleteEdge: (id) => dispatch({ type: "deleteEdge", id, now: Date.now() }),
    }),
    [byNode, graph.nodes, flows, flow.id, client.orderSlug],
  );

  const edges = useMemo(
    () => state.edges.map((e) => ({ ...e, type: "deletable", markerEnd: { type: MarkerType.ArrowClosed, color: e.selected ? "#FF4FB5" : "#94a3c4" } })),
    [state.edges],
  );

  const hasTrigger = state.nodes.some((n) => n.type === "trigger");
  const mod = isMac() ? "⌘" : "Ctrl";

  return (
    <EditorContext.Provider value={ctx}>
      <div className="flex min-h-dvh flex-col lg:h-dvh">
        {/* Barre du haut */}
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-white px-3 py-2 sm:px-4">
          <Link href={`/clients/${client.id}`} className="shrink-0 text-sm font-semibold text-muted hover:text-navy">
            ← {client.nomResto}
          </Link>
          <input
            aria-label="Nom du flux"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== flow.name && saveMeta({ name })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="min-w-40 flex-1 rounded-lg px-2 py-1 font-title text-lg font-semibold hover:bg-page focus:bg-page focus:outline-none sm:max-w-xs"
          />
          <span className="text-xs text-muted" aria-live="polite">
            {saveError ? <span className="text-coral">Erreur d&apos;enregistrement : {saveError}</span> : dirty ? "Enregistrement…" : "Brouillon enregistré ✓"}
          </span>
          {!flow.published ? (
            <StatusPill tone="neutral">Jamais publié</StatusPill>
          ) : unpublished ? (
            <StatusPill tone="warning">v{flow.version} publiée · brouillon modifié</StatusPill>
          ) : (
            <StatusPill tone="success">v{flow.version} publiée</StatusPill>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <ToolButton title={`Annuler (${mod}+Z)`} disabled={!state.history.past.length} onClick={() => dispatch({ type: "undo" })}>
              ↶
            </ToolButton>
            <ToolButton title={`Rétablir (${mod}+Y)`} disabled={!state.history.future.length} onClick={() => dispatch({ type: "redo" })}>
              ↷
            </ToolButton>
            <ToolButton title="Recentrer le flux" onClick={recenter}>
              ⤢ <span className="hidden sm:inline">Recentrer</span>
            </ToolButton>
            <ToolButton title="Exporter le brouillon en JSON" onClick={() => downloadJson(exportFileName("flux", flow.name), exportFlow({ ...flow, draft: graph }))}>
              Exporter
            </ToolButton>
            <button
              type="button"
              onClick={publish}
              disabled={errorCount > 0 || !unpublished}
              title={errorCount > 0 ? "Corrigez les erreurs avant de publier" : !unpublished ? "Rien de nouveau à publier" : "Publier ce brouillon"}
              className="rounded-full bg-pink px-4 py-1.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgb(255_79_181/0.25)] hover:bg-pink-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {errorCount > 0 ? `Publier · ${errorCount} erreur${errorCount > 1 ? "s" : ""}` : "Publier"}
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
          {/* Palette */}
          <aside className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-rule bg-white p-2 lg:w-52 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0">
            <p className="hidden px-1 pb-1 text-xs font-semibold text-muted lg:block">Glissez ou cliquez pour ajouter</p>
            {PALETTE.map((type) => {
              const info = BLOCKS[type];
              const disabled = type === "trigger" && hasTrigger;
              return (
                <button
                  key={type}
                  type="button"
                  draggable={!disabled}
                  disabled={disabled}
                  title={disabled ? "Un flux n'a qu'un seul déclencheur" : info.description}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, type);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => addBlock(type)}
                  className="flex shrink-0 items-center gap-2 rounded-xl border border-rule bg-white px-2.5 py-1.5 text-left text-sm font-semibold hover:border-pink/50 hover:bg-pink/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className={`grid size-6 shrink-0 place-items-center rounded-lg text-xs ${info.accent}`}>{info.icon}</span>
                  <span className="whitespace-nowrap">{info.label}</span>
                </button>
              );
            })}
          </aside>

          {/* Tableau blanc */}
          <div
            ref={canvasRef}
            className="relative h-[72dvh] shrink-0 bg-page lg:h-auto lg:min-h-0 lg:flex-1 lg:shrink"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_TYPE)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={(e) => {
              const type = e.dataTransfer.getData(DRAG_TYPE) as NodeType;
              if (!type || !(type in BLOCKS)) return;
              e.preventDefault();
              const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
              dispatch({ type: "add", node: createNode(type, { x: Math.round(pos.x - 130), y: Math.round(pos.y - 20) }), now: now() });
            }}
          >
            <ReactFlow<RFNode>
              nodes={state.nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={(changes) => dispatch({ type: "nodesChange", changes, now: now() })}
              onEdgesChange={(changes) => dispatch({ type: "edgesChange", changes, now: now() })}
              onConnect={(c: Connection) => dispatch({ type: "connect", source: c.source, sourceHandle: c.sourceHandle ?? null, target: c.target, now: now() })}
              isValidConnection={(c) => c.source !== c.target && state.nodes.find((n) => n.id === c.target)?.type !== "trigger"}
              deleteKeyCode={null}
              selectionKeyCode="Shift"
              multiSelectionKeyCode={["Meta", "Control", "Shift"]}
              snapToGrid
              snapGrid={[10, 10]}
              minZoom={0.15}
              maxZoom={1.75}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="#cfd3e6" />
              <MiniMap
                pannable
                zoomable
                ariaLabel="Mini-carte du flux"
                nodeColor={(n) => BLOCKS[(n.type as NodeType) ?? "message"]?.hex ?? "#5E6690"}
                nodeBorderRadius={8}
                maskColor="rgb(16 27 77 / 0.08)"
                className="!rounded-xl !border !border-rule !shadow-card max-md:!hidden"
              />
              <Controls showInteractive={false} className="!rounded-xl !shadow-card" />
            </ReactFlow>
            {toast && (
              <div
                role="status"
                className={`pointer-events-none absolute top-3 left-1/2 z-10 max-w-md -translate-x-1/2 rounded-full px-4 py-2 text-center text-sm font-semibold shadow-pop ${
                  toast.tone === "error" ? "bg-coral text-white" : toast.tone === "success" ? "bg-wa text-white" : "bg-navy text-white"
                }`}
              >
                {toast.text}
              </div>
            )}
          </div>

          {/* Panneau de droite */}
          <aside className="shrink-0 overflow-y-auto border-t border-rule bg-white p-4 lg:w-[340px] lg:border-t-0 lg:border-l">
            {selected.length === 1 ? (
              <NodeProperties
                key={selected[0].id}
                node={state.nodes.find((n) => n.id === selected[0].id) as unknown as FlowNode}
                onDuplicate={duplicate}
                onDelete={() => dispatch({ type: "deleteSelected", now: now() })}
              />
            ) : selected.length > 1 ? (
              <MultiSelection count={selected.length} mod={mod} onCopy={copy} onDuplicate={duplicate} onDelete={() => dispatch({ type: "deleteSelected", now: now() })} />
            ) : (
              <FlowOverview
                issues={issues}
                description={flow.description ?? ""}
                onDescription={(description) => saveMeta({ description })}
                onFocus={focusNode}
                mod={mod}
              />
            )}
          </aside>
        </div>
      </div>
    </EditorContext.Provider>
  );
}

function StatusPill({ tone, children }: { tone: "neutral" | "success" | "warning"; children: React.ReactNode }) {
  const cls = { neutral: "bg-navy/5 text-muted", success: "bg-wa/15 text-green-700", warning: "bg-pink/10 text-pink" }[tone];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

function ToolButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={props.title}
      className="rounded-full border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:border-navy/30 disabled:cursor-not-allowed disabled:opacity-40"
      {...props}
    >
      {children}
    </button>
  );
}

function MultiSelection({ count, mod, onCopy, onDuplicate, onDelete }: { count: number; mod: string; onCopy: () => void; onDuplicate: () => void; onDelete: () => void }) {
  return (
    <div className="space-y-3">
      <h2 className="font-title text-base font-semibold">{count} blocs sélectionnés</h2>
      <p className="text-xs text-muted">Déplacez-les ensemble, copiez-les ({mod}+C) vers un autre flux, ou dupliquez-les ({mod}+D).</p>
      <div className="grid gap-2">
        <button type="button" className="rounded-full border border-line py-1.5 text-sm font-semibold hover:border-navy/30" onClick={onCopy}>
          Copier
        </button>
        <button type="button" className="rounded-full border border-line py-1.5 text-sm font-semibold hover:border-navy/30" onClick={onDuplicate}>
          Dupliquer
        </button>
        <button type="button" className="rounded-full border border-coral/40 py-1.5 text-sm font-semibold text-coral hover:bg-coral/10" onClick={onDelete}>
          Supprimer
        </button>
      </div>
    </div>
  );
}

function FlowOverview({
  issues,
  description,
  onDescription,
  onFocus,
  mod,
}: {
  issues: Issue[];
  description: string;
  onDescription: (d: string) => void;
  onFocus: (id: string) => void;
  mod: string;
}) {
  const [desc, setDesc] = useState(description);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-title text-base font-semibold">Vérification</h2>
        {issues.length === 0 ? (
          <p className="mt-1 rounded-xl bg-wa/10 p-2.5 text-sm font-semibold text-green-700">Aucun problème : le flux est prêt à être publié.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {[...errors, ...warnings].map((issue, i) => (
              <li key={i}>
                <button
                  type="button"
                  disabled={!issue.nodeId}
                  onClick={() => issue.nodeId && onFocus(issue.nodeId)}
                  className={`w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-page ${issue.level === "error" ? "font-semibold text-coral" : "text-amber-700"}`}
                >
                  {issue.level === "error" ? "⚠" : "•"} {issue.message}
                </button>
              </li>
            ))}
          </ul>
        )}
        {errors.length > 0 && <p className="mt-2 text-xs text-muted">« Publier » est bloqué tant qu&apos;il reste des erreurs. Les avertissements n&apos;empêchent pas de publier.</p>}
      </div>

      <div>
        <h2 className="font-title text-base font-semibold">Description</h2>
        <p className="text-xs text-muted">Aide l&apos;IA à choisir ce flux quand un client pose une question.</p>
        <textarea
          aria-label="Description du flux"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc !== description && onDescription(desc)}
          placeholder="Accueil et lien de commande"
          className="mt-2 min-h-16 w-full rounded-xl border border-line px-3 py-2 text-sm focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20"
        />
      </div>

      <div>
        <h2 className="font-title text-base font-semibold">Raccourcis</h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {[
            [`${mod}+Z / ${mod}+Y`, "Annuler / rétablir"],
            [`${mod}+C / ${mod}+V`, "Copier / coller (même d'un flux à l'autre)"],
            [`${mod}+D`, "Dupliquer la sélection"],
            [`${mod}+A`, "Tout sélectionner"],
            ["Maj + glisser", "Sélection par zone"],
            [`${mod} / Maj + clic`, "Ajouter à la sélection"],
            ["Suppr", "Supprimer la sélection"],
            ["{{ ou {x}", "Insérer une variable dans un texte"],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono font-semibold whitespace-nowrap text-navy">{k}</dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
