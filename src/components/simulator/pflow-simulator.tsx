"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AiPort, EngineInput } from "@/engine";
import { fetchAiStatus, httpAiPort, type AiStatus } from "@/ai/http-port";
import { loadBotFromWorkspace } from "@/channels/core/bot-loader";
import type { WorkspaceData } from "@/data/types";
import { demoDirectory, isDemoActive } from "@/demos/lifecycle";
import { pflowBaseBot, PFLOW_BOT_ID, PFLOW_TEXTS } from "@/demos/pflow-bot";
import { nextContactDemo, routePflowMessage, type ContactDemo } from "@/demos/router";
import { guide, nextParcours } from "@/demos/parcours";
import { accessToken } from "@/lib/supabase";
import { formatShort } from "@/simulator/clock";
import { advanceTime, newSimulation, pendingClientEntry, playTurn, withSystemLine, type Bot, type ChatEntry, type SimState } from "@/simulator/session";
import { Chat } from "./chat";

/** Durée de session du numéro PFlow (inactivité avant le retour au bot PFlow), comme le canal. */
export const PFLOW_SESSION_MINUTES = 30;
const TZ = "America/Guadeloupe";

/**
 * Simulateur du numéro PFlow (partagé par toutes les démos) : même aiguillage que le webhook
 * (mot-clé de démo, démo en cours, bot PFlow de base), avec le temps qui avance pour tester la fin
 * de session et l'expiration des démos.
 */
