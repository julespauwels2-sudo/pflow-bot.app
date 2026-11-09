import Link from "next/link";
import { Logo } from "@/components/logo";
import { DesktopOnly } from "@/components/mobile";

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
  fait: { label: "Fait", className: "bg-wa/15 text-emerald-300 ring-1 ring-wa/30" },
  en_cours: { label: "En cours", className: "bg-pink/15 text-pink-2 ring-1 ring-pink/30" },
  a_venir: { label: "À venir", className: "bg-white/10 text-ink/80 ring-1 ring-white/10" },
};

export default function Home() {
  return (
    <DesktopOnly>
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="flex flex-col items-start gap-2">
        <Logo size="lg" href={null} />
        <p className="text-sm text-muted">Chatbots WhatsApp des restos PFlow</p>
      </header>

      <section className="bg-navy-grad mt-10 overflow-hidden rounded-[var(--radius-sheet)] border border-white/10 p-8 text-white shadow-pop sm:p-10">
        <p className="text-sm font-semibold tracking-wide text-cyan uppercase">Phase 1 · Étape B</p>
        <h2 className="mt-2 font-title text-3xl font-bold sm:text-5xl">
          Un bot par resto, <span className="text-pink-2">branché sur le CRM</span>.
        </h2>
        <p className="mt-3 max-w-2xl text-white/75">
          Le modèle maître, l&apos;agent IA et le simulateur sont prêts. Les restos, leurs horaires, zones et cartes sont lus dans le CRM, sans
          jamais le modifier. Prochaine étape : WhatsApp.
        </p>
        <Link
          href="/clients"
          className="bg-brand shadow-bouton mt-7 inline-flex rounded-full px-6 py-3 text-base font-extrabold text-white hover:brightness-105"
        >
          Gérer les clients →
        </Link>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step) => (
          <article
            key={step.id}
            className="rounded-[var(--radius-card)] border border-white/10 bg-verre p-5 shadow-card"
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
    </DesktopOnly>
  );
}
