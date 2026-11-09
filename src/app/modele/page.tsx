"use client";

import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FlowsCard } from "@/components/flows-card";
import { Button, ButtonLink, Card, Loading, Notice } from "@/components/ui";
import { DEFAULT_AI_MODEL, modelLabel } from "@/ai/models";
import { errorText, getRepositories, useLoad } from "@/data/browser";
import { completeMasterTemplate, createMasterTemplate, missingSeedFlows } from "@/data/template-seed";
import { BUILTIN_VARIABLES } from "@/editor/variables";

export default function TemplatePage() {
  const { state, reload } = useLoad(async (repos) => {
    const template = (await repos.templates.list())[0] ?? null;
    if (!template) return null;
    const [flows, folders] = await Promise.all([repos.flows.listByOwner(template.id), repos.folders.listByOwner(template.id)]);
    return { template, flows, folders, missing: missingSeedFlows(flows.map((f) => f.name)).map((f) => f.name) };
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[] | null>(null);

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Modèle maître</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Ta trame commune à tous les bots, écrite uniquement avec des variables (nom du resto, lien de commande, horaires…) : rien de propre à
            un client. Les bots liés au modèle utilisent ses flux <strong>publiés</strong> et son agent IA.
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <Notice tone="error" onClose={() => setError(null)}>
            {error}
          </Notice>
        </div>
      )}

      <div className="mt-6">
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <Notice tone="error">{state.error}</Notice>}
        {state.status === "ready" && !state.data && (
          <Card title="Pas encore de modèle maître">
            <p className="text-sm text-muted">
              Crée-le à partir de ta trame UChat : Accueil, Infos pratiques, CTA - Commander et les fonctions IA, rangés dans « Principales PFlow
              Order », « Fonctions IA » et « Commande ». Tout est modifiable ensuite.
            </p>
            <Button
              className="mt-4"
              onClick={async () => {
                try {
                  await createMasterTemplate(getRepositories());
                  reload();
                } catch (err) {
                  setError(errorText(err));
                }
              }}
            >
              Créer le modèle maître à partir de la trame PFlow
            </Button>
          </Card>
        )}
        {added && (
          <div className="mb-4">
            <Notice tone="success" onClose={() => setAdded(null)}>
              Ajouté{added.length > 1 ? "s" : ""} et publié{added.length > 1 ? "s" : ""} : {added.join(", ")}.
            </Notice>
          </div>
        )}
        {state.status === "ready" && state.data && state.data.missing.length > 0 && (
          <div className="mb-4">
            <Notice tone="info">
              <span className="block">
                La trame PFlow contient {state.data.missing.length} flux absent{state.data.missing.length > 1 ? "s" : ""} de ton modèle :{" "}
                {state.data.missing.join(", ")}. Les flux existants ne sont pas modifiés.
              </span>
              <Button
                className="mt-2"
                variant="secondary"
                onClick={async () => {
                  try {
                    setAdded(await completeMasterTemplate(getRepositories(), state.data!.template.id));
                    reload();
                  } catch (err) {
                    setError(errorText(err));
                  }
                }}
              >
                Ajouter les flux manquants
              </Button>
            </Notice>
          </div>
        )}
        {state.status === "ready" && state.data && (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <FlowsCard
              owner={{ kind: "template", id: state.data.template.id }}
              flows={state.data.flows}
              folders={state.data.folders}
              onChange={reload}
              description="Chaque flux se publie séparément. Une modification publiée s'appliquera à tous les bots liés."
            />
            <div className="space-y-6">
              <Card title="Agent IA" description="Consigne générale, réglages du modèle et fonctions (chaque fonction = un flux du dossier « Fonctions IA »).">
                {state.data.template.agent ? (
                  <ul className="space-y-1 text-sm">
                    <li>
                      <span className="text-muted">Modèle :</span> {modelLabel(state.data.template.agent.model ?? DEFAULT_AI_MODEL)}
                    </li>
                    <li>
                      <span className="text-muted">Fonctions :</span>{" "}
                      {state.data.template.agent.functions?.length ? (
                        <span className="font-mono text-xs">{state.data.template.agent.functions.map((f) => f.name).join(", ")}</span>
                      ) : (
                        "aucune"
                      )}
                    </li>
                  </ul>
                ) : (
                  <p className="rounded-xl bg-white/5 p-3 text-sm text-muted">Pas encore configuré : une configuration par défaut (ta consigne UChat) est prête.</p>
                )}
                <ButtonLink href="/modele/agent" variant="secondary" className="mt-3">
                  Configurer l&apos;agent IA
                </ButtonLink>
              </Card>
              <Card title="Variables disponibles" description="Remplacées par les infos de chaque client au moment de l'envoi.">
                <ul className="space-y-1.5 text-xs">
                  {BUILTIN_VARIABLES.map((v) => (
                    <li key={v.name}>
                      <span className="font-mono font-semibold text-pink">{`{{${v.name}}}`}</span>
                      <span className="block text-muted">{v.label}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
