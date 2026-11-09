"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Logo } from "@/components/app-shell";
import { Button, Card, Field, Input, Loading, Notice } from "@/components/ui";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

export default function LoginPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LoginForm />
    </Suspense>
  );
}

/** Seules les pages internes sont acceptées comme destination après connexion. */
function safeNext(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") && !value.startsWith("/connexion")) return value;
  // Sur téléphone, la boîte de réception (les autres pages s'utilisent sur ordinateur).
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? "/inbox" : "/clients";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("suite"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSupabase()
      ?.auth.getSession()
      .then(({ data }) => data.session && router.replace(next));
  }, [next, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    const { error: authError } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (authError) {
      setError(authError.message === "Invalid login credentials" ? "E-mail ou mot de passe incorrect." : authError.message);
      return;
    }
    router.replace(next);
  }

  return (
    <div className="bg-navy-grad min-h-dvh">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-7 px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo tone="dark" size="lg" href={null} />
          <p className="text-sm text-white/70">Boîte de réception et alertes des chatbots PFlow</p>
        </div>
        <Card title="Connexion" description="Avec ton compte PFlow (le même que pour le CRM)." className="shadow-bloc rounded-[var(--radius-sheet)]">
        {!isSupabaseConfigured ? (
          <Notice tone="info">Supabase n&apos;est pas configuré : l&apos;app fonctionne avec les données de ce navigateur.</Notice>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="E-mail">
              <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Mot de passe">
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Connexion…" : "Se connecter"}
            </Button>
          </form>
        )}
        </Card>
      </div>
    </div>
  );
}
