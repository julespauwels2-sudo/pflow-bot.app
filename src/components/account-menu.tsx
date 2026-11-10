"use client";

import Link from "next/link";
import { useState } from "react";
import { isCrmMode, readBrowserWorkspace } from "@/data/browser";
import { useAuth } from "./auth-gate";

/** Compte connecté, état du système, déconnexion, et lien d'import tant que des données restent dans le navigateur. */
export function AccountMenu() {
  const { email, role, signOut } = useAuth();
  // Rendu seulement dans le navigateur une fois connecté (la porte de connexion bloque le rendu serveur).
  const [hasLocal] = useState(() => isCrmMode && typeof window !== "undefined" && Boolean(readBrowserWorkspace()));
  if (!email) return null;
  return (
    <span className="ml-2 flex items-center gap-1 border-l-2 border-rule pl-3 text-xs font-extrabold tracking-[0.08em] uppercase">
      {role === "admin" && hasLocal && (
        <Link href="/import" className="rounded-full bg-pink px-3 py-1.5 text-nuit shadow-bouton">
          Importer
        </Link>
      )}
      {role === "admin" && (
      <Link href="/etat" className="rounded-full px-3 py-1.5 hover:bg-white hover:text-nuit" title="État du système">
        État
      </Link>
      )}
      <span className="hidden text-xs font-semibold tracking-normal text-muted normal-case sm:inline" title={email}>
        {email}
      </span>
      <button type="button" className="rounded-full px-3 py-1.5 hover:bg-white hover:text-nuit" onClick={() => void signOut()}>
        Déconnexion
      </button>
    </span>
  );
}
