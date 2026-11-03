"use client";

import { useSyncExternalStore } from "react";
import { localClock } from "@/lib/timezones";

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 10_000);
  return () => clearInterval(id);
}

/** Minute courante (valeur stable entre deux rendus), null côté serveur. */
function useCurrentMinute(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
}

/** « mardi 12:03 » à l'heure du fuseau, rendu uniquement dans le navigateur. */
export function LocalClock({ timezone }: { timezone: string }) {
  const minute = useCurrentMinute();
  if (minute === null) return <span>…</span>;
  return <span>{localClock(timezone, new Date(minute * 60_000))}</span>;
}
