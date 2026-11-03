"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, Field, Input, Loading, Notice } from "@/components/ui";
import { errorText, getRepositories, useLoad } from "@/data/browser";
import { exportFileName, exportFlow } from "@/data/transfer";
import { hasUnpublishedChanges, type StoredFlow } from "@/data/types";
import { downloadJson } from "@/lib/files";

export default function FlowPage() {
  const { id } = useParams<{ id: string }>();
  const { state, reload } = useLoad(
    async (repos) => {
      const flow = await repos.flows.get(id);
      if (!flow) return null;
      return { flow, client: await repos.clients.get(flow.clientId) };
    },
    [id],
  );

  const data = state.status === "ready" ? state.data : null;
  const breadcrumb = (
    <>
      <Link href="/clients" className="hover:text-navy">
        Clients
      </Link>
      {data?.client && (
        <>
          {" / "}
          <Link href={`/clients/${data.client.id}`} className="hover:text-navy">
            {data.client.nomResto}
          </Link>
          {" / "}
          {data.flow.name}
        </>
      )}
    </>
  );

  return (
    <AppShell breadcrumb={breadcrumb}>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <Notice tone="error">{state.error}</Notice>}
      {state.status === "ready" && !state.data && <Notice tone="error">Ce flux n&apos;existe pas (ou plus) dans ce navigateur.</Notice>}
      {data && <FlowDetails key={data.flow.updatedAt} flow={data.flow} onChange={reload} />}
    </AppShell>
  );
}

function FlowDetails({ flow, onChange }: { flow: StoredFlow; onChange: () => void }) {
  const [name, setName] = useState(flow.name);
  const [description, setDescription] = useState(flow.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== flow.name || description !== (flow.description ?? "");
  const unpublished = hasUnpublishedChanges(flow);

  async function act(action: () => Promise<unknown>) {
    try {
      setError(null);
      await action();
      onChange();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">{flow.name}</h1>
          {!flow.published ? (
            <Badge>Jamais publié</Badge>
          ) : unpublished ? (
            <Badge tone="warning">Publié v{flow.version} · brouillon modifié</Badge>
          ) : (
            <Badge tone="success">Publié v{flow.version}</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => downloadJson(exportFileName("flux", flow.name), exportFlow(flow))}>
            Exporter en JSON
          </Button>
          <Button disabled={!unpublished || dirty} onClick={() => act(() => getRepositories().flows.publish(flow.id))}>
            Publier
          </Button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card title="Réglages du flux" className="h-fit">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => getRepositories().flows.update(flow.id, { name, description }));
            }}
          >
            <Field label="Nom">
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Description" hint="Aide l'IA à choisir ce flux quand un client pose une question.">
              <Input value={description} placeholder="Accueil et lien de commande" onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Button type="submit" disabled={!dirty} className="w-full">
              Enregistrer le brouillon
            </Button>
          </form>
          {flow.publishedAt && (
            <p className="mt-4 text-xs text-muted">
              Dernière publication : {new Date(flow.publishedAt).toLocaleString("fr-FR")}
            </p>
          )}
        </Card>

        <Card title="Brouillon" description="Le tableau blanc (éditeur visuel) arrive à l'étape A4. Pour l'instant : aperçu du contenu du flux.">
          <ul className="mb-4 flex flex-wrap gap-2">
            {flow.draft.nodes.map((n) => (
              <li key={n.id}>
                <Badge tone="info">
                  {n.type} · {n.id}
                </Badge>
              </li>
            ))}
          </ul>
          <pre className="max-h-96 overflow-auto rounded-2xl bg-navy-3 p-4 text-xs text-cyan">{JSON.stringify(flow.draft, null, 2)}</pre>
        </Card>
      </div>
    </div>
  );
}
