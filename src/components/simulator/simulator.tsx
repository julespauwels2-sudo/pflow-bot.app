"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CHANNEL_SETTINGS,
  DEFAULT_ORDER_BASE_URL,
  ORDER_EVENTS,
  ORDER_EVENT_TYPES,
  exampleEventData,
  localTime,
  type EngineInput,
  type InfoSheet,
  type OrderEvent,
  type TriggerMode,
} from "@/engine";
import { resolveBot } from "@/data/resolve";
import type { BotClient, StoredFlow } from "@/data/types";
import { ADVANCES, formatLocal, formatShort, zonedToUtc } from "@/simulator/clock";
import { advanceTime, newSimulation, playTurn, withSystemLine, type Bot, type SimState } from "@/simulator/session";
import { Chat } from "./chat";
import { FlowView } from "./flow-view";
import { Journal, StatePanel } from "./panels";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SimulatorProps {
  client: BotClient;
  infoSheet: InfoSheet;
  templateFlows: StoredFlow[];
  clientFlows: StoredFlow[];
  /** Flux à mettre en avant (ouvert depuis l'éditeur). */
  focusFlowId?: string;
  initialDrafts?: boolean;
}

export function Simulator({ client, infoSheet, templateFlows, clientFlows, focusFlowId, initialDrafts = false }: SimulatorProps) {
  const tz = client.timezone;
  const [triggerMode, setTriggerMode] = useState<TriggerMode>(client.triggerMode);
  const [useDrafts, setUseDrafts] = useState(initialDrafts);
  const [realDelays, setRealDelays] = useState(true);
  const [sim, setSim] = useState<SimState>(() => newSimulation(new Date()));
  // Dernier état connu, pour les actions (la ref est mise à jour après chaque rendu).
  const simRef = useRef(sim);
  useEffect(() => {
    simRef.current = sim;
  }, [sim]);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewFlowId, setViewFlowId] = useState<string | undefined>(focusFlowId);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventType, setEventType] = useState<OrderEvent>("commande_validee");
  const [eventData, setEventData] = useState<Record<string, string>>(() => exampleEventData("commande_validee"));
  const now = new Date(sim.now);
  const local = localTime(now, tz);
  const [clockDate, setClockDate] = useState(local.date);
  const [clockTime, setClockTime] = useState(local.hhmm);

  const resolved = useMemo(() => resolveBot({ client, templateFlows, clientFlows, useDrafts }), [client, templateFlows, clientFlows, useDrafts]);
  const bot: Bot = useMemo(
    () => ({
      client: { id: client.id, nomResto: client.nomResto, orderSlug: client.orderSlug, timezone: tz },
      flows: resolved.flows,
      infoSheet,
      triggerMode,
    }),
    [client, tz, resolved.flows, infoSheet, triggerMode],
  );
  const format = (iso: string) => formatShort(new Date(iso), tz, now);
  const orderUrl = `${DEFAULT_ORDER_BASE_URL}${client.orderSlug}`;

  async function send(message: EngineInput["message"], label?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const before = simRef.current;
      const { state: next } = await playTurn(before, bot, message, label);
      const newEntries = next.chat.slice(before.chat.length);
      // Le message entrant tout de suite, puis les réponses du bot une à une (avec « en train d'écrire »).
      let shown = before.chat.length + 1;
      setSim({ ...next, chat: next.chat.slice(0, shown) });
      for (const entry of newEntries.slice(1)) {
        if (entry.from === "bot" && entry.message.kind === "typing") {
          setTyping(true);
          await sleep(realDelays ? entry.message.ms : 300);
          setTyping(false);
        } else {
          await sleep(realDelays ? 250 : 0);
        }
        shown += 1;
        setSim({ ...next, chat: next.chat.slice(0, shown) });
      }
      setSim(next);
      setViewFlowId(undefined);
    } finally {
      setTyping(false);
      setBusy(false);
    }
  }

  function setClock(next: Date) {
    const t = localTime(next, tz);
    setClockDate(t.date);
    setClockTime(t.hhmm);
  }

  function advance(minutes: number) {
    const next = advanceTime(simRef.current, minutes);
    setSim(withSystemLine(next, `⏩ Le temps avance de ${formatMinutes(minutes)}`));
    setClock(new Date(next.now));
  }

  function reset() {
    const fresh = newSimulation(new Date(), simRef.current.contact.profileName);
    setSim(fresh);
    setClock(new Date(fresh.now));
    setViewFlowId(focusFlowId);
  }

  // Flux affiché : choisi à la main, sinon celui de la conversation ou du dernier bloc exécuté.
  const lastTurn = sim.turns.at(-1);
  const lastStep = lastTurn?.steps.at(-1);
  const sessionLive = sim.session && Date.parse(sim.session.expiresAt) > now.getTime();
  const shownFlowId = viewFlowId ?? (sessionLive ? sim.session!.flowId : lastStep?.flowId) ?? focusFlowId ?? resolved.flows[0]?.id;
  const shownFlow = resolved.flows.find((f) => f.id === shownFlowId);
  const activeNodeId = shownFlow
    ? sessionLive && sim.session!.flowId === shownFlow.id
      ? sim.session!.nodeId
      : lastStep?.flowId === shownFlow.id
        ? lastStep.nodeId
        : undefined
    : undefined;
  const trail = new Set((lastTurn?.steps ?? []).filter((s) => s.flowId === shownFlowId).map((s) => s.nodeId));
  const shownEntry = resolved.entries.find((e) => e.botId === shownFlowId);
  const focusFlow = resolved.flows.find((f) => f.id === focusFlowId);

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      {/* Barre du haut */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule bg-white px-3 py-2 sm:px-4">
        <Link href={`/clients/${client.id}`} className="text-sm font-semibold text-muted hover:text-navy">
          ← {client.nomResto}
        </Link>
        <h1 className="font-title text-lg font-semibold">Simulateur</h1>
        <span className="rounded-full bg-page px-2.5 py-0.5 text-xs text-muted">
          {resolved.flows.length} flux actifs{client.template ? " · modèle + flux du client" : ""}
        </span>
        <label className="flex items-center gap-1.5 text-xs font-semibold">
          Le bot répond
          <select aria-label="Mode de déclenchement" className="rounded-lg border border-line px-2 py-1 text-xs" value={triggerMode} onChange={(e) => setTriggerMode(e.target.value as TriggerMode)}>
            <option value="mots_cles_uniquement">aux mots-clés</option>
            <option value="toujours">à tous les messages</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs font-semibold" title="Tester les modifications pas encore publiées">
          <input type="checkbox" className="accent-pink" checked={useDrafts} onChange={(e) => setUseDrafts(e.target.checked)} />
          Brouillons
        </label>
        <label className="flex items-center gap-1.5 text-xs font-semibold">
          <input type="checkbox" className="accent-pink" checked={realDelays} onChange={(e) => setRealDelays(e.target.checked)} />
          Délais réels
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted" data-testid="clock">
            🕒 {formatLocal(now, tz)}
          </span>
          <input type="date" aria-label="Date simulée" className="rounded-lg border border-line px-1.5 py-0.5 text-xs" value={clockDate} onChange={(e) => setClockDate(e.target.value)} />
          <input type="time" aria-label="Heure simulée" className="rounded-lg border border-line px-1.5 py-0.5 text-xs" value={clockTime} onChange={(e) => setClockTime(e.target.value)} />
          <button
            type="button"
            className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold hover:border-navy/30"
            onClick={() => {
              const target = zonedToUtc(clockDate, clockTime, tz);
              if (Number.isNaN(target.getTime())) return;
              setSim(withSystemLine({ ...simRef.current, now: target.toISOString() }, `🕒 Heure réglée : ${formatLocal(target, tz)}`));
            }}
          >
            Régler
          </button>
          {ADVANCES.map((a) => (
            <button
              key={a.label}
              type="button"
              title={a.hint ? `Avancer le temps (${a.hint})` : "Avancer le temps"}
              className="rounded-full bg-navy/5 px-2.5 py-1 text-xs font-semibold hover:bg-navy/10"
              onClick={() => advance(a.minutes)}
            >
              {a.label}
            </button>
          ))}
          <button type="button" className="rounded-full border border-coral/40 px-2.5 py-1 text-xs font-semibold text-coral hover:bg-coral/10" onClick={reset}>
            Réinitialiser
          </button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[380px_1fr_360px]">
        {/* Chat */}
        <div className="flex h-[70dvh] min-h-0 flex-col border-rule lg:h-auto lg:border-r">
          <div className="min-h-0 flex-1">
            <Chat
              entries={sim.chat}
              typing={typing}
              busy={busy}
              formatTime={(iso) => formatShort(new Date(iso), tz, new Date(iso))}
              onText={(text) => send({ kind: "text", text })}
              onReply={(id, title, list) => send(list ? { kind: "list_reply", id, title } : { kind: "button_reply", id, title })}
              empty={
                <div className="mx-auto mt-6 max-w-[90%] rounded-xl bg-white/80 p-3 text-center text-[13px] text-[#54656f]">
                  Écris comme un client (ex. « bonjour », « commander »).{" "}
                  {focusFlow && (
                    <button type="button" className="mt-2 block w-full rounded-lg bg-white py-1.5 font-semibold text-[#027eb5]" onClick={() => send({ kind: "start_flow", flowId: focusFlow.id })}>
                      ▶ Lancer « {focusFlow.name} »
                    </button>
                  )}
                </div>
              }
            />
          </div>
          {/* Autres actions */}
          <div className="space-y-2 border-t border-rule bg-white p-2">
            <div className="flex flex-wrap gap-1.5">
              <button type="button" disabled={busy} className="rounded-full bg-navy/5 px-2.5 py-1 text-xs font-semibold hover:bg-navy/10" onClick={() => send({ kind: "unsupported", mediaType: "audio" })}>
                🎤 Vocal
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-full bg-navy/5 px-2.5 py-1 text-xs font-semibold hover:bg-navy/10"
                onClick={() => {
                  const text = window.prompt("Message du gérant (depuis l'appli WhatsApp Business) :", "Je m'en occupe 👍");
                  if (text !== null) send({ kind: "echo", text });
                }}
              >
                👩‍💼 Le gérant répond
              </button>
              <button type="button" disabled={busy} className="rounded-full bg-navy/5 px-2.5 py-1 text-xs font-semibold hover:bg-navy/10" onClick={() => setEventOpen((o) => !o)}>
                📦 Événement PFlow Order
              </button>
              <select
                aria-label="Lancer un flux"
                className="rounded-full bg-navy/5 px-2 py-1 text-xs font-semibold"
                value=""
                disabled={busy}
                onChange={(e) => e.target.value && send({ kind: "start_flow", flowId: e.target.value })}
              >
                <option value="">▶ Lancer un flux…</option>
                {resolved.flows.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            {eventOpen && (
              <div className="space-y-1.5 rounded-xl border border-rule p-2" data-testid="event-form">
                <select
                  aria-label="Type d'événement"
                  className="w-full rounded-lg border border-line px-2 py-1 text-xs"
                  value={eventType}
                  onChange={(e) => {
                    const t = e.target.value as OrderEvent;
                    setEventType(t);
                    setEventData(exampleEventData(t));
                  }}
                >
                  {ORDER_EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ORDER_EVENTS[t].icon} {ORDER_EVENTS[t].label}
                    </option>
                  ))}
                </select>
                {ORDER_EVENTS[eventType].variables.map((v) => (
                  <label key={v.name} className="block text-[11px]">
                    <span className="font-mono text-pink">{v.name}</span>
                    {v.name.endsWith("recap") ? (
                      <textarea
                        aria-label={v.name}
                        className="block w-full rounded-lg border border-line px-2 py-1 text-xs"
                        rows={2}
                        value={eventData[v.name] ?? ""}
                        onChange={(e) => setEventData({ ...eventData, [v.name]: e.target.value })}
                      />
                    ) : (
                      <input aria-label={v.name} className="block w-full rounded-lg border border-line px-2 py-1 text-xs" value={eventData[v.name] ?? ""} onChange={(e) => setEventData({ ...eventData, [v.name]: e.target.value })} />
                    )}
                  </label>
                ))}
                <button
                  type="button"
                  disabled={busy}
                  className="w-full rounded-full bg-pink py-1.5 text-xs font-semibold text-white"
                  onClick={() => {
                    setEventOpen(false);
                    send({ kind: "event", event: eventType, data: eventData });
                  }}
                >
                  Envoyer l&apos;événement
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Tableau blanc (lecture seule) */}
        <div className="flex h-[60dvh] min-h-0 flex-col bg-page lg:h-auto">
          <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-white px-3 py-2 text-xs">
            <span className="font-semibold">Flux affiché</span>
            <select aria-label="Flux affiché" className="rounded-lg border border-line px-2 py-1 text-xs" value={shownFlowId ?? ""} onChange={(e) => setViewFlowId(e.target.value || undefined)}>
              {resolved.flows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {shownEntry && (
              <Link href={`/flows/${shownEntry.source.id}`} className="font-semibold text-blue hover:underline">
                Ouvrir dans l&apos;éditeur
              </Link>
            )}
            <span className="ml-auto text-muted" data-testid="current-block">
              {activeNodeId ? (sessionLive && sim.session!.flowId === shownFlowId ? "Bloc en attente surligné" : "Dernier bloc exécuté surligné") : "Aucun bloc en cours"}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            {shownFlow ? (
              <FlowView flow={shownFlow} flows={resolved.flows} activeNodeId={activeNodeId} trail={trail} orderUrl={orderUrl} />
            ) : (
              <p className="p-6 text-sm text-muted">Aucun flux actif : publie un flux ou crée le bot depuis le modèle.</p>
            )}
          </div>
        </div>

        {/* État + journal */}
        <aside className="space-y-6 overflow-y-auto border-t border-rule bg-white p-4 lg:border-t-0 lg:border-l">
          <StatePanel
            now={now}
            timezone={tz}
            contact={sim.contact}
            session={sim.session}
            flows={resolved.flows}
            infoSheet={infoSheet}
            aiLimit={DEFAULT_CHANNEL_SETTINGS.aiDailyLimitPerContact}
            sessionTimeout={DEFAULT_CHANNEL_SETTINGS.sessionTimeoutMinutes}
            format={format}
            onProfileName={(profileName) => setSim({ ...simRef.current, contact: { ...simRef.current.contact, profileName } })}
            onLiftPause={() => setSim({ ...simRef.current, contact: { ...simRef.current.contact, pause: null } })}
            onEndSession={() => setSim({ ...simRef.current, session: null })}
          />
          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Journal</h3>
            <Journal turns={sim.turns} format={format} />
          </section>
        </aside>
      </div>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
