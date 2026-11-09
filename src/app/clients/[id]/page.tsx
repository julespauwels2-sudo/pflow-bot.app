"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AiCallsCard, AiKnowledgeCard } from "@/components/ai-cards";
import { AppShell } from "@/components/app-shell";
import { BotCard } from "@/components/bot-card";
import { FlowsCard } from "@/components/flows-card";
import { InfoSheetForm } from "@/components/info-sheet-form";
import { LocalClock } from "@/components/local-clock";
import { Button, ButtonLink, Card, Field, Input, Loading, Notice, Select } from "@/components/ui";
import { errorText, getRepositories, isCrmMode, useLoad } from "@/data/browser";
import { BOT_OPTIONS, BOT_OPTION_KEYS, type BotOption } from "@/data/options";
import type { BotClient } from "@/data/types";
import { DEFAULT_ORDER_BASE_URL } from "@/engine";
import { TIMEZONES } from "@/lib/timezones";

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const { state, reload } = useLoad(
    async (repos) => {
      const client = await repos.clients.get(id);
      if (!client) return null;
      const [flows, folders, infoSheet, templates, aiCalls] = await Promise.all([
        repos.flows.listByOwner(id),
        repos.folders.listByOwner(id),
        repos.infoSheets.get(id),
        repos.templates.list(),
        repos.aiCalls.listByClient(id),
      ]);
      const locked = await repos.infoSheets.lockedFields(id);
      const template = templates.find((t) => t.id === client.template?.templateId) ?? templates[0] ?? null;
      const [templateFlows, templateFolders] = template
        ? await Promise.all([repos.flows.listByOwner(template.id), repos.folders.listByOwner(template.id)])
        : [[], []];
      return { client, flows, folders, infoSheet, template, templateFlows, templateFolders, aiCalls, locked };
    },
    [id],
  );

  const breadcrumb = (
    <>
      <Link href="/clients" className="hover:text-ink">
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-5xl">{state.data.client.nomResto}<span className="text-rose">.</span></h1>
            <ButtonLink href={`/simulateur?client=${id}`}>💬 Tester le bot</ButtonLink>
          </div>
          <BotCard
            input={{
              client: state.data.client,
              templateFlows: state.data.templateFlows,
              templateFolders: state.data.templateFolders,
              clientFlows: state.data.flows,
              clientFolders: state.data.folders,
            }}
            template={state.data.template}
            infoSheet={state.data.infoSheet}
            onChange={reload}
          />
          <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
            <ClientSettings key={state.data.client.updatedAt} client={state.data.client} onSaved={reload} />
            <FlowsCard
              owner={{ kind: "client", id }}
              flows={state.data.flows}
              folders={state.data.folders}
              onChange={reload}
              title={state.data.client.template ? "Flux propres au client" : "Flux"}
              templateFlowNames={Object.fromEntries(state.data.templateFlows.map((f) => [f.id, f.name]))}
            />
          </div>
          <AiKnowledgeCard
            input={{
              client: state.data.client,
              templateFlows: state.data.templateFlows,
              templateFolders: state.data.templateFolders,
              clientFlows: state.data.flows,
              clientFolders: state.data.folders,
            }}
            template={state.data.template}
            infoSheet={state.data.infoSheet}
          />
          <InfoSheetForm key={id} clientId={id} timezone={state.data.client.timezone} initial={state.data.infoSheet} locked={state.data.locked} isDemo={state.data.client.crmStatut === "demo"} onSaved={reload} />
          <AiCallsCard clientId={id} calls={state.data.aiCalls} onChange={reload} />
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
    options: { ...client.options } as Partial<Record<BotOption, boolean>>,
  });
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const dirty =
    form.nomResto !== client.nomResto ||
    form.orderSlug !== client.orderSlug ||
    form.timezone !== client.timezone ||
    form.triggerMode !== client.triggerMode ||
    BOT_OPTION_KEYS.some((k) => Boolean(form.options[k]) !== Boolean(client.options?.[k]));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      // Clients du CRM : seul le mode de déclenchement se règle ici.
      await getRepositories().clients.update(client.id, isCrmMode ? { triggerMode: form.triggerMode } : form);
      onSaved();
    } catch (error) {
      setStatus({ tone: "error", text: errorText(error) });
    }
  }

  return (
    <Card title="Infos client" className="h-fit">
      <form onSubmit={save} className="space-y-4">
        {isCrmMode && <p className="rounded-xl bg-ink/5 p-2.5 text-[11px] text-muted">Nom, slug, fuseau et options payantes viennent du CRM : à modifier là-bas.</p>}
        <Field label="Nom du resto" hint="Variable {{nom_resto}} dans les messages.">
          <Input required disabled={isCrmMode} value={form.nomResto} onChange={(e) => setForm({ ...form, nomResto: e.target.value })} />
        </Field>
        <Field label="Slug du mini-site" hint={form.orderSlug ? `${DEFAULT_ORDER_BASE_URL}${form.orderSlug}` : "Pas de slug : boutons « Commander » impossibles."}>
          <Input required={!isCrmMode} disabled={isCrmMode} value={form.orderSlug} onChange={(e) => setForm({ ...form, orderSlug: e.target.value })} />
        </Field>
        <Field
          label="Fuseau horaire"
          hint={
            <>
              Utilisé pour les conditions jour/heure et les horaires. Il est <LocalClock timezone={form.timezone} />.
            </>
          }
        >
          <Select disabled={isCrmMode} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
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
        <fieldset>
          <legend className="text-sm font-semibold">Options payantes{isCrmMode && <span className="font-normal text-muted"> (modules du CRM)</span>}</legend>
          {BOT_OPTION_KEYS.map((key) => (
            <label key={key} className="mt-2 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-pink"
                disabled={isCrmMode}
                checked={Boolean(form.options[key])}
                onChange={(e) => setForm({ ...form, options: { ...form.options, [key]: e.target.checked } })}
              />
              <span>
                <span className="block font-semibold">{BOT_OPTIONS[key].label}</span>
                <span className="block text-[11px] text-muted">{BOT_OPTIONS[key].description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
        <Button type="submit" disabled={!dirty} className="w-full">
          Enregistrer
        </Button>
      </form>
    </Card>
  );
}

function DangerZone({ client }: { client: BotClient }) {
  const router = useRouter();
  // Confirmation : le slug, ou le nom du resto s'il n'a pas de slug.
  const confirmWord = client.orderSlug || client.nomResto;
  async function remove() {
    const what = isCrmMode ? `le bot de ${client.nomResto} (flux, fiche du bot, journal IA)` : `${client.nomResto} avec ses flux et sa fiche d'infos`;
    const typed = window.prompt(`Pour supprimer ${what}, tapez : ${confirmWord}`);
    if (typed?.trim() !== confirmWord) return;
    await getRepositories().clients.delete(client.id);
    router.push("/clients");
  }
  return (
    <Card title="Zone sensible">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {isCrmMode
            ? "Supprime le contenu du bot de ce resto (flux, partie bot de la fiche, tournées, journal IA) et le désactive : il ne sera pas recréé automatiquement. Le resto reste dans le CRM, sans aucune modification."
            : "Supprime ce client, ses flux et sa fiche d'infos de ce navigateur."}
        </p>
        <Button variant="danger" onClick={remove}>
          {isCrmMode ? "Supprimer le bot" : "Supprimer le client"}
        </Button>
      </div>
    </Card>
  );
}
