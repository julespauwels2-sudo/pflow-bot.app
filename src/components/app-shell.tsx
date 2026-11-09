import Link from "next/link";
import type { ReactNode } from "react";
import { AccountMenu } from "./account-menu";
import { DesktopOnly, MobileTabBar } from "./mobile";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-navy text-pink">
        <svg viewBox="0 0 64 64" className="size-6" aria-hidden>
          <path d="M18 22a8 8 0 0 1 8-8h14a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8H30l-9 7v-7.5A8 8 0 0 1 18 34Z" fill="currentColor" />
        </svg>
      </span>
      <span className="font-title text-lg font-semibold whitespace-nowrap">
        PFlow <span className="text-pink">Bots</span>
      </span>
    </Link>
  );
}

/**
 * Cadre des pages. `mobile` : la page s'utilise aussi sur téléphone (boîte de réception, État) : en dessous de 768 px,
 * pas d'en-tête mais une barre d'onglets en bas. Sans `mobile` : sur téléphone, « Cette page s'utilise sur
 * ordinateur ». Au-dessus de 768 px, rien ne change.
 */
export function AppShell({ children, breadcrumb, mobile = false }: { children: ReactNode; breadcrumb?: ReactNode; mobile?: boolean }) {
  const page = (
    <div className="min-h-screen">
      <header className={`border-b border-rule bg-white/80 backdrop-blur ${mobile ? "hidden md:block" : ""}`}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Logo />
          <nav className="flex max-w-full items-center gap-1 overflow-x-auto text-sm font-semibold whitespace-nowrap">
            <Link href="/modele" className="rounded-full px-3 py-1.5 hover:bg-navy/5">
              Modèle maître
            </Link>
            <Link href="/clients" className="rounded-full px-3 py-1.5 hover:bg-navy/5">
              Clients
            </Link>
            <Link href="/demos" className="rounded-full px-3 py-1.5 hover:bg-navy/5">
              Démos
            </Link>
            <Link href="/inbox" className="rounded-full px-3 py-1.5 hover:bg-navy/5">
              Boîte de réception
            </Link>
            <AccountMenu />
          </nav>
        </div>
      </header>
      <main
        className={
          mobile
            ? "mx-auto max-w-6xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 md:py-8"
            : "mx-auto max-w-6xl px-4 py-8 sm:px-6"
        }
      >
        {breadcrumb && <div className="mb-4 text-sm text-muted">{breadcrumb}</div>}
        {children}
      </main>
      {mobile && <MobileTabBar />}
    </div>
  );
  return mobile ? page : <DesktopOnly>{page}</DesktopOnly>;
}
