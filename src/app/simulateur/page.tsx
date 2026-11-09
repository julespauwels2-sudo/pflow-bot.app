"use client";

import { DesktopOnly } from "@/components/mobile";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Simulator } from "@/components/simulator/simulator";
import { PflowSimulator } from "@/components/simulator/pflow-simulator";
import { Loading, Notice, Select } from "@/components/ui";
import { useLoad } from "@/data/browser";

/**
 * /simulateur?client=<id>[&flux=<id du flux dans le bot>][&brouillons=1][&modele=1]
 * - modele=1 : simule le client comme s'il était lié au modèle maître (test d'un flux du modèle).
 * /simulateur?numero=pflow : le numéro PFlow partagé par les démos (aiguillage par mot-clé).
 */
export default function SimulatorPage() {
  return (
    <DesktopOnly>
      <Suspense fallback={<Loading />}>
        <SimulatorLoader />
      </Suspense>
    </DesktopOnly>
  );
}

function SimulatorLoader() {
  const params = useSearchParams();
  if (params.get("numero") === "pflow") return <PflowNumberLoader />;
  return <ClientSimulatorLoader />;
}

function PflowNumberLoader() {
  const { state } = useLoad(async (repos) => repos.workspace.exportAll(), []);
  if (state.status === "loading") return <Loading />;
  if (state.status === "error") return <Centered><Notice tone="error">{state.error}</Notice></Centered>;
  return <PflowSimulator data={state.data} />;
}

function ClientSimulatorLoader() {
  const params = useSearchParams();
  const router = useRouter();
  const clientId = params.get("client");
  const focus = params.get("flux") ?? undefined;
  const drafts = params.get("brouillons") === "1";
  const forceTemplate = params.get("modele") === "1";

  const { state } = useLoad(
    async (repos) => {
      const clients = await repos.clients.list();
      const client = clientId ? clients.find((c) => c.id === clientId) : undefined;
      if (!client) return { clients, ready: null };
      const templates = await repos.templates.list();
      const templateId = client.template?.templateId ?? (forceTemplate ? templates[0]?.id : undefined);
      const linkedClient = templateId && !client.template ? { ...client, template: { templateId, linkedAt: new Date().toISOString() } } : client;
      const [infoSheet, clientFlows, templateFlows] = await Promise.all([
        repos.infoSheets.get(client.id),
        repos.flows.listByOwner(client.id),
        templateId ? repos.flows.listByOwner(templateId) : Promise.resolve([]),
      ]);
      const template = templates.find((t) => t.id === templateId) ?? null;
      return { clients, ready: { client: linkedClient, infoSheet, clientFlows, templateFlows, template } };
    },
    [clientId, forceTemplate],
  );

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") return <Centered><Notice tone="error">{state.error}</Notice></Centered>;
  const { clients, ready } = state.data;

  if (!ready) {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">Simulateur</h1>
        <Link href="/simulateur?numero=pflow" className="block rounded-2xl border border-line bg-white p-3 text-sm font-semibold hover:bg-page" data-testid="sim-pflow">
          📱 Numéro PFlow (démos) : tester les mots-clés de démo
        </Link>
        {clients.length === 0 ? (
          <Notice tone="info">
            Crée d&apos;abord un client.{" "}
            <Link href="/clients" className="font-semibold underline">
              Clients
            </Link>
          </Notice>
        ) : (
          <label className="mt-4 block text-sm font-semibold">
            Avec les infos de quel client ?
            <Select
              aria-label="Client à simuler"
              className="mt-1"
              value=""
              onChange={(e) => {
                const next = new URLSearchParams(params.toString());
                next.set("client", e.target.value);
                router.replace(`/simulateur?${next.toString()}`);
              }}
            >
              <option value="">— Choisir un client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nomResto}
                </option>
              ))}
            </Select>
          </label>
        )}
      </Centered>
    );
  }

  return (
    <Simulator
      key={`${ready.client.id}-${focus ?? ""}`}
      client={ready.client}
      infoSheet={ready.infoSheet}
      clientFlows={ready.clientFlows}
      templateFlows={ready.templateFlows}
      template={ready.template}
      focusFlowId={focus}
      initialDrafts={drafts}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-xl space-y-4 px-4 py-16">{children}</div>;
}
