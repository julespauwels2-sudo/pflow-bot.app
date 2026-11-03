import Link from "next/link";

const steps = [
  { id: "A1", title: "Socle", detail: "Next.js, Tailwind, DA PFlow, accès protégé", done: true },
  { id: "A2", title: "Moteur", detail: "Exécution des flux, testée unitairement", done: true },
  { id: "A3", title: "Stockage local", detail: "Clients, fiches d'infos, import / export JSON", done: true },
  { id: "A4", title: "Éditeur", detail: "Tableau blanc React Flow, brouillon et publication", done: true },
  { id: "A5", title: "Simulateur", detail: "Tester un flux sans WhatsApp", done: false },
  { id: "A6", title: "IA de secours", detail: "Claude Haiku, fiche d'infos, limites", done: false },
];

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
        <p className="text-sm font-semibold tracking-wide text-cyan uppercase">Phase 1 · Étape A</p>
        <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">
          Construire et tester un flux, <span className="text-pink-2">sans WhatsApp</span>.
        </h2>
        <p className="mt-3 max-w-2xl text-white/75">
          Le moteur tourne déjà : déclencheurs, boutons, listes, questions, conditions au fuseau du resto, lien de
          commande, IA de secours, transfert humain et pause quand le gérant répond lui-même.
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
              <span
                className={
                  step.done
                    ? "rounded-full bg-wa/15 px-2.5 py-0.5 text-xs font-semibold text-green-700"
                    : "rounded-full bg-navy/5 px-2.5 py-0.5 text-xs font-semibold text-muted"
                }
              >
                {step.done ? "Fait" : "À venir"}
              </span>
            </div>
            <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
            <p className="mt-1 text-sm text-muted">{step.detail}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
