"use client";

/**
 * Connexion (étape B) : toutes les pages demandent un compte Supabase présent dans bot_admins.
 * Sans Supabase configuré (développement, étape A), l'app reste ouverte comme avant.
 */
import type { Session } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getSupabase, isBotAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { Button, Loading } from "./ui";

export const LOGIN_PATH = "/connexion";

type AuthState = { status: "loading" } | { status: "signed_out" } | { status: "not_admin"; email: string } | { status: "ok"; email: string } | { status: "error"; message: string };

const AuthContext = createContext<{ email: string | null; signOut: () => Promise<void> }>({ email: null, signOut: async () => {} });
export const useAuth = () => useContext(AuthContext);

async function signOut() {
  await getSupabase()?.auth.signOut();
  // Rechargement complet voulu : on repart sans aucune donnée en mémoire.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = LOGIN_PATH;
}

export function AuthGate({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured) return <>{children}</>;
  return <SupabaseGate>{children}</SupabaseGate>;
}

function SupabaseGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const sb = getSupabase()!;
    let cancelled = false;
    async function check(session: Session | null) {
      if (!session) return !cancelled && setState({ status: "signed_out" });
      try {
        const admin = await isBotAdmin(sb, session.user.id);
        if (cancelled) return;
        const email = session.user.email ?? "";
        setState(admin ? { status: "ok", email } : { status: "not_admin", email });
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      }
    }
    sb.auth.getSession().then(({ data }) => check(data.session));
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") void check(session);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const onLogin = pathname === LOGIN_PATH;
  // « Connecter votre WhatsApp » : page publique du gérant (le lien unique est sa seule clé).
  const publicPage = pathname.startsWith("/connecter/");
  useEffect(() => {
    if (state.status === "signed_out" && !onLogin && !publicPage) router.replace(`${LOGIN_PATH}?suite=${encodeURIComponent(pathname + window.location.search)}`);
  }, [state.status, onLogin, publicPage, pathname, router]);

  if (onLogin || publicPage) return <>{children}</>;
  if (state.status === "loading" || state.status === "signed_out") return <Loading />;
  if (state.status === "error") {
    return (
      <Blocked title="Connexion impossible">
        <p>{state.message}</p>
      </Blocked>
    );
  }
  if (state.status === "not_admin") {
    return (
      <Blocked title="Compte non autorisé">
        <p>
          Le compte <strong>{state.email}</strong> est bien connecté, mais il n&apos;est pas administrateur de PFlow Bots. Pour l&apos;autoriser,
          exécute dans Supabase (SQL Editor) :
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-ink/5 p-3 text-xs">{`insert into public.bot_admins (user_id)\nselect id from auth.users where email = '${state.email}';`}</pre>
      </Blocked>
    );
  }
  return <AuthContext.Provider value={{ email: state.email, signOut }}>{children}</AuthContext.Provider>;
}

function Blocked({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-16 text-sm">
      <h1 className="text-4xl">{title}</h1>
      {children}
      <Button variant="secondary" onClick={signOut}>
        Se déconnecter
      </Button>
    </div>
  );
}
