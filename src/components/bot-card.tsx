"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorText, getRepositories } from "@/data/browser";
import { botChecklist, resolveBot, type BotInput, type ResolvedFlow } from "@/data/resolve";
import type { BotTemplate } from "@/data/types";
import type { InfoSheet } from "@/engine";
import { useCurrentMinute } from "./local-clock";
import { Badge, Button, ButtonLink, Card, Notice } from "./ui";

const LEVEL_STYLE = {
  error: "text-coral font-semibold",
  warning: "text-amber-700",
  info: "text-muted",
} as const;
const LEVEL_ICON = { error: "⚠", warning: "•", info: "ℹ︎" } as const;

/** Carte « Bot » du client : lien au modèle maître, liste de contrôle, flux du modèle. */
export function BotCard({
  input,
  template,
  infoSheet,
  onChange,
}: {
  input: BotInput;
  /** Modèle maître (null s'il n'est pas encore créé). */
  template: BotTemplate | null;
  infoSheet: InfoSheet;
  onChange: () => void;
}) {
  const router = useRouter();
  const minute = useCurrentMinute();
  const [error, setError] = useState<string | null>(null);
  const { client } = input;
  const linked = Boolean(client.template);

  async function run(action: () => Promise<unknown>) {
    try {
      setError(null);
      await action();
      onChange();
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!linked) {
    return (
      <Card title="Bot" description="Le bot de ce client = les flux du modèle maître + ses flux propres.">
        {template ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Pas encore lié au modèle. Rien n&apos;est copié : le bot utilisera les flux publiés du modèle, et chaque mise à jour du modèle
              s&apos;appliquera automatiquement.
            </p>
            <Button onClick={() => run(() => getRepositories().bots.link(client.id, template.id))}>Créer le bot depuis le modèle</Button>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Crée d&apos;abord le{" "}
            <Link href="/modele" className="font-semibold text-pink hover:underline">
              modèle maître
            </Link>
            , puis reviens ici pour créer le bot de ce client.
          </p>
        )}
        {error && (
          <div className="mt-3">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </Card>
    );
  }

  const { entries } = resolveBot(input);
  const fromTemplate = entries.filter((e) => e.origin !== "client");
  const checklist = minute === null ? [] : botChecklist(input, infoSheet, new Date(minute * 60_000));
  // Dossiers dans l'ordre du modèle, puis « Sans dossier ».
  const order = (input.templateFolders ?? []).map((f) => f.name);
  const folders = [...new Set(fromTemplate.map((e) => e.folderName ?? "Sans dossier"))].sort(
    (a, b) => (order.indexOf(a) === -1 ? 999 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 999 : order.indexOf(b)),
  );

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          Bot <Badge tone="success">Lié au {template?.name ?? "modèle maître"}</Badge>
        </span>
      }
      description="Les flux publiés du modèle s'appliquent à ce client, plus ses flux propres (carte « Flux » ci-dessous)."
      actions={
        <Button
          variant="danger"
          onClick={() => {
            const ok = window.confirm(
              "Détacher ce bot du modèle ? Tous les flux du modèle seront copiés chez ce client, et les prochaines mises à jour du modèle ne s'appliqueront plus.",
            );
            if (ok) run(() => getRepositories().bots.detach(client.id));
          }}
        >
          Détacher du modèle
        </Button>
      }
    >
      <div className="space-y-5">
        <div>
          <h3 className="text-sm font-semibold">À vérifier pour ce client</h3>
          {checklist.length === 0 ? (
            <p className="mt-1 rounded-xl bg-wa/10 p-2.5 text-sm font-semibold text-green-700">Tout est prêt : il ne reste qu&apos;à connecter le numéro WhatsApp (étape C).</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm" data-testid="checklist">
              {checklist.map((item) => (
                <li key={item.message} className={LEVEL_STYLE[item.level]}>
                  {LEVEL_ICON[item.level]} {item.message}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold">Flux du modèle</h3>
          <div className="mt-2 space-y-3">
            {folders.map((name) => (
              <div key={name} className="rounded-2xl border border-rule" data-bot-folder={name}>
                <p className="rounded-t-2xl bg-page px-3 py-2 text-sm font-semibold">📁 {name}</p>
                <ul className="divide-y divide-rule px-3">
                  {fromTemplate
                    .filter((e) => (e.folderName ?? "Sans dossier") === name)
                    .map((e) => (
                      <TemplateFlowRow
                        key={e.botId}
                        entry={e}
                        onPersonalize={() =>
                          run(async () => {
                            const copy = await getRepositories().bots.personalize(client.id, e.botId);
                            router.push(`/flows/${copy.id}`);
                          })
                        }
                        onRevert={() => {
                          if (window.confirm(`Revenir au flux du modèle pour « ${e.name} » ? La personnalisation de ce client sera supprimée.`)) {
                            run(() => getRepositories().bots.revert(e.source.id));
                          }
                        }}
                      />
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Card>
  );
}

function TemplateFlowRow({ entry, onPersonalize, onRevert }: { entry: ResolvedFlow; onPersonalize: () => void; onRevert: () => void }) {
  const personalized = entry.origin === "personnalise";
  return (
    <li className="flex items-center gap-3 py-2.5" data-bot-flow={entry.name}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{entry.name}</span>
          {personalized ? <Badge tone="info">Personnalisé</Badge> : <Badge>Modèle</Badge>}
          {!entry.active && <Badge tone="warning">Inactif</Badge>}
          {entry.templateChanged && <Badge tone="warning">Modèle mis à jour depuis</Badge>}
        </div>
        {!entry.active && entry.inactiveReason && <p className="mt-0.5 text-xs text-muted">{entry.inactiveReason}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {personalized ? (
          <>
            <ButtonLink href={`/flows/${entry.source.id}`} variant="secondary" className="px-3 py-1.5">
              Modifier
            </ButtonLink>
            <Button variant="ghost" className="px-2 text-xs" onClick={onRevert}>
              Revenir au modèle
            </Button>
          </>
        ) : (
          <>
            <ButtonLink href={`/flows/${entry.botId}`} variant="ghost" className="px-2 text-xs">
              Voir dans le modèle
            </ButtonLink>
            <Button variant="secondary" className="px-3 py-1.5" onClick={onPersonalize} disabled={!entry.templateFlow?.published}>
              Personnaliser
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
