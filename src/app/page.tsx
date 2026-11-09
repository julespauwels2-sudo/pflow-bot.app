import Link from "next/link";
import { Logo } from "@/components/logo";
import { DesktopOnly } from "@/components/mobile";
import { Ticket } from "@/components/ticket";

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
  fait: { label: "Fait", className: "bg-cyan text-nuit" },
  en_cours: { label: "En cours", className: "bg-pink text-nuit" },
  a_venir: { label: "À venir", className: "bg-ink/10 text-ink" },
};

export default function Home() {
  return (
    <DesktopOnly>
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Logo size="lg" href={null} />
          <p className="mt-2 text-sm font-semibold text-muted">Chatbots WhatsApp des restos PFlow</p>
        </div>
        <div className="grille-points h-14 w-28 shrink-0" aria-hidden />
      </header>

      <section className="mt-10 grid items-center gap-10 lg:grid-cols-[1fr_auto]">
        <div>
          <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-extrabold tracking-[0.12em] text-nuit uppercase">Phase 1 · Étape B</span>
          <h2 className="mt-5 text-5xl text-white sm:text-7xl">
            Un bot par resto, <span className="text-rose">branché sur le CRM.</span>
          </h2>
          <p className="mt-5 max-w-2xl text-base font-semibold text-muted">
            Le modèle maître, l&apos;agent IA et le simulateur sont prêts. Les restos, leurs horaires, zones et cartes sont lus dans le CRM, sans
            jamais le modifier. Prochaine étape : WhatsApp.
          </p>
          <Link
            href="/clients"
            className="mt-7 inline-flex rounded-full bg-pink px-7 py-3.5 text-sm font-extrabold tracking-[0.08em] text-nuit uppercase shadow-bouton hover:-translate-y-px"
          >
            Gérer les clients →
          </Link>
        </div>
        <Ticket numero="#128" lignes={["2× Pizza Reine", "1× Tiramisu", "Retrait"]} heure="20 h 15" className="mx-auto hidden lg:block" />
      </section>

      <section className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step) => (
          <article key={step.id} className={`rounded-[var(--radius-card)] p-5 shadow-card ${step.state === "en_cours" ? "aplat-bleu" : "carte"}`}>
            <div className="flex items-center justify-between">
              <span className="font-title text-lg text-bleu">{step.id}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold tracking-[0.04em] uppercase ${STATE_LABELS[step.state].className}`}>
                {STATE_LABELS[step.state].label}
              </span>
            </div>
            <h3 className="mt-2 text-2xl">{step.title}</h3>
            <p className="mt-1 text-sm font-semibold text-muted">{step.detail}</p>
          </article>
        ))}
      </section>
    </main>
    </DesktopOnly>
  );
}
