"use client";

import { infoSheetVariables, type ContactState, type Flow, type InfoSheet, type Session } from "@/engine";
import { canSendFreeform, WHATSAPP_WINDOW_MS } from "@/engine";
import type { Turn } from "@/simulator/session";
import { nodeLabel } from "@/simulator/explain";

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="text-right font-semibold">{children}</span>
    </div>
  );
}

/** Panneau « État » : contact, session, variables. */
export function StatePanel({
  now,
  timezone,
  contact,
  session,
  flows,
  infoSheet,
  aiLimit,
  sessionTimeout,
  format,
  onProfileName,
  onLiftPause,
  onEndSession,
}: {
  now: Date;
  timezone: string;
  contact: ContactState;
  session: Session | null;
  flows: Flow[];
  infoSheet: InfoSheet;
  aiLimit: number;
  sessionTimeout: number;
  format: (iso: string) => string;
  onProfileName: (name: string) => void;
  onLiftPause: () => void;
  onEndSession: () => void;
}) {
  const pauseActive = contact.pause && (contact.pause.until === null || Date.parse(contact.pause.until) > now.getTime());
  const windowOpen = canSendFreeform(contact, now);
  const windowEnd = contact.lastInboundAt ? new Date(Date.parse(contact.lastInboundAt) + WHATSAPP_WINDOW_MS).toISOString() : null;
  const sessionLive = session && Date.parse(session.expiresAt) > now.getTime();
  const flow = session ? flows.find((f) => f.id === session.flowId) : undefined;
  const waiting = flow?.nodes.find((n) => n.id === session?.nodeId);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  const aiCalls = contact.aiUsage.day === today ? contact.aiUsage.calls : 0;
  const infoVars = infoSheetVariables(infoSheet, now, timezone) as unknown as Record<string, string>;
  const pauseLabel = { echo_gerant: "le gérant a répondu", transfert_humain: "transfert humain", manuel: "manuelle" };

  return (
    <div className="space-y-5" data-testid="state">
      <Section title="Contact">
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span className="text-muted">Prénom (profil WhatsApp)</span>
          <input
            aria-label="Prénom du client"
            className="w-28 rounded-lg border border-line px-2 py-0.5 text-right text-[13px] font-semibold"
            value={contact.profileName ?? ""}
            onChange={(e) => onProfileName(e.target.value)}
          />
        </label>
        <Row label="Bot pour ce contact">
          {pauseActive ? (
            <span className="text-coral">
              En pause ({pauseLabel[contact.pause!.reason]}){contact.pause!.until ? ` jusqu'à ${format(contact.pause!.until)}` : ""}
            </span>
          ) : (
            <span className="text-green-700">Actif</span>
          )}
        </Row>
        {pauseActive && (
          <button type="button" className="w-full rounded-full border border-line py-1 text-xs font-semibold hover:border-navy/30" onClick={onLiftPause}>
            Relancer le bot (lever la pause)
          </button>
        )}
        <Row label="Fenêtre de 24 h">
          {windowOpen ? <span className="text-green-700">Ouverte jusqu&apos;à {format(windowEnd!)}</span> : <span className="text-coral">Fermée</span>}
        </Row>
        <Row label="Appels IA aujourd'hui">
          {aiCalls} / {aiLimit}
        </Row>
      </Section>

      <Section
        title="Conversation (session)"
        actions={
          sessionLive ? (
            <button type="button" className="text-xs font-semibold text-coral hover:underline" onClick={onEndSession}>
              Terminer
            </button>
          ) : null
        }
      >
        {sessionLive ? (
          <>
            <Row label="Flux">{flow?.name ?? session!.flowId}</Row>
            <Row label="Bloc en attente">{nodeLabel(waiting)}</Row>
            <Row label="Expire à">
              {format(session!.expiresAt)} <span className="font-normal text-muted">({sessionTimeout} min d&apos;inactivité)</span>
            </Row>
            {session!.retries > 0 && <Row label="Réponses invalides">{session!.retries}</Row>}
          </>
        ) : (
          <p className="text-[13px] text-muted">{session ? "Expirée (sera fermée au prochain message)." : "Aucune conversation en cours."}</p>
        )}
      </Section>

      <Section title="Variables de la conversation">
        {session && Object.keys(session.vars).length ? (
          <dl className="space-y-1">
            {Object.entries(session.vars).map(([k, v]) => (
              <div key={k} className="text-[12px]">
                <dt className="font-mono font-semibold text-pink">{`{{${k}}}`}</dt>
                <dd className="whitespace-pre-wrap">{v || <span className="text-muted italic">(vide)</span>}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[13px] text-muted">Aucune (réponses aux questions, données des événements…).</p>
        )}
        <details className="text-[12px]">
          <summary className="cursor-pointer font-semibold text-muted">Variables de la fiche d&apos;infos</summary>
          <dl className="mt-1 space-y-1">
            {Object.entries(infoVars).map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono font-semibold text-pink">{`{{${k}}}`}</dt>
                <dd className="whitespace-pre-wrap">{v || <span className="text-muted italic">(vide)</span>}</dd>
              </div>
            ))}
          </dl>
        </details>
      </Section>
    </div>
  );
}

const TONE = { ok: "text-green-700", skip: "text-coral", warn: "text-amber-700", info: "text-muted" } as const;
const ICON = { ok: "✓", skip: "⦸", warn: "⚠", info: "·" } as const;

/** Journal : pourquoi le bot a réagi (ou non), tour par tour. */
export function Journal({ turns, format }: { turns: Turn[]; format: (iso: string) => string }) {
  if (!turns.length) return <p className="text-[13px] text-muted">Le journal explique chaque réaction du bot.</p>;
  return (
    <ol className="space-y-3" data-testid="journal">
      {[...turns].reverse().map((t) => (
        <li key={t.id} className="rounded-xl border border-rule p-2.5">
          <p className="text-[12px] font-semibold">
            <span className="text-muted">{format(t.at)} · </span>
            {t.incoming}
          </p>
          <ul className="mt-1 space-y-0.5 text-[12px]">
            {t.lines.map((l, i) => (
              <li key={i} className={TONE[l.tone]}>
                {ICON[l.tone]} {l.text}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
