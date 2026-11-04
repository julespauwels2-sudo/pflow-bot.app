"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button, Card, Field, Input, Loading, Notice, Select, Textarea } from "@/components/ui";
import { fetchAiStatus, type AiStatus } from "@/ai/http-port";
import { AI_MODELS, modelLabel } from "@/ai/models";
import { PFLOW_RULES } from "@/ai/prompt";
import { AI_TEXT_MODES, DEFAULT_AI_INACTIVITY_MINUTES, DEFAULT_CONSIGNE, DEFAULT_FUNCTIONS, checkAgent, defaultAgent } from "@/data/agent";
import { errorText, getRepositories, useLoad } from "@/data/browser";
import type { BotFolder, BotTemplate, StoredFlow, TemplateAgent, TemplateAgentFunction } from "@/data/types";
import { stableStringify } from "@/data/types";
import { DEFAULT_CHANNEL_SETTINGS, type AiTextMode } from "@/engine";

export default function AgentPage() {
  const { state, reload } = useLoad(async (repos) => {
    const template = (await repos.templates.list())[0] ?? null;
    if (!template) return null;
    const [flows, folders] = await Promise.all([repos.flows.listByOwner(template.id), repos.folders.listByOwner(template.id)]);
    return { template, flows, folders };
  }, []);
  // Gardé ici : le formulaire est recréé après l'enregistrement (rechargement des données).
  const [status, setStatus] = useState<Status>(null);

  const breadcrumb = (
    <>
      <Link href="/modele" className="hover:text-navy">
        Modèle maître
      </Link>{" "}
      / Agent IA
    </>
  );

  return (
    <AppShell breadcrumb={breadcrumb}>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <Notice tone="error">{state.error}</Notice>}
      {state.status === "ready" && !state.data && (
        <Notice tone="info">
          Crée d&apos;abord le modèle maître.{" "}
          <Link href="/modele" className="font-semibold underline">
            Modèle maître
          </Link>
        </Notice>
      )}
      {state.status === "ready" && state.data && (
        <AgentForm
          key={state.data.template.updatedAt}
          template={state.data.template}
          flows={state.data.flows}
          folders={state.data.folders}
          onSaved={reload}
          status={status}
          setStatus={setStatus}
        />
      )}
    </AppShell>
  );
}

type Status = { tone: "success" | "error"; text: string } | null;

