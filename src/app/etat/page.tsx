"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Card, Loading, Notice } from "@/components/ui";
import { errorText, useLoad } from "@/data/browser";
import type { AiCallLog } from "@/data/types";
import { accessToken } from "@/lib/supabase";

interface SystemStatus {
  cles: { name: string; role: string; present: boolean }[];
  canaux: { plateforme: "whatsapp" | "instagram"; configure: boolean; missing: string[]; webhook: string }[];
  services: { stockage: "supabase" | "memory"; ia: { active: boolean; modele: string }; transcription: { active: boolean; service?: string }; deploiement: string };
  comptes: { plateforme: string; etat: string }[];
  evenements: { source: string; cle: string; at: string; erreur?: string }[];
  erreurCanaux?: string;
}

const time = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const usd = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} $`;
const NAMES = { whatsapp: "WhatsApp", instagram: "Instagram" } as const;

export default function SystemStatusPage() {
  const [server, setServer] = useState<{ status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: SystemStatus }>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const { state } = useLoad(async (repos) => {
    const data = await repos.workspace.exportAll();
    const names = new Map(data.clients.map((c) => [c.id, c.nomResto]));
    const bots = data.clients.filter((c) => c.template && !c.botDisabledAt);
    const calls = [...data.aiCalls].sort((a, b) => b.at.localeCompare(a.at));
    return {
      botsActifs: bots.length,
      botsDesactives: data.clients.filter((c) => c.botDisabledAt).length,
      clients: data.clients.length,
      appels: calls.slice(0, 10).map((c) => ({ ...c, resto: names.get(c.clientId) ?? "?" })),
      erreursIa: calls.filter((c) => c.error).slice(0, 10).map((c) => ({ ...c, resto: names.get(c.clientId) ?? "?" })),
      cout30j: calls.filter((c) => Date.now() - Date.parse(c.at) < 30 * 86_400_000).reduce((sum, c) => sum + (c.costUsd ?? 0), 0),
    };
  }, [tick]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await accessToken();
        const response = await fetch("/api/etat", { headers: token ? { authorization: `Bearer ${token}` } : {} });
        const body = (await response.json().catch(() => ({}))) as SystemStatus & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `Erreur ${response.status}`);
        if (!cancelled) setServer({ status: "ready", data: body });
      } catch (error) {
        if (!cancelled) setServer({ status: "error", error: errorText(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">État du système</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Réservé aux administrateurs. Les clés sont seulement détectées : leur valeur n&apos;est jamais lue ni affichée.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setTick((t) => t + 1)}>
          Actualiser
        </Button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2" data-testid="etat">
        <Card title="Bots">
          {state.status === "loading" && <Loading />}
          {state.status === "error" && <Notice tone="error">{state.error}</Notice>}
          {state.status === "ready" && (
            <ul className="space-y-1 text-sm">
              <li>
                <strong className="text-lg">{state.data.botsActifs}</strong> bot{state.data.botsActifs > 1 ? "s" : ""} actif{state.data.botsActifs > 1 ? "s" : ""} (liés au modèle)
              </li>
              <li className="text-muted">
                {state.data.botsDesactives} désactivé{state.data.botsDesactives > 1 ? "s" : ""} · {state.data.clients} resto{state.data.clients > 1 ? "s" : ""} en tout
              </li>
              <li className="text-muted">Coût IA des 30 derniers jours : {usd(state.data.cout30j)}</li>
            </ul>
          )}
        </Card>
        {server.status === "loading" && <Loading />}
        {server.status === "error" && <Notice tone="error">{server.error}</Notice>}
        {server.status === "ready" && <ServerCards data={server.data} />}


        <Card title="Derniers appels IA" className="lg:col-span-2">
          {state.status === "ready" && <AiCalls calls={state.data.appels} empty="Aucun appel IA pour l'instant." />}
        </Card>
        <Card title="Dernières erreurs IA" className="lg:col-span-2">
          {state.status === "ready" && <AiCalls calls={state.data.erreursIa} empty="Aucune erreur IA. 👍" />}
        </Card>
      </div>
    </AppShell>
  );
}

function ServerCards({ data }: { data: SystemStatus }) {
  const errors = data.evenements.filter((e) => e.erreur);
  return (
    <>

      <Card title="Canaux et services">
        <ul className="space-y-2 text-sm">
          {data.canaux.map((c) => {
            const comptes = data.comptes.filter((x) => x.plateforme === c.plateforme);
            return (
              <li key={c.plateforme}>
                <span className="flex items-center gap-2">
                  <strong>Webhook {NAMES[c.plateforme]}</strong>
                  {c.configure ? <Badge tone="success">actif</Badge> : <Badge>inactif</Badge>}
                  <code className="text-xs text-muted">{c.webhook}</code>
                </span>
                {!c.configure && <span className="block text-xs text-muted">Manque : {c.missing.join(", ")}</span>}
                {c.configure && (
                  <span className="block text-xs text-muted">
                    {comptes.length} compte{comptes.length > 1 ? "s" : ""} relié{comptes.length > 1 ? "s" : ""}
                    {comptes.length > 0 && ` (${comptes.filter((x) => x.etat === "actif").length} actif, ${comptes.filter((x) => x.etat === "test").length} en test)`}
                  </span>
                )}
              </li>
            );
          })}
          <li>
            <strong>IA</strong> {data.services.ia.active ? <Badge tone="success">active</Badge> : <Badge>inactive</Badge>}{" "}
            <span className="text-xs text-muted">{data.services.ia.modele}</span>
          </li>
          <li>
            <strong>Messages vocaux</strong> {data.services.transcription.active ? <Badge tone="success">actifs</Badge> : <Badge>inactifs</Badge>}{" "}
            {data.services.transcription.service && <span className="text-xs text-muted">{data.services.transcription.service}</span>}
          </li>
          <li className="text-xs text-muted">
            Stockage des conversations : {data.services.stockage === "memory" ? "mémoire (démo)" : "Supabase"} · hébergement : {data.services.deploiement}
          </li>
        </ul>
        {data.erreurCanaux && (
          <div className="mt-3">
            <Notice tone="error">Canaux : {data.erreurCanaux}</Notice>
          </div>
        )}
      </Card>

      <Card title="Clés détectées" className="lg:col-span-2">
        <ul className="grid gap-x-8 gap-y-1 text-sm md:grid-cols-2" data-testid="etat-cles">
          {data.cles.map((k) => (
            <li key={k.name} className="flex items-center justify-between gap-2">
              <span>
                <code className="text-xs">{k.name}</code> <span className="text-muted">· {k.role}</span>
              </span>
              {k.present ? <Badge tone="success">présente</Badge> : <Badge>absente</Badge>}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Derniers événements reçus (webhooks)" className="lg:col-span-2">
        {data.evenements.length === 0 ? (
          <p className="text-sm text-muted">Aucun événement reçu.</p>
        ) : (
          <ul className="divide-y divide-rule text-sm">
            {data.evenements.slice(0, 10).map((e) => (
              <li key={e.source + e.cle + e.at} className="flex flex-wrap gap-2 py-1">
                <span className="text-muted">{time(e.at)}</span>
                <Badge>{e.source}</Badge>
                <code className="text-xs">{e.cle}</code>
                {e.erreur && <span className="text-coral">{e.erreur}</span>}
              </li>
            ))}
          </ul>
        )}
        {errors.length > 0 && <p className="mt-2 text-xs text-muted">{errors.length} événement(s) avec une erreur ou ignoré(s) parmi les 30 derniers.</p>}
      </Card>
    </>
  );
}

function AiCalls({ calls, empty }: { calls: (AiCallLog & { resto: string })[]; empty: string }) {
  if (calls.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-rule text-sm">
      {calls.map((c) => (
        <li key={c.id} className="flex flex-wrap items-baseline gap-2 py-1.5">
          <span className="text-muted">{time(c.at)}</span>
          <strong>{c.resto}</strong>
          <Badge>{c.source}</Badge>
          <span className="min-w-0 flex-1 truncate">{c.message}</span>
          {c.error ? <span className="text-coral">{c.error}</span> : c.decision && <span className="text-xs text-muted">{c.decision.action}</span>}
          {typeof c.costUsd === "number" && <span className="text-xs text-muted">{usd(c.costUsd)}</span>}
        </li>
      ))}
    </ul>
  );
}
