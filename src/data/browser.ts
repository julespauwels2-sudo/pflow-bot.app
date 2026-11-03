"use client";

import { useEffect, useState } from "react";
import { createLocalRepositories } from "./local/repositories";
import { createLocalStorageStore } from "./local/store";
import type { Repositories } from "./repositories";

let instance: Repositories | null = null;

/**
 * Repositories utilisés par l'interface. Étape A : localStorage.
 * Étape B : on remplacera uniquement cette fonction par l'implémentation Supabase.
 */
export function getRepositories(): Repositories {
  if (typeof window === "undefined") throw new Error("Les données ne sont disponibles que dans le navigateur");
  instance ??= createLocalRepositories(createLocalStorageStore(window.localStorage));
  return instance;
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