export function PflowSimulator({ data }: { data: WorkspaceData }) {
  const [sim, setSim] = useState<SimState>(() => newSimulation(new Date(), "Marc"));
  const [current, setCurrent] = useState<ContactDemo | undefined>(undefined);
  const [journal, setJournal] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null | undefined>(undefined);
  const simRef = useRef(sim);
  const currentRef = useRef(current);
  useEffect(() => {
    simRef.current = sim;
    currentRef.current = current;
  }, [sim, current]);
  useEffect(() => {
    let cancelled = false;
    fetchAiStatus().then((status) => !cancelled && setAiStatus(status));
    return () => {
      cancelled = true;
    };
  }, []);

  const demos = useMemo(() => demoDirectory(data), [data]);
  const names = useMemo(() => new Map(data.clients.map((c) => [c.id, c.nomResto])), [data]);
  const aiPort: AiPort | undefined = useMemo(() => (aiStatus?.configured ? httpAiPort("/api/ai", undefined, accessToken) : undefined), [aiStatus]);
  const now = new Date(sim.now);
  const format = (iso: string) => formatShort(new Date(iso), TZ, now);

  async function send(message: EngineInput["message"], label?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const before = simRef.current;
      const at = new Date(before.now);
      const route = routePflowMessage({ message, demos, current: currentRef.current, now: at, sessionMinutes: PFLOW_SESSION_MINUTES });
      const previousBot = currentRef.current?.clientId || PFLOW_BOT_ID;
      let nextDemo = nextContactDemo(currentRef.current, route, at);

      if (route.kind === "ended") {
        const pending = pendingClientEntry(before, message, label);
        const reply: ChatEntry = { id: `fin-${Date.now()}`, from: "bot", message: { kind: "text", text: PFLOW_TEXTS.demoEnded(route.nomResto) }, at: before.now };
        setSim({ ...before, chat: [...before.chat, ...(pending ? [pending] : []), reply] });
        setCurrent(nextDemo);
        setJournal((j) => [...j, `⏳ Mot-clé de la démo terminée « ${route.nomResto} » : message poli, retour au bot PFlow.`]);
        return;
      }

      let loaded = route.kind === "demo" ? loadBotFromWorkspace(data, route.clientId, { demo: true }) : pflowBaseBot();
      if (!loaded) {
        nextDemo = nextContactDemo(nextDemo, { kind: "pflow" }, at);
        loaded = pflowBaseBot();
      }
      const reset = (route.kind === "demo" && route.entered) || previousBot !== loaded.client.id;
      const bot: Bot = {
        client: loaded.client,
        flows: loaded.flows,
        infoSheet: loaded.infoSheet,
        triggerMode: "toujours",
        agent: loaded.agent,
        aiDailyLimit: loaded.aiDailyLimit,
      };
      // Bot PFlow de base : parcours guidé, comme sur WhatsApp (src/demos/parcours.ts).
      const guided = loaded.client.id === PFLOW_BOT_ID;
      const guidance = guided ? guide(message, loaded.flows, nextDemo?.parcours, at) : null;
      const played = guidance ? guidance.message : message;
      // Politesse : sa réponse courte ; question : « Bonne question ! » (le simulateur n'appelle pas l'IA de la démo).
      if (guidance && (guidance.courtesy || guidance.question)) bot.client = { ...bot.client, vars: { ...bot.client.vars, reponse_demo: guidance.courtesy ?? PFLOW_TEXTS.question } };
      const { state: next, result } = await playTurn(reset ? { ...before, session: null } : before, bot, played, label, aiPort ? { ai: aiPort } : {}, message);
      if (guided) {
        const parcours = nextParcours(nextDemo?.parcours, result.events, at);
        if (parcours) nextDemo = { ...(nextDemo ?? { clientId: "", lastAt: at.toISOString(), visited: [] }), parcours };
      }
      // Le simulateur du numéro PFlow affiche les réponses d'un coup (sans « en train d'écrire »).
      setSim({ ...next, chat: next.chat.filter((e) => !(e.from === "bot" && e.message.kind === "typing")) });
      setCurrent(nextDemo);
      const line =
        route.kind === "demo"
          ? route.entered
            ? `🔑 Mot-clé : démo « ${names.get(route.clientId) ?? "?"} » ouverte (conversation remise à zéro).`
            : `↪ Toujours dans la démo « ${names.get(route.clientId) ?? "?"} ».`
          : "🏠 Pas de mot-clé de démo : bot PFlow de base.";
      setJournal((j) => [...j, line]);
    } finally {
      setBusy(false);
    }
  }

  function advance(minutes: number, label: string) {
    setSim((s) => withSystemLine(advanceTime(s, minutes), `⏩ ${label}`));
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex h-[78vh] min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-rule shadow-card" data-testid="pflow-sim">
        <div className="flex items-center justify-between bg-navy-2 px-4 py-2.5 text-sm text-white">
          <span className="font-semibold">📱 Numéro PFlow (démos)</span>
          <span className="text-xs opacity-80">{current?.clientId ? `Démo : ${names.get(current.clientId) ?? "?"}` : "Bot PFlow de base"}</span>
        </div>
        <div className="min-h-0 flex-1">
          <Chat
            entries={sim.chat}
            typing={busy}
            busy={busy}
            formatTime={format}
            onText={(text) => void send({ kind: "text", text })}
            onReply={(id, title, list) => void send(list ? { kind: "list_reply", id, title } : { kind: "button_reply", id, title }, title)}
            empty={<p className="p-4 text-center text-sm text-muted">Écris « bonjour », ou le mot-clé d&apos;une démo (à droite).</p>}
          />
        </div>
      </div>

      <aside className="space-y-4 text-sm">
        <section className="rounded-[var(--radius-card)] border border-ink/10 carte p-4 shadow-card">
          <h2 className="font-semibold">Démos (mots-clés)</h2>
          {demos.length === 0 ? (
            <p className="mt-2 text-muted">
              Aucune démo. <Link href="/demos" className="font-semibold underline">Page Démos</Link>
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5" data-testid="pflow-sim-demos">
              {demos.map((d) => {
                const active = isDemoActive(d, now);
                return (
                  <li key={d.clientId} className="flex items-center justify-between gap-2">
                    <button type="button" className="font-semibold text-bleu underline-offset-2 hover:underline" disabled={busy} onClick={() => void send({ kind: "text", text: d.keyword })}>
                      {d.keyword}
                    </button>
                    <span className={`text-xs ${active ? "text-muted" : "text-alerte"}`}>{active ? `jusqu'au ${format(d.expiresAt)}` : "terminée"}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-[var(--radius-card)] border border-ink/10 carte p-4 shadow-card">
          <h2 className="font-semibold">Le temps</h2>
          <p className="mt-1 text-xs text-muted">Simulé : {format(sim.now)}. Session : {PFLOW_SESSION_MINUTES} min sans message.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" className="rounded-full border border-line px-3 py-1 hover:bg-ink/5" onClick={() => advance(PFLOW_SESSION_MINUTES + 1, `+${PFLOW_SESSION_MINUTES + 1} min (fin de session)`)}>
              +{PFLOW_SESSION_MINUTES + 1} min
            </button>
            <button type="button" className="rounded-full border border-line px-3 py-1 hover:bg-ink/5" onClick={() => advance(24 * 60, "+1 jour")}>
              +1 jour
            </button>
            <button type="button" className="rounded-full border border-line px-3 py-1 hover:bg-ink/5" onClick={() => advance(6 * 24 * 60, "+6 jours (après l'expiration d'une démo de 5 jours)")}>
              +6 jours
            </button>
          </div>
        </section>

        <section className="rounded-[var(--radius-card)] border border-ink/10 carte p-4 shadow-card">
          <h2 className="font-semibold">Aiguillage</h2>
          <ol className="mt-2 space-y-1 text-xs text-muted" data-testid="pflow-sim-journal">
            {journal.length === 0 && <li>Chaque message : mot-clé de démo ? démo en cours ? sinon bot PFlow.</li>}
            {journal.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
          {aiStatus && !aiStatus.configured && <p className="mt-2 text-xs text-muted">IA non configurée : les blocs IA des démos passent la main à l&apos;équipe.</p>}
        </section>
      </aside>
    </div>
  );
}
