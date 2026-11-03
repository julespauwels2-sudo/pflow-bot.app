"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { InfoSheetForm } from "@/components/info-sheet-form";
import { LocalClock } from "@/components/local-clock";
import { Badge, Button, ButtonLink, Card, Field, FileButton, Input, Loading, Notice, Select } from "@/components/ui";
import { errorText, getRepositories, useLoad } from "@/data/browser";
import { exportFileName, exportFlow, parseFlowImport } from "@/data/transfer";
import { hasUnpublishedChanges, type BotClient, type StoredFlow } from "@/data/types";
import { DEFAULT_ORDER_BASE_URL, findTrigger } from "@/engine";
import { downloadJson } from "@/lib/files";
import { TIMEZONES } from "@/lib/timezones";

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const { state, reload } = useLoad(
    async (repos) => {
      const client = await repos.clients.get(id);
      if (!client) return null;
      const [flows, infoSheet] = await Promise.all([repos.flows.listByClient(id), repos.infoSheets.get(id)]);
      return { client, flows, infoSheet };
    },
    [id],
  );

  const breadcrumb = (
    <>
      <Link href="/clients" className="hover:text-navy">
        Clients
      </Link>
      {state.status === "ready" && state.data && <> / {state.data.client.nomResto}</>}
    </>
  );

  return (
    <AppShell breadcrumb={breadcrumb}>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <Notice tone="error">{state.error}</Notice>}
      {state.status === "ready" && !state.data && <Notice tone="error">Ce client n&apos;existe pas (ou plus) dans ce navigateur.</Notice>}
      {state.status === "ready" && state.data && (
        <div className="space-y-6">
          <h1 className="text-3xl font-semibold">{state.data.client.nomResto}</h1>
          <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
            <ClientSettings key={state.data.client.updatedAt} client={state.data.client} onSaved={reload} />
            <FlowsCard clientId={id} flows={state.data.flows} onChange={reload} />
          </div>
          <InfoSheetForm key={id} clientId={id} timezone={state.data.client.timezone} initial={state.data.infoSheet} />
          <DangerZone client={state.data.client} />
        </div>
      )}
    </AppShell>
  );
}

