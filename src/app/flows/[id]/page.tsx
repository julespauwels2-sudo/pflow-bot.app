"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FlowEditor, type EditorOwner } from "@/components/editor/flow-editor";
import { Loading, Notice } from "@/components/ui";
import { useLoad } from "@/data/browser";
import { findTrigger } from "@/engine";

export default function FlowPage() {
  const { id } = useParams<{ id: string }>();
  const { state } = useLoad(
    async (repos) => {
      const flow = await repos.flows.get(id);
      if (!flow) return null;
      let owner: EditorOwner | null = null;
      if (flow.ownerKind === "template") {
        const template = await repos.templates.get(flow.ownerId);
        if (template) owner = { kind: "template", template };
      } else {
        const client = await repos.clients.get(flow.ownerId);
        if (client) owner = { kind: "client", client };
      }
      if (!owner) return null;
      const flows = (await repos.flows.listByOwner(flow.ownerId)).map((f) => ({
        id: f.id,
        name: f.name,
        isDefault: findTrigger({ id: f.id, name: f.name, ...f.draft })?.data.isDefault ?? false,
      }));
      return { flow, owner, flows };
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
  return <FlowEditor key={state.data.flow.id} flow={state.data.flow} owner={state.data.owner} flows={state.data.flows} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-xl px-4 py-16">{children}</div>;
}
