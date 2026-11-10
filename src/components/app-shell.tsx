import type { ReactNode } from "react";
import { AccountMenu } from "./account-menu";
import { Logo } from "./logo";
import { MainNav } from "./main-nav";
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
      <header className={`sticky top-0 z-20 border-b-2 border-ink/15 bg-fond ${mobile ? "hidden md:block" : ""}`}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Logo />
          <nav className="flex max-w-full items-center gap-1 overflow-x-auto whitespace-nowrap">
            <MainNav />
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
        {breadcrumb && <div className="mb-4 text-sm font-semibold text-muted">{breadcrumb}</div>}
        {children}
      </main>
      {mobile && <MobileTabBar />}
    </div>
  );
  return mobile ? page : <DesktopOnly>{page}</DesktopOnly>;
}
