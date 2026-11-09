import Link from "next/link";
import type { ReactNode } from "react";
import { AccountMenu } from "./account-menu";
import { Logo } from "./logo";
import { DesktopOnly, MobileTabBar } from "./mobile";

export { Logo };

/**
 * Cadre des pages. `mobile` : la page s'utilise aussi sur téléphone (boîte de réception, État) : en dessous de 768 px,
 * pas d'en-tête mais une barre d'onglets en bas. Sans `mobile` : sur téléphone, « Cette page s'utilise sur
 * ordinateur ». Au-dessus de 768 px, rien ne change.
 */
export function AppShell({ children, breadcrumb, mobile = false }: { children: ReactNode; breadcrumb?: ReactNode; mobile?: boolean }) {
  const page = (
    <div className="min-h-screen">
      <header className={`sticky top-0 z-20 border-b border-white/10 bg-fond/70 backdrop-blur-xl ${mobile ? "hidden md:block" : ""}`}>
        <div className="bg-filet absolute inset-x-0 bottom-0 h-[2px] opacity-70" aria-hidden />
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Logo />
          <nav className="flex max-w-full items-center gap-1 overflow-x-auto text-sm font-semibold whitespace-nowrap">
            <Link href="/modele" className="rounded-full px-3.5 py-2 text-ink/85 transition hover:bg-white/10 hover:text-white">
              Modèle maître
            </Link>
            <Link href="/clients" className="rounded-full px-3.5 py-2 text-ink/85 transition hover:bg-white/10 hover:text-white">
              Clients
            </Link>
            <Link href="/demos" className="rounded-full px-3.5 py-2 text-ink/85 transition hover:bg-white/10 hover:text-white">
              Démos
            </Link>
            <Link href="/inbox" className="rounded-full px-3.5 py-2 text-ink/85 transition hover:bg-white/10 hover:text-white">
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
