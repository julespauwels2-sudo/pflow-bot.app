import Link from "next/link";

/**
 * Logo PFlow Bots, dans l'esprit du logo PFlow Order : le P en verre liquide (icône du site), « flow » en rose, et un
 * badge « BOTS » comme le badge ORDER. `tone="dark"` : sur fond navy.
 */
export function Logo({ tone = "dark", size = "md", href = "/" }: { tone?: "light" | "dark"; size?: "md" | "lg"; href?: string | null }) {
  const big = size === "lg";
  const content = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- image statique du site, déjà à la bonne taille */}
      <img
        src={big ? "/brand/p-pflow-192.png" : "/brand/p-pflow-96.png"}
        alt=""
        width={big ? 56 : 38}
        height={big ? 56 : 38}
        className={`${big ? "size-14 rounded-2xl" : "size-[38px] rounded-xl"} shadow-[0_8px_20px_-6px_rgb(42_139_255/0.55)]`}
      />
      <span className={`font-title font-semibold whitespace-nowrap ${big ? "text-3xl" : "text-xl"} ${tone === "dark" ? "text-white" : "text-navy"}`}>
        P<span className="text-pink">flow</span>
      </span>
      <span
        className={`rounded-full border border-cyan/60 bg-navy font-sans font-extrabold tracking-[0.12em] text-white shadow-[0_0_0_1px_rgb(255_79_181/0.35),0_6px_16px_-6px_rgb(42_139_255/0.7)] ${big ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[10px]"}`}
      >
        BOTS
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
