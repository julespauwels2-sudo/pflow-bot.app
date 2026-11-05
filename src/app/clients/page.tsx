"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { LocalClock } from "@/components/local-clock";
import { Badge, Button, Card, Field, FileButton, Input, Loading, Notice, Select } from "@/components/ui";
import { ensureAutoBots, errorText, getRepositories, isCrmMode, useLoad } from "@/data/browser";
import { botChecklist, clientTab, type ChecklistItem, type ClientTab } from "@/data/resolve";
import { loadDemo } from "@/data/demo";
import { exportBackup, exportFileName, parseBackup } from "@/data/transfer";
import { DEFAULT_ORDER_BASE_URL, DEFAULT_TIMEZONE } from "@/engine";
import { downloadJson } from "@/lib/files";
import { TIMEZONES, slugify, timezoneLabel } from "@/lib/timezones";

type Message = { tone: "error" | "success"; text: string } | null;

const CRM_STATUTS: Record<string, string> = { signe: "Signé", actif: "Actif", demo: "Démo", perdu: "Perdu" };

const TAB_KEY = "pflow-bots:onglet-clients";

function savedTab(): ClientTab {
  if (typeof window === "undefined") return "clients";
  try {
    return window.localStorage.getItem(TAB_KEY) === "demos" ? "demos" : "clients";
  } catch {
    return "clients";
  }
}

