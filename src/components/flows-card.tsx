"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorText, getRepositories } from "@/data/browser";
import { exportFileName, exportFlow, parseFlowImport } from "@/data/transfer";
import { hasUnpublishedChanges, type BotFolder, type OwnerKind, type StoredFlow } from "@/data/types";
import { findTrigger } from "@/engine";
import { downloadJson } from "@/lib/files";
import { Badge, Button, ButtonLink, Card, FileButton, Input, Notice, Select } from "./ui";

type Message = { tone: "success" | "error" | "info"; text: string } | null;

function flowStatus(flow: StoredFlow) {
  if (!flow.published) return <Badge>Jamais publié</Badge>;
  if (hasUnpublishedChanges(flow)) return <Badge tone="warning">Publié v{flow.version} · brouillon modifié</Badge>;
  return <Badge tone="success">Publié v{flow.version}</Badge>;
}

/** Liste des flux d'un client ou du modèle maître, rangés par dossiers (un seul niveau, comme dans UChat). */
export function FlowsCard({
  owner,
  flows,
  folders,
  onChange,
  description = "Un flux démarre par un déclencheur. Seule la version publiée est utilisée par le bot.",
}: {
  owner: { kind: OwnerKind; id: string };
  description?: string;
  flows: StoredFlow[];
  folders: BotFolder[];
  onChange: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [newFolderId, setNewFolderId] = useState("");
  const [folderName, setFolderName] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const repos = () => getRepositories();

  async function run(action: () => Promise<unknown>, success?: string) {
    try {
      await action();
      setMessage(success ? { tone: "success", text: success } : null);
      onChange();
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) });
    }
  }

  async function createFlow(e: React.FormEvent) {
    e.preventDefault();
    try {
      const flow = await repos().flows.create({ ownerKind: owner.kind, ownerId: owner.id, name, folderId: newFolderId || undefined });
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
      const flow = await repos().flows.create({
        ownerKind: owner.kind,
        ownerId: owner.id,
        name: parsed.value.name,
        description: parsed.value.description,
        draft: parsed.value.graph,
      });
      const warn = parsed.warnings.length ? ` Attention : ${parsed.warnings.join(" ")}` : "";
      setMessage({ tone: parsed.warnings.length ? "info" : "success", text: `Flux « ${flow.name} » importé en brouillon (Sans dossier).${warn}` });
      onChange();
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) });
    }
  }

  const sections: { folder: BotFolder | null; flows: StoredFlow[] }[] = [
    ...folders.map((folder) => ({ folder, flows: flows.filter((f) => f.folderId === folder.id) })),
    { folder: null, flows: flows.filter((f) => !f.folderId || !folders.some((d) => d.id === f.folderId)) },
  ];

  return (
    <Card
      className="min-w-0"
      title="Flux"
      description={description}
      actions={
        <FileButton accept="application/json,.json" onFile={importFile}>
          Importer un flux
        </FileButton>
      }
    >
      {flows.length === 0 && folders.length === 0 && <p className="text-sm text-muted">Aucun flux pour l&apos;instant.</p>}

      <div className="space-y-3">
        {sections.map(({ folder, flows: inFolder }, index) =>
          folder === null && inFolder.length === 0 && folders.length > 0 ? null : (
            <FolderSection
              key={folder?.id ?? "sans-dossier"}
              folder={folder}
              flows={inFolder}
              folders={folders}
              isFirst={index === 0}
              isLast={index === folders.length - 1}
              run={run}
            />
          ),
        )}
      </div>

      <form
        className="mt-4 flex gap-2 border-t border-rule pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          const clean = folderName;
          run(() => repos().folders.create({ ownerId: owner.id, name: clean }), `Dossier « ${clean.trim()} » créé.`).then(() => setFolderName(""));
        }}
      >
        <Input aria-label="Nom du nouveau dossier" value={folderName} placeholder="Nouveau dossier (ex. Fonctions IA)" onChange={(e) => setFolderName(e.target.value)} />
        <Button type="submit" variant="secondary" className="shrink-0" disabled={!folderName.trim()}>
          + Dossier
        </Button>
      </form>

      <form onSubmit={createFlow} className="mt-2 flex flex-wrap gap-2 sm:flex-nowrap">
        <Input required value={name} placeholder="Nom du nouveau flux (ex. Accueil)" onChange={(e) => setName(e.target.value)} />
        {folders.length > 0 && (
          <Select aria-label="Dossier du nouveau flux" value={newFolderId} onChange={(e) => setNewFolderId(e.target.value)} className="sm:max-w-48">
            <option value="">Sans dossier</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        )}
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

