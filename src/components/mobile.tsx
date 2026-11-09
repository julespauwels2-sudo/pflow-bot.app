"use client";

/**
 * Version mobile (largeur < 768 px, iPhone avec l'app ajoutée à l'écran d'accueil) :
 * - seules la boîte de réception et la page État s'utilisent sur téléphone ; les autres pages affichent « Cette page
 *   s'utilise sur ordinateur » (DesktopOnly) ;
 * - barre d'onglets en bas (MobileTabBar), au-dessus de la barre d'accueil de l'iPhone (zones sûres) ;
 * - useVisualViewport : hauteur visible quand le clavier iOS est ouvert (la zone de réponse reste au-dessus).
 * Sur ordinateur (768 px et plus), rien ne change.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Logo } from "./logo";

/** Même seuil que le préfixe « md: » de Tailwind. */
export const MOBILE_QUERY = "(max-width: 767px)";

function subscribeMobile(onChange: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Vrai sur téléphone (< 768 px). Faux côté serveur. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

/**
 * Hauteur et décalage de la partie visible de l'écran. Sur iPhone, le clavier ne réduit pas la page : seule la
 * « visual viewport » rétrécit. La conversation se cale sur elle pour garder la zone de réponse au-dessus du clavier.
 */
export function useVisualViewport(): { height: number | null; offsetTop: number } {
  const [state, setState] = useState<{ height: number | null; offsetTop: number }>({ height: null, offsetTop: 0 });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setState({ height: vv.height, offsetTop: vv.offsetTop });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return state;
}

/** Sur téléphone : message « page pour ordinateur ». Sur ordinateur : la page, inchangée. */
export function DesktopOnly({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="md:hidden" data-testid="desktop-only">
        <div className="bg-navy-grad flex min-h-dvh flex-col items-center justify-center gap-6 px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-center text-white">
          <Logo tone="dark" size="lg" href={null} />
          <div>
            <p className="font-title text-xl font-semibold">Cette page s&apos;utilise sur ordinateur</p>
            <p className="mt-1 text-base text-white/70">Sur téléphone : la boîte de réception et l&apos;état du système.</p>
          </div>
          <Link href="/inbox" className="bg-brand shadow-bouton inline-flex min-h-11 items-center rounded-full px-6 text-base font-bold text-white">
            Ouvrir la boîte de réception
          </Link>
          <Link href="/etat" className="inline-flex min-h-11 items-center text-base font-semibold text-white/75 underline">
            État du système
          </Link>
        </div>
      </div>
      <div className="hidden md:contents">{children}</div>
    </>
  );
}

const TABS = [
  {
    href: "/inbox",
    label: "Boîte de réception",
    icon: (
      <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-5l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    ),
  },
  {
    href: "/etat",
    label: "État",
    icon: <path d="M4 19V11M10 19V5M16 19v-6M22 19H2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  },
];

/**
 * En-tête des écrans iPhone : bandeau navy aux couleurs du site (logo PFlow Bots, titre), qui passe sous la barre
 * d'état (zones sûres). Téléphone seulement : sur ordinateur, rien ne change.
 */
export function MobileHeader({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div
      className="bg-navy-grad shadow-bloc relative -mx-4 -mt-[max(1rem,env(safe-area-inset-top))] mb-4 rounded-b-[var(--radius-sheet)] px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-5 text-white md:hidden"
      data-testid="mobile-header"
    >
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Logo tone="dark" href={null} />
        {action}
      </div>
      <h1 className="mt-3 font-title text-[1.75rem] leading-tight font-semibold">{title}</h1>
      {children}
    </div>
  );
}

/** Barre d'onglets en bas de l'écran (téléphone seulement), au-dessus de la barre d'accueil de l'iPhone. */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navigation"
      data-testid="mobile-tabs"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-white/90 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgb(16_27_77/0.06)] backdrop-blur-xl md:hidden"
    >
      <ul className="flex px-2">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-bold ${active ? "text-pink-3" : "text-muted"}`}
              >
                <span className={`grid h-8 w-14 place-items-center rounded-full transition ${active ? "bg-pink/12" : ""}`}>
                  <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
                    {tab.icon}
                  </svg>
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