function AgentForm({
  template,
  flows,
  folders,
  onSaved,
  status,
  setStatus,
}: {
  template: BotTemplate;
  flows: StoredFlow[];
  folders: BotFolder[];
  onSaved: () => void;
  status: Status;
  setStatus: (status: Status) => void;
}) {
  const initial = useMemo(() => template.agent ?? defaultAgent(flows), [template.agent, flows]);
  const [agent, setAgent] = useState<TemplateAgent>(initial);
  const [aiStatus, setAiStatus] = useState<AiStatus | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetchAiStatus().then((s) => !cancelled && setAiStatus(s));
    return () => {
      cancelled = true;
    };
  }, []);

  const issues = checkAgent(agent, flows);
  const errors = issues.filter((i) => i.level === "error");
  const dirty = !template.agent || stableStringify(agent) !== stableStringify(template.agent);
  const functions = agent.functions ?? [];
  const update = (next: TemplateAgent) => {
    setAgent(next);
    if (status?.tone === "success") setStatus(null);
  };
  const setFunctions = (next: TemplateAgentFunction[]) => update({ ...agent, functions: next });
  const updateFunction = (i: number, patch: Partial<TemplateAgentFunction>) => setFunctions(functions.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  // Flux proposés : ceux du dossier « Fonctions IA » d'abord.
  const aiFolder = folders.find((f) => f.name === "Fonctions IA");
  const sortedFlows = [...flows].sort((a, b) => Number(b.folderId === aiFolder?.id) - Number(a.folderId === aiFolder?.id) || a.name.localeCompare(b.name, "fr"));
  const missingDefaults = defaultAgent(flows).functions!.filter((d) => !functions.some((f) => f.name === d.name));
  const unlinkedDefaults = DEFAULT_FUNCTIONS.filter((d) => !flows.some((f) => f.name.toLowerCase() === d.flowName.toLowerCase()));

  async function save() {
    try {
      await getRepositories().templates.updateAgent(template.id, agent);
      setStatus({ tone: "success", text: "Agent IA enregistré : il s'applique à tous les bots liés au modèle." });
      onSaved();
    } catch (error) {
      setStatus({ tone: "error", text: errorText(error) });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Agent IA</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            La consigne, les réglages et les fonctions de l&apos;IA, communs à tous les bots liés au modèle. Ce qui est propre à chaque resto
            (horaires, carte, FAQ…) vient de sa fiche d&apos;infos.
          </p>
        </div>
        <Button onClick={save} disabled={!dirty || errors.length > 0}>
          Enregistrer
        </Button>
      </div>

      {aiStatus !== undefined &&
        (aiStatus?.configured ? (
          <Notice tone="success">
            Clé API Anthropic configurée sur le serveur. Modèle du serveur : {modelLabel(aiStatus.model)}.
          </Notice>
        ) : (
          <Notice tone="error">
            Clé API Anthropic absente sur le serveur : ajoute la variable <code>ANTHROPIC_API_KEY</code> (Vercel → Settings → Environment
            Variables, ou <code>.env.local</code> en local), puis redéploie. En attendant, l&apos;IA ne répond pas (le simulateur l&apos;indique).
          </Notice>
        ))}
      {!template.agent && (
        <Notice tone="info">
          Configuration par défaut proposée : ta consigne UChat, rendue générique, et les fonctions du dossier « Fonctions IA ». Clique sur
          « Enregistrer » pour l&apos;activer.
        </Notice>
      )}
      {status && (
        <Notice tone={status.tone} onClose={() => setStatus(null)}>
          {status.text}
        </Notice>
      )}
      {issues.length > 0 && (
        <ul className="space-y-1 rounded-2xl border border-line bg-white p-4 text-sm" data-testid="agent-issues">
          {issues.map((i) => (
            <li key={i.message} className={i.level === "error" ? "font-semibold text-coral" : "text-muted"}>
              {i.level === "error" ? "✕" : "⚠"} {i.message}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Card
            title="Consigne générale"
            description="La personnalité et les règles de l'agent. Variables acceptées : {{nom_resto}}, {{prenom}}, {{horaires}}… Les règles PFlow (ci-contre) passent toujours avant."
          >
            <Textarea aria-label="Consigne générale" rows={22} className="font-mono text-xs leading-relaxed" value={agent.consigne ?? ""} onChange={(e) => update({ ...agent, consigne: e.target.value })} />
            <div className="mt-2 flex flex-wrap gap-2">
              {agent.consigne !== DEFAULT_CONSIGNE && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (!agent.consigne?.trim() || window.confirm("Remplacer la consigne actuelle par la consigne PFlow par défaut ?")) update({ ...agent, consigne: DEFAULT_CONSIGNE });
                  }}
                >
                  Remettre la consigne PFlow par défaut
                </Button>
              )}
            </div>
          </Card>

          <Card
            title="Fonctions"
            description="Chaque fonction lance un flux du modèle. L'IA choisit la fonction d'après sa description : écris quand l'utiliser, pas ce que fait le flux."
          >
            <div className="space-y-3">
              {functions.map((f, i) => (
                <div key={i} className="space-y-2 rounded-2xl border border-line p-3" data-testid="agent-function">
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <Input aria-label="Nom de la fonction" className="font-mono" value={f.name} placeholder="lancer_commande" onChange={(e) => updateFunction(i, { name: e.target.value.trim() })} />
                    <Select aria-label="Flux lancé" value={f.flowId} onChange={(e) => updateFunction(i, { flowId: e.target.value })}>
                      <option value="">— Flux à lancer —</option>
                      {sortedFlows.map((flow) => (
                        <option key={flow.id} value={flow.id}>
                          {flow.name}
                          {flow.published ? "" : " (non publié)"}
                        </option>
                      ))}
                    </Select>
                    <Button variant="ghost" aria-label={`Supprimer la fonction ${f.name}`} onClick={() => setFunctions(functions.filter((_, j) => j !== i))}>
                      Supprimer
                    </Button>
                  </div>
                  <Textarea aria-label="Description de la fonction" rows={3} value={f.description} placeholder="Quand l'IA doit l'utiliser…" onChange={(e) => updateFunction(i, { description: e.target.value })} />
                  <Select aria-label="Texte de l'IA" value={f.aiText ?? "silence"} onChange={(e) => updateFunction(i, { aiText: e.target.value as AiTextMode })}>
                    {(Object.keys(AI_TEXT_MODES) as AiTextMode[]).map((mode) => (
                      <option key={mode} value={mode}>
                        {AI_TEXT_MODES[mode].label}
                      </option>
                    ))}
                  </Select>
                  <p className="text-[11px] text-muted">{AI_TEXT_MODES[f.aiText ?? "silence"].hint}</p>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setFunctions([...functions, { name: "", flowId: "", description: "", aiText: "silence" }])}>
                  + Ajouter une fonction
                </Button>
                {missingDefaults.length > 0 && (
                  <Button variant="secondary" onClick={() => setFunctions([...functions, ...missingDefaults])}>
                    Ajouter les fonctions PFlow manquantes ({missingDefaults.map((d) => d.name).join(", ")})
                  </Button>
                )}
              </div>
              {unlinkedDefaults.length > 0 && (
                <p className="text-[11px] text-muted">
                  Flux de la trame introuvables pour : {unlinkedDefaults.map((d) => `${d.name} (« ${d.flowName} »)`).join(", ")}.
                </p>
              )}
              <p className="text-[11px] text-muted">
                <code>suivre_commande</code> et <code>annuler_commande</code> arriveront avec l&apos;API de PFlow Order (étape C) : en attendant,
                la consigne envoie ces demandes vers <code>parler_equipe</code>.
              </p>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Réglages">
            <div className="space-y-4">
              <Field label="Modèle" hint={AI_MODELS.find((m) => m.id === agent.model)?.hint ?? "Celui de la variable ANTHROPIC_MODEL du serveur (Haiku 5.5 par défaut)."}>
                <Select aria-label="Modèle" value={agent.model ?? ""} onChange={(e) => update({ ...agent, model: e.target.value || undefined })}>
                  <option value="">Celui du serveur{aiStatus?.model ? ` (${modelLabel(aiStatus.model)})` : ""}</option>
                  {AI_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Appels IA par contact et par jour" hint="Au-delà, le contact est passé à l'équipe. Protège contre les abus et les boucles.">
                <Input
                  type="number"
                  min={1}
                  max={500}
                  aria-label="Appels IA par contact et par jour"
                  value={agent.dailyLimit ?? DEFAULT_CHANNEL_SETTINGS.aiDailyLimitPerContact}
                  onChange={(e) => update({ ...agent, dailyLimit: clampInt(e.target.value, 1, 500) })}
                />
              </Field>
              <Field label="Délai d'inactivité des blocs IA (minutes)" hint="Sans message du client pendant ce délai, l'IA lâche la conversation. Modifiable bloc par bloc.">
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  aria-label="Délai d'inactivité des blocs IA"
                  value={agent.inactivityMinutes ?? DEFAULT_AI_INACTIVITY_MINUTES}
                  onChange={(e) => update({ ...agent, inactivityMinutes: clampInt(e.target.value, 1, 1440) })}
                />
              </Field>
            </div>
          </Card>
          <Card title="Ce que reçoit l'IA" description="Dans cet ordre, à chaque message (les 3 premiers sont mis en cache pour réduire le coût).">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>
                <details>
                  <summary className="cursor-pointer font-semibold">Règles PFlow</summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-page p-2 text-[11px] whitespace-pre-wrap">{PFLOW_RULES}</pre>
                </details>
              </li>
              <li>
                <span className="font-semibold">Consigne générale</span> (ci-contre), avec le nom du resto
              </li>
              <li>
                <span className="font-semibold">Base de connaissances</span> du resto, générée depuis sa fiche d&apos;infos : visible sur la page de
                chaque client
              </li>
              <li>
                <span className="font-semibold">Contexte</span> : date et heure du resto, prénom du client, fonctions autorisées, consigne du bloc IA
              </li>
              <li>
                <span className="font-semibold">Conversation</span> : les derniers échanges dans le bloc IA, puis le message du client
              </li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function clampInt(value: string, min: number, max: number): number | undefined {
  if (!value) return undefined;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : undefined;
}
