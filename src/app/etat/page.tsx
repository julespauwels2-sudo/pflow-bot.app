"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { MobileHeader } from "@/components/mobile";
import { PushControls } from "@/components/pwa";
import { useAuth } from "@/components/auth-gate";
import { Badge, Button, Card, Loading, Notice } from "@/components/ui";
import { errorText, useLoad } from "@/data/browser";
import type { AiCallLog } from "@/data/types";
import { accessToken } from "@/lib/supabase";

interface SystemStatus {
  cles: { name: string; role: string; present: boolean }[];
  canaux: { plateforme: "whatsapp" | "instagram"; configure: boolean; missing: string[]; webhook: string }[];
  services: { stockage: "supabase" | "memory"; ia: { active: boolean; modele: string }; transcription: { active: boolean; service?: string }; deploiement: string };
  comptes: { id: string; plateforme: string; etat: string; numero: string; role: string; resto: string; testNumeros: number }[];
  evenements: { source: string; cle: string; at: string; erreur?: string }[];
  alertes?: { at: string; canal: string; source: string; prevenu: boolean; voie: string; push?: string; erreur?: string; ouverte: boolean }[];
  push?: { configure: boolean; appareils: number };
  horsListe?: { at: string; fin: string }[];
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
    <AppShell mobile>
      <MobileHeader
        title="État du système"
        action={
          <button type="button" onClick={() => setTick((t) => t + 1)} className="min-h-11 rounded-full bg-white/12 px-4 text-sm font-bold text-white ring-1 ring-white/25 active:bg-white/20">
            Actualiser
          </button>
        }
      />
      <div className="hidden flex-wrap items-end justify-between gap-4 md:flex">
        <div>
          <h1 className="text-2xl font-semibold md:text-3xl">État du système</h1>
          <p className="mt-1 hidden max-w-2xl text-sm text-muted md:block">
            Réservé aux administrateurs. Les clés sont seulement détectées : leur valeur n&apos;est jamais lue ni affichée.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setTick((t) => t + 1)}>
          Actualiser
        </Button>
      </div>

      {server.status === "ready" && <AlertesBanner data={server.data} />}

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


        <MobileAccountCard />
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
                <span className="flex flex-wrap items-center gap-2">
                  <strong>Webhook {NAMES[c.plateforme]}</strong>
                  {c.configure ? <Badge tone="success">actif</Badge> : <Badge>inactif</Badge>}
                  <code className="min-w-0 text-xs break-all text-muted">{c.webhook}</code>
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

      {data.comptes.length > 0 && <CanauxCard comptes={data.comptes} />}
      {data.canaux.some((c) => c.plateforme === "whatsapp" && c.configure) && <WhatsAppAccessCard />}
      {data.canaux.some((c) => c.plateforme === "whatsapp" && c.configure) && <WhatsAppAccountsCard />}
      {data.horsListe && data.horsListe.length > 0 && <HorsListeCard items={data.horsListe} />}
      {data.canaux.some((c) => c.plateforme === "whatsapp" && c.configure) && data.comptes.some((c) => c.plateforme === "whatsapp" && c.etat === "test") && <OrderEventTestCard canaux={data.comptes.filter((c) => c.plateforme === "whatsapp" && c.etat === "test" && c.role === "resto" && c.testNumeros > 0)} />}

      {/* Sur téléphone : juste après le bandeau d'alerte (notification de test, appareils). */}
      <Card title="Notifications push (iPhone, ordinateur)" className="order-first md:order-none lg:col-span-2">
        <p className="mb-2 text-xs text-muted">
          Les alertes partent en notification sur les appareils abonnés (seule voie) ; toucher la notification ouvre la conversation. Sur iPhone : iOS 16.4 ou
          plus, depuis l&apos;app ajoutée à l&apos;écran d&apos;accueil.
        </p>
        <PushControls />
      </Card>

      {data.alertes && <AlertesCard alertes={data.alertes} />}

      <Card title="Clés détectées" className="lg:col-span-2">
        <ul className="grid gap-x-8 gap-y-1 text-sm md:grid-cols-2" data-testid="etat-cles">
          {data.cles.map((k) => (
            <li key={k.name} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <code className="text-xs break-all">{k.name}</code> <span className="text-muted">· {k.role}</span>
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
                <code className="min-w-0 text-xs break-all">{e.cle}</code>
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

/** Voie de l'alerte : push, ou rien. Les anciennes alertes (avant le push seul) gardent leur voie d'origine. */
const VOIES: Record<string, string> = {
  push: "notification push",
  aucune: "NON REÇUE",
  texte: "WhatsApp (ancienne voie)",
  modele: "WhatsApp, modèle (ancienne voie)",
  email: "e-mail (ancienne voie)",
  ancienne: "envoyée (ancienne voie)",
};

/**
 * Bandeau rouge en haut de la page État : alertes non reçues (aucun appareil abonné, push en échec), ou aucune alerte
 * ne peut partir (clés VAPID absentes, aucun appareil). Les conversations concernées restent dans la boîte de réception.
 */
function AlertesBanner({ data }: { data: SystemStatus }) {
  const alertes = data.alertes ?? [];
  const nonRecues = alertes.filter((a) => !a.prevenu);
  const ouvertes = nonRecues.filter((a) => a.ouverte).length;
  const canaux = data.comptes.length > 0;
  const lignes: string[] = [];
  if (nonRecues.length) {
    lignes.push(
      `${nonRecues.length} alerte${nonRecues.length > 1 ? "s" : ""} non reçue${nonRecues.length > 1 ? "s" : ""}${alertes.length > 1 ? ` parmi les ${alertes.length} dernières` : ""}` +
        (ouvertes ? ` : ${ouvertes} client${ouvertes > 1 ? "s attendent" : " attend"} peut-être encore une réponse.` : "."),
    );
  }
  if (canaux && data.push && !data.push.configure) lignes.push("Notifications push non configurées (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY dans Vercel) : aucune alerte ne peut partir.");
  else if (canaux && data.push && data.push.appareils === 0) lignes.push("Aucun appareil abonné aux notifications : aucune alerte ne peut vous joindre. Active-les ci-dessous (encadré « Notifications push »).");
  if (!lignes.length) return null;
  return (
    <div role="alert" data-testid="alertes-bandeau" className="mt-6 rounded-2xl border-2 border-coral bg-coral/10 p-4 text-[#9F1F1F]">
      <p className="text-lg font-bold">🚨 Alertes : personne n&apos;est prévenu</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm font-semibold">
        {lignes.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <a href="/inbox" className="mt-2 inline-flex items-center text-sm font-bold underline max-md:min-h-11">
        Ouvrir la boîte de réception (conversations « 🔔 Attend l&apos;équipe »)
      </a>
    </div>
  );
}
const PUSH: Record<string, { label: string; tone: "success" | "warning" | "neutral" }> = {
  envoyee: { label: "push envoyée", tone: "success" },
  echec: { label: "push en échec", tone: "warning" },
  aucun_abonnement: { label: "aucun appareil abonné", tone: "warning" },
  non_configure: { label: "push non configurée", tone: "warning" },
};

/** Alertes au gérant (« un client attend une réponse ») : par où elles sont parties, et les échecs. */
function AlertesCard({ alertes }: { alertes: NonNullable<SystemStatus["alertes"]> }) {
  const echecs = alertes.filter((a) => !a.prevenu);
  return (
    <Card title="Alertes au gérant (un client attend une réponse)" className="lg:col-span-2">
      <p className="mb-2 text-xs text-muted">
        Une seule voie : la notification push sur les appareils abonnés. Sans appareil ou en cas d&apos;échec, l&apos;alerte reste visible
        dans la boîte de réception (« 🔔 Attend l&apos;équipe ») et le bandeau rouge s&apos;affiche en haut de cette page. Ni WhatsApp, ni e-mail.
      </p>
      {echecs.length > 0 && (
        <div className="mb-2" data-testid="alertes-echecs">
          <Notice tone="error">{echecs.length} alerte(s) non reçue(s) parmi les {alertes.length} dernières : voir la boîte de réception.</Notice>
        </div>
      )}
      {alertes.length === 0 ? (
        <p className="text-sm text-muted">Aucune alerte pour le moment.</p>
      ) : (
        <ul className="divide-y divide-rule text-sm" data-testid="alertes">
          {alertes.map((a) => (
            <li key={a.at + a.canal} className="flex flex-wrap items-baseline gap-2 py-1">
              <span className="text-muted">{time(a.at)}</span>
              <span>{a.canal}</span>
              {a.prevenu ? <Badge tone="success">{VOIES[a.voie] ?? a.voie}</Badge> : <Badge tone="warning">{VOIES.aucune}</Badge>}
              {!a.prevenu && a.push && PUSH[a.push] && <Badge tone={PUSH[a.push].tone}>{PUSH[a.push].label}</Badge>}
              {!a.prevenu && a.ouverte && <span className="text-xs font-semibold text-coral">à traiter dans la boîte de réception</span>}
              {a.erreur && <span className="text-xs text-coral">{a.erreur}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
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

interface AccessResult {
  testeLe: string;
  version: string;
  resultats: { canal: string; etat: string; etapes: { etape: string; ok: boolean; detail: string }[] }[];
}

/** Test de l'accès du token WhatsApp : lectures seules chez Meta, aucun message envoyé. */
function WhatsAppAccessCard() {
  const [result, setResult] = useState<{ status: "idle" } | { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: AccessResult }>({ status: "idle" });
  async function run() {
    setResult({ status: "loading" });
    try {
      const token = await accessToken();
      const response = await fetch("/api/etat/acces-whatsapp", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });
      const body = (await response.json().catch(() => ({}))) as AccessResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Erreur ${response.status}`);
      setResult({ status: "ready", data: body });
    } catch (error) {
      setResult({ status: "error", error: errorText(error) });
    }
  }
  return (
    <Card title="Accès du token WhatsApp" className="lg:col-span-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={run} disabled={result.status === "loading"}>
          {result.status === "loading" ? "Test en cours…" : "Tester l'accès du token"}
        </Button>
        <span className="text-xs text-muted">Lecture seule chez Meta (numéro, compte WhatsApp, apps abonnées) : aucun message envoyé.</span>
      </div>
      {result.status === "error" && (
        <div className="mt-3">
          <Notice tone="error">{result.error}</Notice>
        </div>
      )}
      {result.status === "ready" && (
        <div className="mt-3 space-y-3 text-sm" data-testid="acces-whatsapp">
          {result.data.resultats.length === 0 && <p className="text-muted">Aucun canal WhatsApp enregistré.</p>}
          {result.data.resultats.map((r) => (
            <div key={r.canal}>
              <p className="font-medium">
                {r.canal} <Badge>{r.etat}</Badge>
              </p>
              <ul className="mt-1 space-y-1">
                {r.etapes.map((e) => (
                  <li key={e.etape} className="flex flex-wrap gap-2">
                    {e.ok ? <Badge tone="success">OK</Badge> : <Badge tone="warning">refusé</Badge>}
                    <span className="font-medium">{e.etape}</span>
                    <span className={e.ok ? "text-muted" : "text-coral"}>{e.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-muted">
            Testé le {time(result.data.testeLe)} · API Graph {result.data.version}
          </p>
        </div>
      )}
    </Card>
  );
}

/** Messages ignorés car le canal est en test et l'expéditeur hors de la liste de test : 4 derniers chiffres seulement. */
function HorsListeCard({ items }: { items: NonNullable<SystemStatus["horsListe"]> }) {
  // Regroupés par numéro : combien de messages, et le dernier.
  const byFin = new Map<string, { fin: string; count: number; last: string }>();
  for (const i of items) {
    const g = byFin.get(i.fin) ?? { fin: i.fin, count: 0, last: i.at };
    g.count += 1;
    if (i.at > g.last) g.last = i.at;
    byFin.set(i.fin, g);
  }
  return (
    <Card title="Messages ignorés (canal en test, numéro hors liste)" className="lg:col-span-2">
      <p className="mb-2 text-xs text-muted">
        Ni le message ni le numéro ne sont enregistrés : seulement les 4 derniers chiffres, gardés 30 jours. Pour qu&apos;un testeur ait une réponse
        pendant le test, ajoute son numéro à la liste de test du canal.
      </p>
      <ul className="divide-y divide-rule text-sm" data-testid="hors-liste">
        {[...byFin.values()].map((g) => (
          <li key={g.fin} className="flex flex-wrap items-baseline gap-2 py-1">
            <span className="font-mono font-semibold">…{g.fin}</span>
            <span className="text-muted">
              {g.count} message{g.count > 1 ? "s" : ""} · dernier le {time(g.last)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

interface AccountsResult {
  testeLe: string;
  version: string;
  erreurs: string[];
  comptes: {
    id: string;
    nom?: string;
    origine: string[];
    apps: string[];
    erreurs: string[];
    numeros: { id: string; affichage?: string; nomVerifie?: string; qualite?: string; statut?: string; plateforme?: string; coexistence?: boolean; canal?: { id: string; etat: string } }[];
  }[];
  propositions: { numero: string; resto: string | null; sql: string }[];
}

/** Diagnostic des comptes WhatsApp accessibles au token du serveur : lecture seule chez Meta. */
function WhatsAppAccountsCard() {
  const [result, setResult] = useState<{ status: "idle" } | { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: AccountsResult }>({ status: "idle" });
  const [saisis, setSaisis] = useState("");
  async function run() {
    setResult({ status: "loading" });
    try {
      const token = await accessToken();
      const response = await fetch("/api/etat/comptes-whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ comptes: saisis }),
      });
      const body = (await response.json().catch(() => ({}))) as AccountsResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Erreur ${response.status}`);
      setResult({ status: "ready", data: body });
    } catch (error) {
      setResult({ status: "error", error: errorText(error) });
    }
  }
  return (
    <Card title="Diagnostic des comptes WhatsApp" className="lg:col-span-2">
      <label className="mb-3 block text-sm">
        <span className="font-semibold">Comptes à interroger directement (facultatif)</span>
        <textarea
          className="mt-1 block min-h-20 w-full rounded-[var(--radius-field)] border border-line bg-white px-3 py-2 font-mono text-sm focus:border-pink focus:ring-4 focus:ring-pink/15 focus:outline-none"
          placeholder={"1120744623676139 ag pizza\n1678321033943134 Mexico\n2577158539379673 cookies an nou"}
          value={saisis}
          onChange={(e) => setSaisis(e.target.value)}
          data-testid="comptes-saisis"
        />
        <span className="text-xs text-muted">
          Un compte par ligne : l&apos;ID relevé dans Business Manager, suivi du nom du resto (pour proposer le bon SQL). Utile quand le token ne
          sait pas lister les comptes de l&apos;entreprise.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={run} disabled={result.status === "loading"}>
          {result.status === "loading" ? "Lecture chez Meta…" : "Lancer le diagnostic"}
        </Button>
        <span className="text-xs text-muted">Lecture seule : comptes attribués à pflow-bots-serveur, numéros, apps abonnées. Aucune écriture chez Meta.</span>
      </div>
      {result.status === "error" && (
        <div className="mt-3">
          <Notice tone="error">{result.error}</Notice>
        </div>
      )}
      {result.status === "ready" && (
        <div className="mt-3 space-y-4 text-sm" data-testid="comptes-whatsapp">
          {result.data.erreurs.map((e) => (
            <p key={e} className="text-xs text-coral">
              {e}
            </p>
          ))}
          {result.data.comptes.length === 0 && <p className="text-muted">Aucun compte accessible au token.</p>}
          {result.data.comptes.map((c) => (
            <div key={c.id} className="rounded-2xl border border-rule p-3">
              <p className="font-semibold break-all">
                {c.nom ?? "Compte"} <span className="font-mono text-xs font-normal text-muted">{c.id}</span>
              </p>
              <p className="text-xs text-muted">
                {c.origine.join(", ")} · apps abonnées : {c.apps.length ? c.apps.join(", ") : "aucune"}
              </p>
              {c.erreurs.map((e) => (
                <p key={e} className="text-xs text-coral">
                  {e}
                </p>
              ))}
              {c.numeros.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {c.numeros.map((n) => (
                    <li key={n.id} className="flex flex-wrap items-baseline gap-2">
                      <strong>{n.affichage ?? "?"}</strong>
                      {n.nomVerifie && <span>{n.nomVerifie}</span>}
                      <span className="font-mono text-xs text-muted">phone_number_id {n.id}</span>
                      {n.statut && <Badge tone={n.statut === "CONNECTED" ? "success" : "warning"}>{n.statut}</Badge>}
                      {n.qualite && <Badge>qualité {n.qualite}</Badge>}
                      {n.plateforme && <Badge>{n.plateforme}</Badge>}
                      {n.coexistence !== undefined && <Badge tone={n.coexistence ? "info" : "neutral"}>{n.coexistence ? "coexistence" : "sans appli"}</Badge>}
                      {n.canal ? <Badge tone="success">canal {n.canal.etat}</Badge> : <Badge>pas de canal</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {result.data.propositions.length > 0 && (
            <div>
              <p className="font-semibold">SQL proposé (canaux en test, à vérifier : rien n&apos;est appliqué)</p>
              {result.data.propositions.map((p) => (
                <div key={p.numero} className="mt-2">
                  <p className="text-xs text-muted">
                    {p.numero} → {p.resto ?? "resto à choisir"}
                  </p>
                  <pre className="mt-1 overflow-x-auto rounded-xl bg-page p-3 text-xs">{p.sql}</pre>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted">
            Lu le {time(result.data.testeLe)} · API Graph {result.data.version}
          </p>
        </div>
      )}
    </Card>
  );
}

const TEST_EVENTS = [
  { value: "commande_validee", label: "🧾 Commande validée" },
  { value: "commande_en_preparation", label: "👨‍🍳 En préparation" },
  { value: "commande_prete", label: "✅ Prête" },
  { value: "commande_annulee", label: "❌ Annulée" },
  { value: "commande_remboursee", label: "💸 Remboursée" },
  { value: "annulation_refusee", label: "🚫 Annulation refusée" },
  { value: "rappel_commande_prete", label: "⏰ Rappel : commande prête" },
  { value: "panier_abandonne", label: "🛒 Panier abandonné" },
];

/**
 * Événement de commande simulé (aucune commande créée) : passe par la vraie route signée, vers le canal
 * WhatsApp en test et son numéro de test seulement.
 */
function OrderEventTestCard({ canaux }: { canaux: SystemStatus["comptes"] }) {
  const [canal, setCanal] = useState(canaux[0]?.id ?? "");
  const [event, setEvent] = useState("commande_validee");
  const [mode, setMode] = useState("retrait");
  const [paiement, setPaiement] = useState("sur_place");
  const [result, setResult] = useState<{ status: "idle" } | { status: "loading" } | { status: "error"; error: string } | { status: "ready"; text: string; ok: boolean }>({ status: "idle" });
  async function run() {
    setResult({ status: "loading" });
    try {
      const token = await accessToken();
      const response = await fetch("/api/etat/evenement-test", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ event, mode, paiement, canal }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; canal?: string; destinataire?: string; resultat?: { pris?: boolean; raison?: string; envois?: Record<string, { etat: string; detail: string }> } };
      if (body.error) throw new Error(body.error);
      const r = body.resultat ?? {};
      const envois = Object.entries(r.envois ?? {}).map(([k, v]) => `${k} : ${v.etat} (${v.detail})`).join(" · ");
      setResult({ status: "ready", ok: Boolean(r.pris) && !envois.includes(": echec"), text: r.pris ? `${body.canal} → ${body.destinataire} · ${envois}` : `Pas pris : ${r.raison ?? `erreur ${response.status}`}` });
    } catch (error) {
      setResult({ status: "error", error: errorText(error) });
    }
  }
  return (
    <Card title="Événement de commande de test" className="lg:col-span-2">
      <p className="text-xs text-muted">
        Simulation : aucune commande n&apos;est créée. Le message part du numéro en test vers votre numéro de test seulement, par la même route signée que PFlow Order.
        Votre fenêtre de 24 h doit être ouverte (écrivez « Bonjour » au bot avant).
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {canaux.length > 1 && (
          <select aria-label="Canal" className="rounded-lg border border-line px-2 py-1" value={canal} onChange={(e) => setCanal(e.target.value)}>
            {canaux.map((c) => (
              <option key={c.id} value={c.id}>
                {c.resto} · {c.numero}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Événement" className="rounded-lg border border-line px-2 py-1" value={event} onChange={(e) => setEvent(e.target.value)}>
          {TEST_EVENTS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
        {event !== "panier_abandonne" && (
          <>
            <select aria-label="Mode" className="rounded-lg border border-line px-2 py-1" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="retrait">Retrait</option>
              <option value="livraison">Livraison</option>
            </select>
            <select aria-label="Paiement" className="rounded-lg border border-line px-2 py-1" value={paiement} onChange={(e) => setPaiement(e.target.value)}>
              <option value="sur_place">Sur place</option>
              <option value="en_ligne">En ligne</option>
            </select>
          </>
        )}
        <Button variant="secondary" onClick={run} disabled={result.status === "loading"}>
          {result.status === "loading" ? "Envoi…" : "Envoyer l'événement de test"}
        </Button>
      </div>
      {result.status === "error" && (
        <div className="mt-3">
          <Notice tone="error">{result.error}</Notice>
        </div>
      )}
      {result.status === "ready" && (
        <p className={`mt-3 text-sm ${result.ok ? "" : "text-coral"}`} data-testid="evenement-test">
          {result.ok ? "✅ " : "⚠️ "}
          {result.text}
        </p>
      )}
    </Card>
  );
}

const ETATS: Record<string, { label: string; confirm: string }> = {
  actif: {
    label: "actif",
    confirm:
      "Passer ce canal en ACTIF ?\n\n• Le bot répond à TOUS les clients de ce numéro.\n• PFlow Order envoie à PFlow Bots les événements des VRAIES commandes de ce resto (plus UChat).\n\nAvant : le bot UChat de ce numéro doit être coupé (sinon double réponse).",
  },
  test: { label: "test", confirm: "Repasser ce canal en TEST ?\n\nLe bot ne répond plus qu'aux numéros de test, et les vraies commandes repartent vers UChat (retour arrière)." },
  coupe: { label: "coupé", confirm: "COUPER ce canal ?\n\nLe bot ne répond plus du tout sur ce numéro, et les vraies commandes partent vers UChat." },
};

/** Canaux : état et bascule (test ↔ actif ↔ coupé), avec confirmation. */
function CanauxCard({ comptes }: { comptes: SystemStatus["comptes"] }) {
  const [list, setList] = useState(comptes);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  async function change(id: string, etat: string) {
    if (!window.confirm(ETATS[etat].confirm)) return;
    setError("");
    try {
      const token = await accessToken();
      const response = await fetch("/api/etat/canal", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id, etat }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Erreur ${response.status}`);
      setList((l) => l.map((c) => (c.id === id ? { ...c, etat } : c)));
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function abonnement(id: string, abonner: boolean) {
    const question = abonner
      ? "Abonner l'app PFlow Bots aux messages de ce compte WhatsApp ?\n\nPFlow Bots recevra les messages de ses numéros (en test, il ne répond qu'aux numéros de test). Réversible : « Désabonner »."
      : "Désabonner l'app PFlow Bots de ce compte ?\n\nPFlow Bots ne recevra plus aucun message de ses numéros.";
    if (!window.confirm(question)) return;
    setError("");
    setInfo("");
    try {
      const token = await accessToken();
      const response = await fetch("/api/etat/abonnement", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id, abonner }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean; detail?: string };
      if (body.error) throw new Error(body.error);
      if (!body.ok) throw new Error(body.detail ?? `Erreur ${response.status}`);
      setInfo(`${body.detail} Vérifiez avec « Tester l'accès du token » (ligne « Apps abonnées »).`);
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Card title="Canaux (numéros et comptes)" className="lg:col-span-2">
      <ul className="divide-y divide-rule text-sm" data-testid="canaux">
        {list.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="font-medium">{c.resto}</span>
            <span className="text-muted">
              {NAMES[c.plateforme as "whatsapp" | "instagram"] ?? c.plateforme} · {c.numero}
              {c.etat === "test" ? ` · ${c.testNumeros} numéro(s) de test` : ""}
            </span>
            <Badge tone={c.etat === "actif" ? "success" : c.etat === "test" ? "info" : "warning"}>{ETATS[c.etat]?.label ?? c.etat}</Badge>
            <span className="ml-auto flex flex-wrap gap-1">
              {c.plateforme === "whatsapp" && (
                <>
                  <Button variant="secondary" onClick={() => abonnement(c.id, true)}>
                    Abonner PFlow Bots
                  </Button>
                  <Button variant="secondary" onClick={() => abonnement(c.id, false)}>
                    Désabonner
                  </Button>
                </>
              )}
              {Object.keys(ETATS)
                .filter((e) => e !== c.etat)
                .map((e) => (
                  <Button key={e} variant="secondary" onClick={() => change(c.id, e)}>
                    {e === "actif" ? "Passer en actif" : e === "test" ? "Repasser en test" : "Couper"}
                  </Button>
                ))}
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {info && (
        <div className="mt-3">
          <Notice tone="success">{info}</Notice>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">Un numéro de test Meta (+1 555…) ne passe jamais en actif. Guide de bascule : docs/etape-c/guide-c6-bascule.md.</p>
    </Card>
  );
}

/** Téléphone : le compte connecté et la déconnexion (l'en-tête de l'ordinateur n'est pas affiché). */
function MobileAccountCard() {
  const { email, signOut } = useAuth();
  if (!email) return null;
  return (
    <Card title="Compte" className="md:hidden">
      <p className="text-sm break-all text-muted">{email}</p>
      <Button variant="secondary" className="mt-3 w-full" onClick={() => void signOut()}>
        Déconnexion
      </Button>
    </Card>
  );
}
