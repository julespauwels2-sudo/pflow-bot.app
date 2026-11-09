"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, Field, Input, Loading, Notice, Textarea } from "@/components/ui";
import { errorText, getRepositories, isCrmMode, useLoad } from "@/data/browser";
import type { BotClient, DemoRecord } from "@/data/types";
import { DEFAULT_DEMO_DAYS, demoOrderUrl } from "@/demos/keyword";
import { isDemoActive, isDemoClient } from "@/demos/lifecycle";
import { accessToken } from "@/lib/supabase";

type Message = { tone: "error" | "success"; text: string } | null;
interface Row {
  client: BotClient;
  demo?: DemoRecord;
}

const date = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const daysLeft = (iso: string, now: number) => Math.max(0, Math.round((Date.parse(iso) - now) / 86_400_000));

export default function DemosPage() {
  const { state, reload } = useLoad(async (repos) => {
    // En local, pas de création automatique : la purge des démos expirées se fait ici.
    if (!isCrmMode) await repos.demos.purgeExpired();
    const [clients, demos, available] = await Promise.all([repos.clients.list(), repos.demos.list(), repos.demos.available()]);
    const byClient = new Map(demos.map((d) => [d.clientId, d]));
    // Avec le CRM : les restos en démo (et ceux dont la démo vient de se terminer). En local : les démos démarrées.
    const rows: Row[] = clients
      .filter((c) => (isCrmMode ? c.crmStatut === "demo" || byClient.has(c.id) : true))
      .map((client) => ({ client, demo: byClient.get(client.id) }));
    return { rows, available };
  }, []);
  const [message, setMessage] = useState<Message>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await accessToken();
        const response = await fetch("/api/demos", { headers: token ? { authorization: `Bearer ${token}` } : {} });
        const body = (await response.json().catch(() => ({}))) as { available?: boolean; conversations?: Record<string, number> };
        if (!cancelled && response.ok && body.available) setCounts(body.conversations ?? {});
      } catch {
        // compteur indisponible : « — »
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<string>) {
    try {
      setMessage({ tone: "success", text: await action() });
      reload();
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) });
    }
  }

  const rows = state.status === "ready" ? state.data.rows : [];
  const now = new Date(nowMs);
  const current = rows.filter((r) => r.demo && !r.demo.deletedAt);
  const ended = rows.filter((r) => r.demo?.deletedAt);
  const waiting = rows.filter((r) => !r.demo);

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Démos</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Toutes les démos passent par <strong>ton numéro WhatsApp PFlow</strong>. Le prospect écrit le mot-clé de sa démo et elle démarre avec sa
            carte et ses infos. Sans mot-clé, le bot PFlow de base répond. Une démo dure {DEFAULT_DEMO_DAYS} jours, puis son bot est supprimé
            (données du bot seulement, jamais le CRM), sauf si le resto est passé signé ou actif.
          </p>
        </div>
        <Link href="/simulateur?numero=pflow" className="rounded-full bg-navy-2 px-4 py-2 text-sm font-semibold text-white hover:opacity-90" data-testid="demos-simuler">
          📱 Simuler le numéro PFlow
        </Link>
      </div>

      <div className="mt-6 space-y-4">
        {message && (
          <Notice tone={message.tone} onClose={() => setMessage(null)}>
            {message.text}
          </Notice>
        )}
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <Notice tone="error">{state.error}</Notice>}
        {state.status === "ready" && !state.data.available && (
          <Notice tone="info">
            Démos en lecture seule : la table <code>bot_demos</code> arrive avec la migration C (étape C). D&apos;ici là, les bots des démos sont créés
            normalement, sans mot-clé ni expiration.
          </Notice>
        )}

        <KnowledgeCard />

        {state.status === "ready" && (
          <Card title={`En cours (${current.length})`}>
            {current.length === 0 ? (
              <p className="text-sm text-muted">
                {isCrmMode ? "Aucune démo en cours : passe un resto en statut « démo » dans le CRM, son bot et sa démo se créent tout seuls." : "Aucune démo en cours."}
              </p>
            ) : (
              <ul className="divide-y divide-rule" data-testid="demos-list">
                {current.map(({ client, demo }) => (
                  <DemoRow
                    key={client.id}
                    client={client}
                    demo={demo!}
                    now={now}
                    conversations={counts ? (counts[client.id] ?? 0) : null}
                    disabled={!state.data.available}
                    onAction={run}
                  />
                ))}
              </ul>
            )}
          </Card>
        )}

        {state.status === "ready" && waiting.length > 0 && (
          <Card title={isCrmMode ? "En démo dans le CRM, sans démo sur le numéro PFlow" : "Restos sans démo"}>
            <ul className="divide-y divide-rule text-sm">
              {waiting.map(({ client }) => (
                <li key={client.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <strong>{client.nomResto}</strong>{" "}
                    {!client.template && <span className="text-muted">(pas encore de bot lié au modèle)</span>}
                  </span>
                  {client.template && (
                    <Button variant="secondary" disabled={!state.data.available} onClick={() => run(async () => `Démo de ${client.nomResto} démarrée (mot-clé « ${(await getRepositories().demos.start(client.id)).keyword} »).`)}>
                      Démarrer la démo
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {state.status === "ready" && ended.length > 0 && (
          <Card title={`Terminées (${ended.length})`}>
            <ul className="space-y-1 text-sm text-muted">
              {ended.map(({ client, demo }) => (
                <li key={client.id}>
                  <strong className="text-ink">{client.nomResto}</strong> · mot-clé « {demo!.keyword} » · bot supprimé le {date(demo!.deletedAt!)}. Un
                  prospect qui écrit ce mot-clé reçoit un message poli.
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function DemoRow({
  client,
  demo,
  now,
  conversations,
  disabled,
  onAction,
}: {
  client: BotClient;
  demo: DemoRecord;
  now: Date;
  conversations: number | null;
  disabled: boolean;
  onAction: (action: () => Promise<string>) => void;
}) {
  const [keyword, setKeyword] = useState(demo.keyword);
  const active = isDemoActive(demo, now);
  const converted = !isDemoClient(client);
  const left = daysLeft(demo.expiresAt, now.getTime());
  const repos = getRepositories().demos;
  return (
    <li className="space-y-2 py-3" data-testid="demo-row">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/clients/${client.id}`} className="text-lg font-semibold hover:underline">
          {client.nomResto}
        </Link>
        {converted ? (
          <Badge tone="success">Devenu client : le bot reste</Badge>
        ) : active ? (
          <Badge tone="info">{left <= 1 ? "Expire bientôt" : `Encore ${left} jours`}</Badge>
        ) : (
          <Badge tone="warning">Expirée (suppression au prochain chargement)</Badge>
        )}
        {demoOrderUrl(client.demoCode) ? (
          <Badge tone="success">Page de commande de démo prête</Badge>
        ) : (
          <Badge tone="warning">Pas de bouton Commander : « Préparer la démo » dans le CRM</Badge>
        )}
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onAction(async () => `Mot-clé de ${client.nomResto} : « ${(await repos.setKeyword(client.id, keyword)).keyword} ».`);
          }}
        >
          <label className="shrink-0 font-semibold" htmlFor={`kw-${client.id}`}>
            Mot-clé
          </label>
          <Input id={`kw-${client.id}`} aria-label={`Mot-clé de ${client.nomResto}`} value={keyword} disabled={disabled} onChange={(e) => setKeyword(e.target.value)} />
          {keyword !== demo.keyword && (
            <Button type="submit" variant="secondary" disabled={disabled}>
              Enregistrer
            </Button>
          )}
        </form>
        <span className="text-muted">
          Expire le <strong className="text-ink">{date(demo.expiresAt)}</strong> ({demo.days} j)
        </span>
        <span className="text-muted" data-testid="demo-conversations">
          {conversations === null ? "— conversation" : `${conversations} conversation${conversations > 1 ? "s" : ""}`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={disabled || converted} onClick={() => onAction(async () => `Démo de ${client.nomResto} prolongée jusqu'au ${date((await repos.extend(client.id, DEFAULT_DEMO_DAYS)).expiresAt)}.`)}>
          Prolonger de {DEFAULT_DEMO_DAYS} jours
        </Button>
        <Button
          variant="danger"
          disabled={disabled || converted}
          onClick={() => {
            if (window.confirm(`Supprimer la démo de ${client.nomResto} ? Son bot est supprimé (données du bot seulement, le CRM ne change pas).`)) {
              onAction(async () => {
                await repos.remove(client.id);
                return `Démo de ${client.nomResto} supprimée.`;
              });
            }
          }}
        >
          Supprimer
        </Button>
      </div>
    </li>
  );
}

interface Knowledge {
  faq: string;
  regles: string;
  parDefaut: boolean;
  iaActive: boolean;
}

/** Base de connaissances du bot PFlow Démo : ce que l'IA a le droit de dire aux prospects (modifiable sans code). */
function KnowledgeCard() {
  const [kb, setKb] = useState<Knowledge | null>(null);
  const [draft, setDraft] = useState({ faq: "", regles: "" });
  const [status, setStatus] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await accessToken();
        const response = await fetch("/api/demos/base-connaissances", { headers: token ? { authorization: `Bearer ${token}` } : {} });
        const body = (await response.json().catch(() => ({}))) as Partial<Knowledge> & { error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error ?? `Erreur ${response.status}`);
        const loaded = { faq: body.faq ?? "", regles: body.regles ?? "", parDefaut: Boolean(body.parDefaut), iaActive: Boolean(body.iaActive) };
        setKb(loaded);
        setDraft({ faq: loaded.faq, regles: loaded.regles });
      } catch (error) {
        if (!cancelled) setStatus({ tone: "error", text: `Base de connaissances indisponible : ${errorText(error)}` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    try {
      const token = await accessToken();
      const response = await fetch("/api/demos/base-connaissances", {
        method: "PUT",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(draft),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Erreur ${response.status}`);
      setKb((k) => (k ? { ...k, ...draft, parDefaut: false } : k));
      setStatus({ tone: "success", text: "Base enregistrée : le bot PFlow Démo l'utilise dès le prochain message." });
    } catch (error) {
      setStatus({ tone: "error", text: errorText(error) });
    } finally {
      setSaving(false);
    }
  }

  const changed = kb !== null && (draft.faq !== kb.faq || draft.regles !== kb.regles);
  return (
    <Card
      title="Bot PFlow Démo : base de connaissances"
      description="Quand un prospect pose une question pendant la démo, l'IA répond seulement avec ce qui est écrit ici, puis la démo reprend. Si la réponse n'y est pas, Jules est prévenu (notification push). Livraison, inscription, négociation et « parler à Jules » passent toujours par toi."
    >
      <div className="space-y-3" data-testid="demo-knowledge">
        {status && (
          <Notice tone={status.tone} onClose={() => setStatus(null)}>
            {status.text}
          </Notice>
        )}
        {kb === null && !status && <Loading />}
        {kb && (
          <>
            <div className="flex flex-wrap gap-2">
              {kb.parDefaut ? <Badge tone="info">Base par défaut (jamais enregistrée)</Badge> : <Badge tone="success">Base enregistrée</Badge>}
              {kb.iaActive ? (
                <Badge tone="success">IA active</Badge>
              ) : (
                <Badge tone="warning">IA inactive (ANTHROPIC_API_KEY absente) : toute question prévient Jules</Badge>
              )}
            </div>
            <Field label="FAQ : ce que PFlow propose" hint="Une information par ligne. L'IA ne cite jamais un prix ou une fonctionnalité absente d'ici.">
              <Textarea rows={10} value={draft.faq} maxLength={8000} onChange={(e) => setDraft((d) => ({ ...d, faq: e.target.value }))} data-testid="demo-knowledge-faq" />
            </Field>
            <Field label="Règles de réponse" hint="Ce que l'IA ne doit jamais dire, et quand elle passe la main.">
              <Textarea rows={5} value={draft.regles} maxLength={4000} onChange={(e) => setDraft((d) => ({ ...d, regles: e.target.value }))} data-testid="demo-knowledge-regles" />
            </Field>
            <Button disabled={!changed || saving} onClick={save} data-testid="demo-knowledge-save">
              {saving ? "Enregistrement…" : "Enregistrer la base"}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
