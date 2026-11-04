"use client";

import { useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { createLocalRepositories } from "./local/repositories";
import { createLocalStorageStore, STORAGE_KEY } from "./local/store";
import type { Repositories } from "./repositories";
import { supabaseDb } from "./supabase/db";
import { createSupabaseStore } from "./supabase/store";
import type { WorkspaceData } from "./types";

let instance: Repositories | null = null;

/** Vrai quand les données viennent de Supabase (clients lus dans le CRM). */
export const isCrmMode = isSupabaseConfigured;

/**
 * Repositories utilisés par l'interface : Supabase si configuré (étape B), sinon le stockage du
 * navigateur (étape A). La logique métier est la même dans les deux cas.
 */
export function getRepositories(): Repositories {
  if (typeof window === "undefined") throw new Error("Les données ne sont disponibles que dans le navigateur");
  if (!instance) {
    const sb = getSupabase();
    if (sb) {
      const store = createSupabaseStore(supabaseDb(sb));
      instance = createLocalRepositories(store, { crmClients: true, lockedFields: (id) => store.lockedFields(id) });
    } else {
      instance = createLocalRepositories(createLocalStorageStore(window.localStorage));
    }
  }
  return instance;
}

/** Données de l'étape A restées dans ce navigateur (pour l'import dans Supabase). */
export function readBrowserWorkspace(): WorkspaceData | null {
  if (typeof window === "undefined" || !window.localStorage.getItem(STORAGE_KEY)) return null;
  const data = createLocalStorageStore(window.localStorage).read();
  return data.clients.length || data.templates.length || data.flows.length ? data : null;
}

export type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

/** Charge des données asynchrones depuis les repositories, avec `reload()`. */
export function useLoad<T>(load: (repos: Repositories) => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => load(getRepositories()))
      .then(
        (data) => !cancelled && setState({ status: "ready", data }),
        (error: unknown) => !cancelled && setState({ status: "error", error: errorText(error) }),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { state, reload: () => setNonce((n) => n + 1) };
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