export default function ClientsPage() {
  const { state, reload } = useLoad(async (repos) => {
    const auto = await ensureAutoBots();
    const clients = await repos.clients.list();
    const templates = await repos.templates.list();
    const now = new Date();
    const rows = await Promise.all(
      clients.map(async (client) => {
        const template = templates.find((t) => t.id === client.template?.templateId);
        const [clientFlows, clientFolders, infoSheet, templateFlows, templateFolders] = await Promise.all([
          repos.flows.listByOwner(client.id),
          repos.folders.listByOwner(client.id),
          repos.infoSheets.get(client.id),
          template ? repos.flows.listByOwner(template.id) : Promise.resolve([]),
          template ? repos.folders.listByOwner(template.id) : Promise.resolve([]),
        ]);
        // Liste de contrôle d'onboarding, pour chaque bot lié au modèle.
        const checklist: ChecklistItem[] = client.template
          ? botChecklist({ client, templateFlows, templateFolders, clientFlows, clientFolders }, infoSheet, now)
          : [];
        return { client, flowCount: clientFlows.length, checklist };
      }),
    );
    return { rows, auto };
  }, []);
  const [message, setMessage] = useState<Message>(null);
  const [tab, setTab] = useState<ClientTab>(savedTab);
  const chooseTab = (next: ClientTab) => {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_KEY, next);
    } catch {
      // sans importance
    }
  };
  const allRows = state.status === "ready" ? state.data.rows : [];
  // Onglets seulement avec le CRM (en mode local, pas de statut).
  const withTabs = isCrmMode && allRows.some((r) => r.client.crmStatut);
  const counts = { clients: allRows.filter((r) => clientTab(r.client.crmStatut) === "clients").length, demos: allRows.filter((r) => clientTab(r.client.crmStatut) === "demos").length };
  const rows = withTabs ? allRows.filter((r) => clientTab(r.client.crmStatut) === tab) : allRows;

  async function run(action: () => Promise<string | void>) {
    try {
      const text = await action();
      setMessage(text ? { tone: "success", text } : null);
      reload();
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) });
    }
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Clients</h1>
          <p className="mt-1 text-sm text-muted">Chaque resto a son lien de commande, son fuseau horaire, sa fiche d&apos;infos et ses flux.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              run(async () => {
                const data = await getRepositories().workspace.exportAll();
                downloadJson(exportFileName("sauvegarde", "pflow-bots"), exportBackup(data));
                return "Sauvegarde téléchargée.";
              })
            }
          >
            Exporter la sauvegarde
          </Button>
          {!isCrmMode && (
          <FileButton
            accept="application/json,.json"
            onFile={(file) =>
              run(async () => {
                const parsed = parseBackup(await file.text());
                if (!parsed.ok) throw new Error(parsed.error);
                const ok = window.confirm(
                  `Restaurer cette sauvegarde (${parsed.value.clients.length} client(s), ${parsed.value.flows.length} flux) ? Les données actuelles de ce navigateur seront remplacées.`,
                );
                if (!ok) return;
                await getRepositories().workspace.importAll(parsed.value);
                return "Sauvegarde restaurée.";
              })
            }
          >
            Restaurer une sauvegarde
          </FileButton>
          )}
        </div>
      </div>

      <div className="mt-6">
        {isCrmMode ? (
          <Notice tone="info">
            Les restos viennent du CRM : statuts <strong>signé</strong>, <strong>actif</strong> et <strong>démo</strong>, plus ceux qui ont déjà un
            bot. Nom, slug, fuseau, horaires, zones et carte se modifient dans le CRM ; le bot les lit sans jamais les modifier.
          </Notice>
        ) : (
          <Notice tone="info">
            <strong>Mode local :</strong> les données sont enregistrées dans ce navigateur uniquement. Exportez une sauvegarde régulièrement.
          </Notice>
        )}
      </div>

      {message && (
        <div className="mt-4">
          <Notice tone={message.tone} onClose={() => setMessage(null)}>
            {message.text}
          </Notice>
        </div>
      )}

      <div className={`mt-6 grid gap-6 ${isCrmMode ? "" : "lg:grid-cols-[1fr_360px]"}`}>
        <div>
          {state.status === "loading" && <Loading />}
          {state.status === "error" && <Notice tone="error">{state.error}</Notice>}
          {state.status === "ready" && state.data.auto && (state.data.auto.linked.length > 0 || state.data.auto.skipped) && (
            <div className="mb-4">
              <Notice tone={state.data.auto.skipped ? "info" : "success"}>
                {state.data.auto.skipped ??
                  `Bot créé automatiquement (lié au modèle maître) : ${state.data.auto.linked.map((c) => c.nomResto).join(", ")}.`}
              </Notice>
            </div>
          )}
          {state.status === "ready" && state.data.rows.length === 0 && isCrmMode && (
            <Card title="Aucun resto à afficher">
              <p className="text-sm text-muted">Aucun resto signé, actif ou en démo dans le CRM pour l&apos;instant.</p>
            </Card>
          )}
          {state.status === "ready" && state.data.rows.length === 0 && !isCrmMode && (
            <Card title="Aucun client pour l'instant">
              <p className="text-sm text-muted">Créez votre premier resto, ou chargez un resto d&apos;exemple déjà configuré.</p>
              <Button className="mt-4" variant="secondary" onClick={() => run(async () => void (await loadDemo(getRepositories())))}>
                Charger le resto d&apos;exemple
              </Button>
            </Card>
          )}
          {withTabs && (
            <div role="tablist" aria-label="Restos" className="mb-4 flex gap-1 border-b border-rule">
              {(
                [
                  ["clients", "Clients"],
                  ["demos", "Démos"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  data-testid={`onglet-${id}`}
                  onClick={() => chooseTab(id)}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === id ? "border-pink text-navy" : "border-transparent text-muted hover:text-navy"}`}
                >
                  {label} <span className="ml-1 rounded-full bg-navy/5 px-2 py-0.5 text-xs">{counts[id]}</span>
                </button>
              ))}
            </div>
          )}
          {state.status === "ready" && withTabs && rows.length === 0 && (
            <p className="text-sm text-muted">{tab === "demos" ? "Aucun resto en démo dans le CRM." : "Aucun resto signé ou actif dans le CRM."}</p>
          )}
          {state.status === "ready" && rows.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {rows.map(({ client, flowCount, checklist }) => (
                <li key={client.id}>
                  <Link
                    href={`/clients/${client.id}`}
                    className="block h-full rounded-[var(--radius-card)] border border-rule bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-lg font-semibold">{client.nomResto}</h2>
                      <Badge tone="info">{flowCount} flux</Badge>
                    </div>
                    {client.crmStatut && (
                      <p className="mt-1 flex flex-wrap gap-1.5">
                        <Badge tone={client.crmStatut === "demo" ? "warning" : "success"}>{CRM_STATUTS[client.crmStatut] ?? client.crmStatut}</Badge>
                        {client.template && <Badge tone="info">Bot lié au modèle</Badge>}
                      </p>
                    )}
                    <p className="mt-1 truncate text-sm text-blue">
                      {client.orderSlug ? `${DEFAULT_ORDER_BASE_URL.replace("https://", "")}${client.orderSlug}` : <span className="text-coral">Pas de slug dans le CRM</span>}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      {timezoneLabel(client.timezone)} · <LocalClock timezone={client.timezone} />
                    </p>
                    <BotStatus client={client} checklist={checklist} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!isCrmMode && <NewClientForm onCreated={(name) => run(async () => `Client « ${name} » créé.`)} />}
      </div>
    </AppShell>
  );
}

function NewClientForm({ onCreated }: { onCreated: (name: string) => void }) {
  const [nomResto, setNomResto] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const client = await getRepositories().clients.create({ nomResto, orderSlug: slug, timezone });
      setNomResto("");
      setSlug("");
      setSlugTouched(false);
      onCreated(client.nomResto);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Card title="Nouveau client" className="h-fit">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nom du resto">
          <Input
            required
            value={nomResto}
            placeholder="Mexico"
            onChange={(e) => {
              setNomResto(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="Slug du mini-site" hint={`${DEFAULT_ORDER_BASE_URL.replace("https://", "")}${slug || "…"}`}>
          <Input
            required
            value={slug}
            placeholder="mexico"
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
        </Field>
        <Field label="Fuseau horaire" hint={<>Heure locale : <LocalClock timezone={timezone} /></>}>
          <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Select>
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full">
          Créer le client
        </Button>
      </form>
    </Card>
  );
}

/** État du bot et liste de contrôle d'onboarding, en résumé sur la carte du client. */
function BotStatus({ client, checklist }: { client: import("@/data/types").BotClient; checklist: ChecklistItem[] }) {
  if (client.botDisabledAt) return <p className="mt-2 text-xs font-semibold text-muted">Bot désactivé</p>;
  if (!client.template) {
    return <p className="mt-2 text-xs text-muted">{client.hasBotRecord ? "Bot détaché du modèle" : "Pas encore de bot"}</p>;
  }
  const blocking = checklist.filter((i) => i.level !== "info");
  if (!blocking.length) return <p className="mt-2 text-xs font-semibold text-green-700">✓ Bot prêt (lié au modèle)</p>;
  return (
    <div className="mt-2 text-xs" data-testid="client-checklist">
      <p className="font-semibold text-coral">
        {blocking.length} point{blocking.length > 1 ? "s" : ""} à vérifier
      </p>
      <ul className="mt-0.5 space-y-0.5 text-muted">
        {blocking.slice(0, 3).map((i) => (
          <li key={i.message} className="truncate" title={i.message}>
            {i.level === "error" ? "⚠" : "•"} {i.message}
          </li>
        ))}
        {blocking.length > 3 && <li>… et {blocking.length - 3} autre{blocking.length - 3 > 1 ? "s" : ""} (voir la fiche)</li>}
      </ul>
    </div>
  );
}
