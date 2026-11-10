"use client";

import Link from "next/link";
import { useAuth } from "./auth-gate";

const lien = "rounded-full px-3.5 py-2 text-xs font-extrabold tracking-[0.08em] text-ink uppercase transition hover:bg-white hover:text-nuit";

/** Navigation principale. Un examinateur (examen Meta) ne voit que la boîte de réception. */
export function MainNav() {
  const { role } = useAuth();
  return (
    <>
      {role === "admin" && (
        <>
          <Link href="/modele" className={lien}>
            Modèle maître
          </Link>
          <Link href="/clients" className={lien}>
            Clients
          </Link>
          <Link href="/demos" className={lien}>
            Démos
          </Link>
        </>
      )}
      <Link href="/inbox" className={lien}>
        Boîte de réception
      </Link>
    </>
  );
}
