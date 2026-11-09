"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button, Card, Loading, Notice, Select } from "@/components/ui";
import { errorText, getRepositories, isCrmMode, readBrowserWorkspace, useLoad } from "@/data/browser";
import { planImport, suggestMapping } from "@/data/import";
import { exportBackup, exportFileName } from "@/data/transfer";
import type { InfoSheet } from "@/engine";
import { downloadJson } from "@/lib/files";

/** Import des données de l'étape A (ce navigateur) dans Supabase, resto par resto. */
export default function ImportPage() {
  const { state, reload } = useLoad(async (repos) => {
    const local = readBrowserWorkspace();
    if (!isCrmMode || !local) return { local, remote: null, locked: {} as Record<string, (keyof InfoSheet)[]> };
    const remote = await repos.workspace.exportAll();
    const locked = Object.fromEntries(await Promise.all(remote.clients.map(async (c) => [c.id, await repos.infoSheets.lockedFields(c.id)] as const)));
    return { local, remote, locked };
  }, []);

  return (
    <AppShell breadcrumb={<>Importer les données du navigateur</>}>
      <h1 className="text-5xl">Importer les données <span className="text-rose">du navigateur</span></h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Reprend ce que tu as construit à l&apos;étape A dans ce navigateur (modèle maître, agent IA, flux, fiche du bot, journal IA) et le range
        dans Supabase, rattaché aux restos du CRM. Rien n&apos;est écrit dans les tables du CRM, et les données du navigateur ne sont pas effacées.
      </p>
      <div className="mt-6">
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <Notice tone="error">{state.error}</Notice>}
        {state.status === "ready" && !isCrmMode && <Notice tone="info">L&apos;import se fait une fois l&apos;app connectée à Supabase.</Notice>}
        {state.status === "ready" && isCrmMode && !state.data.local && <Notice tone="info">Aucune donnée de l&apos;étape A dans ce navigateur.</Notice>}
        {state.status === "ready" && state.data.local && state.data.remote && (
          <ImportForm local={state.data.local} remote={state.data.remote} locked={state.data.locked} onDone={reload} />
        )}
      </div>
    </AppShell>
  );
}

function ImportForm({
  local,
  remote,
  locked,
  onDone,
}: {
  local: NonNullable<ReturnType<typeof readBrowserWorkspace>>;
  remote: NonNullable<ReturnType<typeof readBrowserWorkspace>>;
  locked: Record<string, (keyof InfoSheet)[]>;
  onDone: () => void;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>(() => suggestMapping(local, remote));
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string; lines?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => planImport(local, remote, { mapping, locked }), [local, remote, mapping, locked]);
  const used = Object.values(mapping).filter(Boolean);
  const duplicate = used.length !== new Set(used).size;

  async function run() {
    if (!window.confirm("Importer ces données dans Supabase ?")) return;
    setBusy(true);
    try {
      await getRepositories().workspace.importAll(plan.data);
      setStatus({ tone: "success", text: "Import terminé.", lines: plan.done });
      onDone();
    } catch (error) {
      setStatus({ tone: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card title="Restos" description="Choisis, pour chaque client du navigateur, le resto du CRM qui lui correspond.">
        <ul className="divide-y divide-rule" data-testid="import-mapping">
          {local.clients.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="min-w-40 flex-1">
                <span className="block font-semibold">{c.nomResto}</span>
                <span className="text-xs text-muted">
                  {local.flows.filter((f) => f.ownerId === c.id).length} flux dans le navigateur{c.template ? " · lié au modèle" : ""}
                </span>
              </span>
              <Select
                aria-label={`Resto du CRM pour ${c.nomResto}`}
                className="max-w-xs"
                value={mapping[c.id] ?? ""}
                onChange={(e) => setMapping({ ...mapping, [c.id]: e.target.value })}
              >
                <option value="">Ne pas importer</option>
                {remote.clients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nomResto}
                    {r.crmStatut ? ` (${r.crmStatut})` : ""}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
      </Card>
      <div className="space-y-4">
        <Card title="Ce qui sera importé">
          <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="import-plan">
            {plan.done.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {plan.done.length === 0 && <li className="text-muted">Rien pour l&apos;instant.</li>}
          </ul>
          {plan.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted">
              {plan.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
          {duplicate && <Notice tone="error">Deux clients du navigateur pointent vers le même resto.</Notice>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={run} disabled={busy || duplicate || plan.done.length === 0}>
              {busy ? "Import…" : "Importer dans Supabase"}
            </Button>
            <Button variant="secondary" onClick={() => downloadJson(exportFileName("sauvegarde-navigateur", "pflow-bots"), exportBackup(local))}>
              Sauvegarder le navigateur
            </Button>
          </div>
        </Card>
        {status && (
          <Notice tone={status.tone}>
            {status.text}
            {status.lines && (
              <ul className="mt-1 list-disc pl-5">
                {status.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            {status.tone === "success" && (
              <Link href="/clients" className="mt-2 block font-semibold underline">
                Voir les clients
              </Link>
            )}
          </Notice>
        )}
      </div>
    </div>
  );
}
