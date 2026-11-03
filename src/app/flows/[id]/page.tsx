"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FlowEditor } from "@/components/editor/flow-editor";
import { Loading, Notice } from "@/components/ui";
import { useLoad } from "@/data/browser";

export default function FlowPage() {
  const { id } = useParams<{ id: string }>();
  const { state } = useLoad(
    async (repos) => {
      const flow = await repos.flows.get(id);
      if (!flow) return null;
      const client = await repos.clients.get(flow.clientId);
      if (!client) return null;
      const flows = (await repos.flows.listByClient(client.id)).map((f) => ({ id: f.id, name: f.name }));
      return { flow, client, flows };
    },
    [id],
  );

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") return <Centered><Notice tone="error">{state.error}</Notice></Centered>;
  if (!state.data) {
    return (
      <Centered>
        <Notice tone="error">
          Ce flux n&apos;existe pas (ou plus) dans ce navigateur.{" "}
          <Link href="/clients" className="font-semibold underline">
            Retour aux clients
          </Link>
        </Notice>
      </Centered>
    );
  }
  // Chargé une seule fois : l'éditeur gère ensuite lui-même l'état et la sauvegarde.
  return <FlowEditor key={state.data.flow.id} flow={state.data.flow} client={state.data.client} flows={state.data.flows} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-xl px-4 py-16">{children}</div>;
}
