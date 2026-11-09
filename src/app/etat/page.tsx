"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PushControls } from "@/components/pwa";
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
  alertes?: { at: string; canal: string; source: string; prevenu: boolean; voie?: string; push?: string; erreur?: string }[];
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

      {data.comptes.length > 0 && <CanauxCard comptes={data.comptes} />}
      {data.canaux.some((c) => c.plateforme === "whatsapp" && c.configure) && <WhatsAppAccessCard />}
      {data.canaux.some((c) => c.plateforme === "whatsapp" && c.configure) && data.comptes.some((c) => c.plateforme === "whatsapp" && c.etat === "test") && <OrderEventTestCard canaux={data.comptes.filter((c) => c.plateforme === "whatsapp" && c.etat === "test" && c.role === "resto" && c.testNumeros > 0)} />}

      <Card title="Notifications push (iPhone, ordinateur)" className="lg:col-span-2">
        <p className="mb-2 text-xs text-muted">
          Chaque alerte part aussi en notification sur les appareils abonnés ; toucher la notification ouvre la conversation. Sur iPhone : iOS 16.4 ou
          plus, depuis l&apos;app ajoutée à l&apos;écran d&apos;accueil.
        </p>
        <PushControls />
      </Card>

      {data.alertes && <AlertesCard alertes={data.alertes} />}

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

const VOIES: Record<string, string> = { texte: "WhatsApp (message libre)", modele: "WhatsApp (modèle)", email: "e-mail de secours", aucune: "NON ENVOYÉE" };
const PUSH: Record<string, { label: string; tone: "success" | "warning" | "neutral" }> = {
  envoyee: { label: "push envoyée", tone: "success" },
  echec: { label: "push en échec", tone: "warning" },
  aucun_abonnement: { label: "push : aucun appareil", tone: "neutral" },
  non_configure: { label: "push non configurée", tone: "neutral" },
};

/** Alertes au gérant (« un client attend une réponse ») : par où elles sont parties, et les échecs. */
function AlertesCard({ alertes }: { alertes: NonNullable<SystemStatus["alertes"]> }) {
  const echecs = alertes.filter((a) => !a.prevenu);
  return (
    <Card title="Alertes au gérant (un client attend une réponse)" className="lg:col-span-2">
      <p className="mb-2 text-xs text-muted">
        WhatsApp (message libre si le destinataire a écrit au numéro dans les 24 h, sinon modèle approuvé par Meta) et notification push en
        parallèle ; e-mail de secours seulement si les deux ont échoué.
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
              {a.voie && a.voie !== "aucune" ? <Badge tone="success">{VOIES[a.voie] ?? a.voie}</Badge> : a.prevenu ? null : <Badge>{VOIES.aucune}</Badge>}
              {!a.voie && a.prevenu && <Badge tone="success">envoyée</Badge>}
              {a.push && PUSH[a.push] && <Badge tone={PUSH[a.push].tone}>{PUSH[a.push].label}</Badge>}
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
