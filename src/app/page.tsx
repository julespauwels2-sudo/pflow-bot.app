import Link from "next/link";

type StepState = "fait" | "en_cours" | "a_venir";

const steps: { id: string; title: string; detail: string; state: StepState }[] = [
  { id: "A1–A4", title: "Socle, moteur, éditeur", detail: "Tableau blanc, blocs façon UChat, vérification avant publication", state: "fait" },
  { id: "M1–M3", title: "Modèle maître", detail: "Bulles et boutons, fiche d'infos, dossiers, événements de commande, bots liés", state: "fait" },
  { id: "A5", title: "Simulateur", detail: "Tester le bot dans un chat façon WhatsApp, avec journal et horloge simulée", state: "fait" },
  { id: "A6", title: "Agent IA", detail: "Claude Haiku, consigne, fonctions, base de connaissances, coût suivi", state: "fait" },
  { id: "B", title: "Supabase", detail: "Connexion, tables bot_, CRM lu en lecture seule, import des données, bots créés automatiquement", state: "fait" },
  { id: "C", title: "WhatsApp et Instagram", detail: "Préparé et testé sans Meta : webhooks, boîte de réception, vocaux, état du système. Reste : compte Meta, migration C", state: "en_cours" },
];

const STATE_LABELS: Record<StepState, { label: string; className: string }> = {
  fait: { label: "Fait", className: "bg-wa/15 text-green-700" },
  en_cours: { label: "En cours", className: "bg-pink/10 text-pink" },
  a_venir: { label: "À venir", className: "bg-navy/5 text-muted" },
};

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-navy text-pink shadow-card">
          <svg viewBox="0 0 64 64" className="size-7" aria-hidden>
            <path
              d="M18 22a8 8 0 0 1 8-8h14a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8H30l-9 7v-7.5A8 8 0 0 1 18 34Z"
              fill="currentColor"
            />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-semibold leading-none">
            PFlow <span className="text-pink">Bots</span>
          </h1>
          <p className="mt-1 text-sm text-muted">Chatbots WhatsApp des restos PFlow</p>
        </div>
      </header>

      <section className="mt-10 overflow-hidden rounded-[var(--radius-card)] bg-navy p-8 text-white shadow-pop">
        <p className="text-sm font-semibold tracking-wide text-cyan uppercase">Phase 1 · Étape B</p>
        <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">
          Un bot par resto, <span className="text-pink-2">branché sur le CRM</span>.
        </h2>
        <p className="mt-3 max-w-2xl text-white/75">
          Le modèle maître, l&apos;agent IA et le simulateur sont prêts. Les restos, leurs horaires, zones et cartes sont lus dans le CRM, sans
          jamais le modifier. Prochaine étape : WhatsApp.
        </p>
        <Link
          href="/clients"
          className="mt-6 inline-flex rounded-full bg-pink px-5 py-2.5 text-sm font-semibold text-white hover:bg-pink-2"
        >
          Gérer les clients →
        </Link>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step) => (
          <article
            key={step.id}
            className="rounded-[var(--radius-card)] border border-rule bg-white p-5 shadow-card"
          >
            <div className="flex items-center justify-between">
              <span className="font-title text-sm font-semibold text-blue">{step.id}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_LABELS[step.state].className}`}>{STATE_LABELS[step.state].label}</span>
            </div>
            <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
            <p className="mt-1 text-sm text-muted">{step.detail}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
