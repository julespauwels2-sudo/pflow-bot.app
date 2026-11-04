import Link from "next/link";
import type { ReactNode } from "react";
import { AccountMenu } from "./account-menu";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-navy text-pink">
        <svg viewBox="0 0 64 64" className="size-6" aria-hidden>
          <path d="M18 22a8 8 0 0 1 8-8h14a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8H30l-9 7v-7.5A8 8 0 0 1 18 34Z" fill="currentColor" />
        </svg>
      </span>
      <span className="font-title text-lg font-semibold">
        PFlow <span className="text-pink">Bots</span>
      </span>
    </Link>
  );
}

export function AppShell({ children, breadcrumb }: { children: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-rule bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Logo />
          <nav className="flex items-center gap-1 text-sm font-semibold">
            <Link href="/modele" className="rounded-full px-3 py-1.5 hover:bg-navy/5">
              Modèle maître
            </Link>
            <Link href="/clients" className="rounded-full px-3 py-1.5 hover:bg-navy/5">
              Clients
            </Link>
            <AccountMenu />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {breadcrumb && <div className="mb-4 text-sm text-muted">{breadcrumb}</div>}
        {children}
      </main>
    </div>
  );
}
