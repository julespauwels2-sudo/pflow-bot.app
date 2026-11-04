"use client";

import Link from "next/link";
import { useState } from "react";
import { buildKnowledgeBase, missingKnowledge } from "@/ai/knowledge";
import { formatUsd, modelLabel } from "@/ai/models";
import { agentConfigFor } from "@/data/agent";
import { getRepositories, errorText } from "@/data/browser";
import { resolveBot, type BotInput } from "@/data/resolve";
import type { AiCallLog, BotTemplate } from "@/data/types";
import { DEFAULT_ORDER_BASE_URL, infoSheetVariables, renderTemplate, withUpcomingRounds, type InfoSheet } from "@/engine";
import { Button, Card, Notice } from "./ui";

/** « Ce que l'IA sait de ce resto » : la base de connaissances telle que l'IA la reçoit, et ses fonctions. */
export function AiKnowledgeCard({ input, template, infoSheet }: { input: BotInput; template: BotTemplate | null; infoSheet: InfoSheet }) {
  const { client } = input;
  const now = new Date();
  const lienCommande = client.orderSlug ? `${DEFAULT_ORDER_BASE_URL}${client.orderSlug}` : "";
  const knowledge = buildKnowledgeBase({ nomResto: client.nomResto, infoSheet: withUpcomingRounds(infoSheet, now, client.timezone), lienCommande });
  const missing = missingKnowledge(infoSheet);
  const { entries, flows } = resolveBot(input);
  const linkedTemplate = client.template ? template : null;
  const agent = agentConfigFor(linkedTemplate, flows);
  const allFunctions = linkedTemplate?.agent?.functions ?? [];
  const inactive = allFunctions.filter((f) => !agent?.functions.some((a) => a.name === f.name));
  const consigne = agent?.consigne
    ? renderTemplate(agent.consigne, { ...infoSheetVariables(infoSheet, now, client.timezone), nom_resto: client.nomResto, lien_commande: lienCommande, prenom: "" })
    : "";

  return (
    <Card title="Ce que l'IA sait de ce resto" description="Exactement ce que reçoit l'IA pour ce client, en plus des règles PFlow. Tout vient de la fiche d'infos ci-dessous.">
      <div className="space-y-4" data-testid="ai-knowledge">
        {!client.template && (
          <Notice tone="info">Bot non lié au modèle maître : l&apos;IA n&apos;a ni consigne ni fonctions, seulement les règles PFlow et cette base.</Notice>
        )}
        {missing.length > 0 && (
          <Notice tone="error">À compléter dans la fiche d&apos;infos pour que l&apos;IA réponde bien : {missing.join(", ")}.</Notice>
        )}
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <pre className="max-h-96 min-w-0 overflow-auto rounded-xl bg-page p-3 text-xs leading-relaxed whitespace-pre-wrap">{knowledge}</pre>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-semibold">Fonctions disponibles</p>
              {agent?.functions.length ? (
                <ul className="mt-1 space-y-1.5">
                  {agent.functions.map((f) => (
                    <li key={f.name}>
                      <span className="font-mono text-xs font-semibold text-pink">{f.name}</span>
                      <span className="text-xs text-muted"> → « {entries.find((e) => e.botId === f.flowId)?.name ?? f.flowId} »</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">Aucune : l&apos;IA peut seulement répondre ou passer la main.</p>
              )}
              {inactive.length > 0 && (
                <p className="mt-1 text-[11px] text-muted">Inactives pour ce client (flux non publié ou désactivé) : {inactive.map((f) => f.name).join(", ")}.</p>
              )}
            </div>
            {consigne && (
              <details>
                <summary className="cursor-pointer text-xs font-semibold">Consigne de l&apos;agent, pour ce resto</summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-page p-2 text-[11px] whitespace-pre-wrap">{consigne}</pre>
              </details>
            )}
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <Link href="/modele/agent" className="text-blue hover:underline">
                Agent IA du modèle
              </Link>
              <Link href={`/simulateur?client=${client.id}`} className="text-blue hover:underline">
                Tester l&apos;IA dans le simulateur
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

const ACTION_LABELS = { repondre: "Réponse", fonction: "Fonction", transfert_humain: "Transfert" } as const;

/** Journal des appels IA du client, avec les tokens et le coût. */
export function AiCallsCard({ clientId, calls, onChange }: { clientId: string; calls: AiCallLog[]; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const month = new Date().toISOString().slice(0, 7);
  const sum = (list: AiCallLog[]) => list.reduce((total, c) => total + (c.costUsd ?? 0), 0);
  const thisMonth = calls.filter((c) => c.at.startsWith(month));
  const errors = calls.filter((c) => c.error).length;

  return (
    <Card title="Appels IA et coût" description="Chaque appel à Claude, depuis le simulateur (et depuis WhatsApp à l'étape C). Coût estimé d'après le tarif du modèle, en dollars.">
      <div className="space-y-3" data-testid="ai-calls">
        <div className="flex flex-wrap gap-3 text-sm">
          <Stat label="Ce mois-ci" value={`${thisMonth.length} appel${thisMonth.length > 1 ? "s" : ""} · ${formatUsd(sum(thisMonth))}`} />
          <Stat label="Au total" value={`${calls.length} appel${calls.length > 1 ? "s" : ""} · ${formatUsd(sum(calls))}`} />
          {calls.length > 0 && <Stat label="Coût moyen" value={formatUsd(sum(calls) / Math.max(1, calls.length - errors))} />}
          {errors > 0 && <Stat label="Erreurs" value={String(errors)} />}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {calls.length === 0 ? (
          <p className="text-sm text-muted">Aucun appel pour l&apos;instant. Teste l&apos;IA dans le simulateur (option « IA réelle »).</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-semibold">Date</th>
                    <th className="py-1 pr-3 font-semibold">Message</th>
                    <th className="py-1 pr-3 font-semibold">Décision</th>
                    <th className="py-1 pr-3 font-semibold">Tokens (lus / écrits)</th>
                    <th className="py-1 font-semibold">Coût</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.slice(0, 30).map((c) => (
                    <tr key={c.id} className="border-t border-rule align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap text-muted">
                        {new Date(c.at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        <span className="block">{c.source === "simulateur" ? "simulateur" : "WhatsApp"}</span>
                      </td>
                      <td className="max-w-56 py-1.5 pr-3">{c.message}</td>
                      <td className="max-w-72 py-1.5 pr-3">
                        {c.error ? (
                          <span className="font-semibold text-coral">Erreur : {c.error}</span>
                        ) : c.decision ? (
                          <>
                            <span className="font-semibold">{ACTION_LABELS[c.decision.action]}</span>
                            {c.decision.fonction && <span className="font-mono"> {c.decision.fonction}</span>}
                            {c.decision.texte && <span className="block text-muted">{c.decision.texte.slice(0, 160)}</span>}
                          </>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {c.usage
                          ? `${(c.usage.inputTokens + (c.usage.cacheReadTokens ?? 0) + (c.usage.cacheWriteTokens ?? 0)).toLocaleString("fr-FR")} / ${c.usage.outputTokens.toLocaleString("fr-FR")}`
                          : "—"}
                        {c.usage?.cacheReadTokens ? <span className="block text-muted">dont {c.usage.cacheReadTokens.toLocaleString("fr-FR")} en cache</span> : null}
                        {c.model && <span className="block text-muted">{modelLabel(c.model)}</span>}
                      </td>
                      <td className="py-1.5 whitespace-nowrap">{c.error ? "—" : formatUsd(c.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {calls.length > 30 && <p className="text-[11px] text-muted">30 derniers appels affichés sur {calls.length}.</p>}
            <Button
              variant="ghost"
              onClick={async () => {
                if (!window.confirm("Effacer le journal des appels IA de ce client ?")) return;
                try {
                  await getRepositories().aiCalls.clearByClient(clientId);
                  onChange();
                } catch (err) {
                  setError(errorText(err));
                }
              }}
            >
              Effacer le journal
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-page px-3 py-2">
      <span className="block text-[11px] text-muted">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
