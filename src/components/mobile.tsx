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
        <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-navy text-pink" aria-hidden>
            <svg viewBox="0 0 64 64" className="size-9">
              <path d="M18 22a8 8 0 0 1 8-8h14a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8H30l-9 7v-7.5A8 8 0 0 1 18 34Z" fill="currentColor" />
            </svg>
          </span>
          <div>
            <p className="font-title text-xl font-semibold">Cette page s&apos;utilise sur ordinateur</p>
            <p className="mt-1 text-base text-muted">Sur téléphone : la boîte de réception et l&apos;état du système.</p>
          </div>
          <Link href="/inbox" className="inline-flex min-h-11 items-center rounded-full bg-pink px-6 text-base font-semibold text-white">
            Ouvrir la boîte de réception
          </Link>
          <Link href="/etat" className="inline-flex min-h-11 items-center text-base font-semibold text-muted underline">
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

/** Barre d'onglets en bas de l'écran (téléphone seulement), au-dessus de la barre d'accueil de l'iPhone. */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navigation"
      data-testid="mobile-tabs"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="flex">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${active ? "text-pink" : "text-muted"}`}
              >
                <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
                  {tab.icon}
                </svg>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