function ClientSettings({ client, onSaved }: { client: BotClient; onSaved: () => void }) {
  const [form, setForm] = useState({
    nomResto: client.nomResto,
    orderSlug: client.orderSlug,
    timezone: client.timezone,
    triggerMode: client.triggerMode,
  });
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const dirty =
    form.nomResto !== client.nomResto ||
    form.orderSlug !== client.orderSlug ||
    form.timezone !== client.timezone ||
    form.triggerMode !== client.triggerMode;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await getRepositories().clients.update(client.id, form);
      onSaved();
    } catch (error) {
      setStatus({ tone: "error", text: errorText(error) });
    }
  }

  return (
    <Card title="Infos client" className="h-fit">
      <form onSubmit={save} className="space-y-4">
        <Field label="Nom du resto" hint="Variable {{nom_resto}} dans les messages.">
          <Input required value={form.nomResto} onChange={(e) => setForm({ ...form, nomResto: e.target.value })} />
        </Field>
        <Field label="Slug du mini-site" hint={`${DEFAULT_ORDER_BASE_URL}${form.orderSlug}`}>
          <Input required value={form.orderSlug} onChange={(e) => setForm({ ...form, orderSlug: e.target.value })} />
        </Field>
        <Field
          label="Fuseau horaire"
          hint={
            <>
              Utilisé pour les conditions jour/heure et les horaires. Il est <LocalClock timezone={form.timezone} />.
            </>
          }
        >
          <Select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
            {!TIMEZONES.some((t) => t.value === form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Le bot répond…"
          hint={
            form.triggerMode === "mots_cles_uniquement"
              ? "Pour un numéro en coexistence (ex. numéro perso du gérant) : le bot ne réagit qu'aux mots-clés et ignore les conversations privées. Pas de flux par défaut ni d'IA hors conversation."
              : "Pour un numéro dédié aux commandes : tout message reçoit une réponse (flux par défaut, sinon IA)."
          }
        >
          <Select value={form.triggerMode} onChange={(e) => setForm({ ...form, triggerMode: e.target.value as BotClient["triggerMode"] })}>
            <option value="mots_cles_uniquement">Uniquement aux mots-clés</option>
            <option value="toujours">À tous les messages</option>
          </Select>
        </Field>
        <p className="-mt-2 text-[11px] text-muted">Provisoire : à l&apos;étape C, ce réglage sera fait numéro par numéro.</p>
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
        <Button type="submit" disabled={!dirty} className="w-full">
          Enregistrer
        </Button>
      </form>
    </Card>
  );
}

function flowStatus(flow: StoredFlow) {
  if (!flow.published) return <Badge>Jamais publié</Badge>;
  if (hasUnpublishedChanges(flow)) return <Badge tone="warning">Publié v{flow.version} · brouillon modifié</Badge>;
  return <Badge tone="success">Publié v{flow.version}</Badge>;
}

function FlowsCard({ clientId, flows, onChange }: { clientId: string; flows: StoredFlow[]; onChange: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const flow = await getRepositories().flows.create({ clientId, name });
      router.push(`/flows/${flow.id}`);
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) });
    }
  }

  async function importFile(file: File) {
    const parsed = parseFlowImport(await file.text(), flows.map((f) => f.id));
    if (!parsed.ok) {
      setMessage({ tone: "error", text: parsed.error });
      return;
    }
    try {
      const flow = await getRepositories().flows.create({
        clientId,
        name: parsed.value.name,
        description: parsed.value.description,
        draft: parsed.value.graph,
      });
      const warn = parsed.warnings.length ? ` Attention : ${parsed.warnings.join(" ")}` : "";
      setMessage({ tone: parsed.warnings.length ? "info" : "success", text: `Flux « ${flow.name} » importé en brouillon.${warn}` });
      onChange();
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) });
    }
  }

  async function remove(flow: StoredFlow) {
    if (!window.confirm(`Supprimer le flux « ${flow.name} » ? Cette action est définitive.`)) return;
    await getRepositories().flows.delete(flow.id);
    onChange();
  }

  return (
    <Card
      title="Flux"
      description="Un flux démarre par un déclencheur (mots-clés). Seule la version publiée est utilisée par le bot."
      actions={
        <FileButton accept="application/json,.json" onFile={importFile}>
          Importer un flux
        </FileButton>
      }
    >
      {flows.length === 0 ? (
        <p className="text-sm text-muted">Aucun flux pour ce client.</p>
      ) : (
        <ul className="divide-y divide-rule">
          {flows.map((flow) => {
            const trigger = findTrigger({ id: flow.id, name: flow.name, ...flow.draft })?.data;
            const keywords = trigger?.keywords ?? [];
            return (
              <li key={flow.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/flows/${flow.id}`} className="font-semibold hover:text-pink">
                      {flow.name}
                    </Link>
                    {flowStatus(flow)}
                    {trigger?.isDefault && <Badge tone="info">Par défaut</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {keywords.length ? `Mots-clés : ${keywords.join(", ")}` : "Aucun mot-clé"}
                    {flow.description ? ` · ${flow.description}` : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  <ButtonLink href={`/flows/${flow.id}`} variant="secondary">
                    Ouvrir
                  </ButtonLink>
                  <Button variant="ghost" onClick={() => downloadJson(exportFileName("flux", flow.name), exportFlow(flow))}>
                    Exporter
                  </Button>
                  <Button variant="ghost" className="text-coral" onClick={() => remove(flow)}>
                    Supprimer
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={create} className="mt-4 flex gap-2 border-t border-rule pt-4">
        <Input required value={name} placeholder="Nom du nouveau flux (ex. Accueil)" onChange={(e) => setName(e.target.value)} />
        <Button type="submit" className="shrink-0">
          Créer
        </Button>
      </form>
      {message && (
        <div className="mt-3">
          <Notice tone={message.tone} onClose={() => setMessage(null)}>
            {message.text}
          </Notice>
        </div>
      )}
    </Card>
  );
}

function DangerZone({ client }: { client: BotClient }) {
  const router = useRouter();
  async function remove() {
    const typed = window.prompt(`Pour supprimer ${client.nomResto} avec ses flux et sa fiche d'infos, tapez son slug : ${client.orderSlug}`);
    if (typed !== client.orderSlug) return;
    await getRepositories().clients.delete(client.id);
    router.push("/clients");
  }
  return (
    <Card title="Zone sensible">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Supprime ce client, ses flux et sa fiche d&apos;infos de ce navigateur.</p>
        <Button variant="danger" onClick={remove}>
          Supprimer le client
        </Button>
      </div>
    </Card>
  );
}
