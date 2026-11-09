import Link from "next/link";

/**
 * Logo PFlow Bots selon la charte : le P bulle (mascotte en verre, seul élément 3D) suivi d'une pill blanche
 * « PFLOW BOTS » (Plus Jakarta 800, majuscules). `tone="light"` : sur fond clair (pill nuit).
 */
export function Logo({ tone = "dark", size = "md", href = "/" }: { tone?: "light" | "dark"; size?: "md" | "lg"; href?: string | null }) {
  const big = size === "lg";
  const content = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- image statique de la charte, déjà à la bonne taille */}
      <img
        src={big ? "/brand/p-bulle-192.png" : "/brand/p-bulle-96.png"}
        alt=""
        width={big ? 64 : 40}
        height={big ? 64 : 40}
        className={big ? "size-16" : "size-10"}
      />
      <span
        className={`rounded-full font-sans font-extrabold tracking-[0.12em] whitespace-nowrap uppercase ${
          tone === "dark" ? "bg-white text-nuit" : "bg-nuit text-white"
        } ${big ? "px-4 py-1.5 text-sm" : "px-3 py-1 text-[11px]"}`}
      >
        PFlow Bots
      </span>
    </>
  );
  const cls = `flex items-center ${big ? "gap-3" : "gap-2"}`;
  return href ? (
    <Link href={href} className={cls} aria-label="PFlow Bots">
      {content}
    </Link>
  ) : (
    <span className={cls} aria-label="PFlow Bots">
      {content}
    </span>
  );
}