function FolderSection({
  folder,
  flows,
  folders,
  isFirst,
  isLast,
  run,
}: {
  folder: BotFolder | null;
  flows: StoredFlow[];
  folders: BotFolder[];
  isFirst: boolean;
  isLast: boolean;
  run: (action: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(folder?.name ?? "");
  const repos = () => getRepositories();
  const title = folder?.name ?? "Sans dossier";

  return (
    <details open className="group/folder rounded-2xl border border-rule" data-folder={title}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-2xl bg-page px-3 py-2">
        <span className="text-muted transition group-open/folder:rotate-90" aria-hidden>
          ▸
        </span>
        <span aria-hidden>{folder ? "📁" : "🗂️"}</span>
        <span className={`flex-1 font-semibold ${folder ? "" : "text-muted"}`}>{title}</span>
        <Badge>{flows.length}</Badge>
        {folder && !renaming && (
          <span className="flex gap-0.5 text-xs font-semibold" onClick={(e) => e.preventDefault()}>
            <button type="button" className="rounded px-1.5 py-0.5 text-muted hover:bg-white hover:text-navy" onClick={() => setRenaming(true)}>
              Renommer
            </button>
            <button type="button" aria-label={`Monter ${title}`} disabled={isFirst} className="rounded px-1.5 py-0.5 text-muted hover:bg-white disabled:opacity-30" onClick={() => run(() => repos().folders.move(folder.id, -1))}>
              ↑
            </button>
            <button type="button" aria-label={`Descendre ${title}`} disabled={isLast} className="rounded px-1.5 py-0.5 text-muted hover:bg-white disabled:opacity-30" onClick={() => run(() => repos().folders.move(folder.id, 1))}>
              ↓
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-coral hover:bg-white"
              onClick={() => {
                const what = flows.length ? ` Ses ${flows.length} flux passeront dans « Sans dossier ».` : "";
                if (window.confirm(`Supprimer le dossier « ${title} » ?${what}`)) run(() => repos().folders.delete(folder.id), `Dossier « ${title} » supprimé.`);
              }}
            >
              Supprimer
            </button>
          </span>
        )}
      </summary>

      {/* Hors de <summary> : un clic dans l'en-tête replie le dossier. */}
      {renaming && folder && (
        <form
          className="flex gap-1 border-b border-rule px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => repos().folders.rename(folder.id, draftName)).then(() => setRenaming(false));
          }}
        >
          <Input aria-label="Nouveau nom du dossier" autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)} className="py-1" />
          <Button type="submit" variant="secondary" className="py-1">
            OK
          </Button>
          <Button variant="ghost" className="py-1" onClick={() => setRenaming(false)}>
            Annuler
          </Button>
        </form>
      )}

      {flows.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted">Dossier vide : déplacez-y des flux avec « Déplacer vers… ».</p>
      ) : (
        <ul className="divide-y divide-rule px-3">
          {flows.map((flow) => (
            <FlowRow key={flow.id} flow={flow} folders={folders} run={run} />
          ))}
        </ul>
      )}
    </details>
  );
}

function FlowRow({ flow, folders, run }: { flow: StoredFlow; folders: BotFolder[]; run: (action: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const trigger = findTrigger({ id: flow.id, name: flow.name, ...flow.draft })?.data;
  const keywords = trigger?.keywords ?? [];
  const repos = () => getRepositories();

  return (
    <li className="flex items-center gap-3 py-2.5" data-flow={flow.name}>
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
      <div className="flex shrink-0 items-center gap-1">
        <ButtonLink href={`/flows/${flow.id}`} variant="secondary" className="px-3 py-1.5">
          Ouvrir
        </ButtonLink>
        {folders.length > 0 && (
          <Select
            aria-label={`Déplacer ${flow.name} vers`}
            value=""
            className="!w-32 py-1.5 text-xs"
            onChange={(e) => {
              const target = e.target.value;
              if (!target) return;
              run(() => repos().flows.update(flow.id, { folderId: target === "__aucun" ? null : target }));
            }}
          >
            <option value="">Déplacer…</option>
            {flow.folderId && <option value="__aucun">Sans dossier</option>}
            {folders
              .filter((f) => f.id !== flow.folderId)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </Select>
        )}
        <Button
          variant="ghost"
          className="px-2"
          title="Exporter en JSON"
          aria-label={`Exporter ${flow.name}`}
          onClick={() => downloadJson(exportFileName("flux", flow.name), exportFlow(flow))}
        >
          ⤓
        </Button>
        <Button
          variant="ghost"
          className="px-2 text-coral"
          title="Supprimer"
          aria-label={`Supprimer ${flow.name}`}
          onClick={() => {
            if (window.confirm(`Supprimer le flux « ${flow.name} » ? Cette action est définitive.`)) run(() => repos().flows.delete(flow.id));
          }}
        >
          ✕
        </Button>
      </div>
    </li>
  );
}
