"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { LocalClock } from "@/components/local-clock";
import { Badge, Button, Card, Field, FileButton, Input, Loading, Notice, Select } from "@/components/ui";
import { errorText, getRepositories, isCrmMode, useLoad } from "@/data/browser";
import { loadDemo } from "@/data/demo";
import { exportBackup, exportFileName, parseBackup } from "@/data/transfer";
import { DEFAULT_ORDER_BASE_URL, DEFAULT_TIMEZONE } from "@/engine";
import { downloadJson } from "@/lib/files";
import { TIMEZONES, slugify, timezoneLabel } from "@/lib/timezones";

type Message = { tone: "error" | "success"; text: string } | null;

const CRM_STATUTS: Record<string, string> = { signe: "Signé", actif: "Actif", demo: "Démo", perdu: "Perdu" };

export default function ClientsPage() {
  const { state, reload } = useLoad(async (repos) => {
    const clients = await repos.clients.list();
    const counts = await Promise.all(clients.map((c) => repos.flows.listByOwner(c.id).then((f) => f.length)));
    return clients.map((client, i) => ({ client, flowCount: counts[i] }));
  }, []);
  const [message, setMessage] = useState<Message>(null);

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
          {state.status === "ready" && state.data.length === 0 && isCrmMode && (
            <Card title="Aucun resto à afficher">
              <p className="text-sm text-muted">Aucun resto signé, actif ou en démo dans le CRM pour l&apos;instant.</p>
            </Card>
          )}
          {state.status === "ready" && state.data.length === 0 && !isCrmMode && (
            <Card title="Aucun client pour l'instant">
              <p className="text-sm text-muted">Créez votre premier resto, ou chargez un resto d&apos;exemple déjà configuré.</p>
              <Button className="mt-4" variant="secondary" onClick={() => run(async () => void (await loadDemo(getRepositories())))}>
                Charger le resto d&apos;exemple
              </Button>
            </Card>
          )}
          {state.status === "ready" && state.data.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {state.data.map(({ client, flowCount }) => (
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
