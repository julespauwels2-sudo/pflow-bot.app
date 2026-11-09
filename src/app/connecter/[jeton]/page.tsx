"use client";

/**
 * « Connecter votre WhatsApp » : la page envoyée au gérant par lien unique (7 jours). Elle ouvre l'Embedded Signup v4
 * de Meta en coexistence (il garde son appli WhatsApp Business sur le même numéro), puis transmet au serveur le code
 * et les identifiants renvoyés par Meta. Pas de compte PFlow à créer : le lien suffit. Dernière étape : sa carte chez
 * Meta (il paie lui-même les messages ; PFlow ne voit jamais sa carte).
 */
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { Button, Card, Loading, Notice } from "@/components/ui";

interface Infos {
  nomResto: string;
  etat: string;
  expireLe: string;
  numeroAffiche: string | null;
  etapes: { etape: string; ok: boolean }[];
  meta: { appId: string; configId: string; version: string } | null;
}

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
}
declare global {
  interface Window {
    FB?: {
      init(o: Record<string, unknown>): void;
      login(cb: (r: FbLoginResponse) => void, o: Record<string, unknown>): void;
    };
    fbAsyncInit?: () => void;
  }
}

const ETAPES: Record<string, string> = {
  code_echange: "Autorisation de PFlow",
  jeton_garde: "Accès gardé en sécurité",
  numero: "Votre numéro",
  app_abonnee: "Réception des messages",
  contacts_demandes: "Vos contacts",
  historique_demande: "Vos conversations",
  canal: "Votre bot (en test)",
  modeles_livraison: "Messages de suivi de livraison",
};

const WHATSAPP_MANAGER = "https://business.facebook.com/wa/manage/home/";

export default function ConnecterPage() {
  const { jeton } = useParams<{ jeton: string }>();
  const [infos, setInfos] = useState<Infos | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sdkPret, setSdkPret] = useState(false);
  const signup = useRef<{ wabaId?: string; phoneNumberId?: string; businessId?: string; evenement?: string }>({});
  const api = `/api/connecter/${encodeURIComponent(jeton)}`;

  const charger = useCallback(async () => {
    const r = await fetch(api, { cache: "no-store" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ?? `Erreur ${r.status}`);
    return body as Infos;
  }, [api]);

  useEffect(() => {
    charger().then(setInfos, (e: Error) => setErreur(e.message));
  }, [charger]);

  // SDK JavaScript de Meta, chargé seulement quand la page est prête à connecter.
  useEffect(() => {
    if (!infos?.meta || infos.etat === "terminee" || infos.etat === "expiree") return;
    const meta = infos.meta;
    window.fbAsyncInit = () => {
      window.FB?.init({ appId: meta.appId, autoLogAppEvents: true, xfbml: false, version: meta.version });
      setSdkPret(true);
    };
    if (window.FB) {
      window.fbAsyncInit();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/fr_FR/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    document.body.appendChild(s);
  }, [infos]);

  // Les messages de la fenêtre de Meta : identifiants à la fin, ou abandon / erreur (notés pour PFlow).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com$/.test(event.origin)) return;
      let d: { type?: string; event?: string; data?: Record<string, string> };
      try {
        d = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (d?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (d.event === "FINISH" || d.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
        signup.current = { wabaId: d.data?.waba_id, phoneNumberId: d.data?.phone_number_id, businessId: d.data?.business_id, evenement: d.event };
      } else if (d.event === "CANCEL") {
        const erreurMeta = d.data?.error_message;
        void fetch(api, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: erreurMeta ? "erreur" : "annule", etape: d.data?.current_step, detail: erreurMeta, sessionId: d.data?.session_id }),
        });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [api]);

  function connecter() {
    if (!window.FB || !infos?.meta) return;
    setErreur(null);
    setBusy(true);
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        // Les identifiants arrivent par message un instant avant ou après : on attend jusqu'à 3 s.
        void (async () => {
          for (let i = 0; i < 30 && !signup.current.phoneNumberId; i++) await new Promise((r) => setTimeout(r, 100));
          const s = signup.current;
          if (!code || !s.phoneNumberId || !s.wabaId) {
            setBusy(false);
            setErreur(code ? "Meta n'a pas transmis votre numéro. Recommencez, ou contactez PFlow." : "Connexion interrompue. Vous pouvez recommencer quand vous voulez.");
            return;
          }
          const r = await fetch(api, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "termine", code, wabaId: s.wabaId, phoneNumberId: s.phoneNumberId, businessId: s.businessId, evenement: s.evenement }),
          });
          const body = await r.json().catch(() => ({}));
          setBusy(false);
          if (!r.ok && !body.etat) setErreur(body.error ?? `Erreur ${r.status}`);
          setInfos((old) => (old ? { ...old, ...body } : old));
        })();
      },
      {
        config_id: infos.meta.configId,
        response_type: "code",
        override_default_response_type: true,
        // Coexistence : le gérant garde son appli WhatsApp Business sur le même numéro.
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding" },
      },
    );
  }

  const termine = infos?.etat === "terminee";
  return (
    <div className="bg-navy-grad min-h-dvh">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col items-center gap-2 text-center text-white">
          <Logo tone="dark" size="lg" href={null} />
          <h1 className="mt-2 font-title text-2xl font-semibold">Connecter votre WhatsApp</h1>
          {infos && <p className="text-white/75">{infos.nomResto}</p>}
        </div>

        {!infos && !erreur && <Loading />}
        {erreur && <Notice tone="error">{erreur}</Notice>}

        {infos && infos.etat === "expiree" && <Notice tone="error">Ce lien a expiré. Demandez un nouveau lien à PFlow.</Notice>}

        {infos && !termine && infos.etat !== "expiree" && (
          <Card title="Avant de commencer (10 minutes)" className="shadow-bloc rounded-[var(--radius-sheet)]">
            <ul className="list-disc space-y-1.5 pl-5 text-sm">
              <li>
                Le téléphone du numéro du restaurant, avec l&apos;<strong>appli WhatsApp Business</strong> à jour, utilisée sur ce numéro depuis au moins
                7 jours.
              </li>
              <li>Votre compte Facebook (celui qui gère la page ou le portefeuille du restaurant).</li>
              <li>
                <strong>Vous gardez votre appli WhatsApp Business</strong> : vos conversations et vos contacts restent, le bot PFlow répond à côté de
                vous.
              </li>
            </ul>
            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm">
              <li>Touchez « Connecter mon WhatsApp » et connectez-vous à Facebook.</li>
              <li>Choisissez (ou créez) le portefeuille de votre restaurant.</li>
              <li>Choisissez « Connecter votre appli WhatsApp Business », puis votre numéro, et confirmez dans l&apos;appli.</li>
              <li>Autorisez PFlow.</li>
              <li>
                <strong>Ajoutez votre carte bancaire chez Meta</strong> (dernière étape, ci-dessous) : Meta vous facture directement les messages envoyés
                par le bot. PFlow ne voit jamais votre carte.
              </li>
            </ol>
            <div className="mt-5">
              {infos.meta ? (
                <Button className="w-full" disabled={!sdkPret || busy} onClick={connecter} data-testid="connecter">
                  {busy ? "Connexion en cours…" : sdkPret ? "Connecter mon WhatsApp" : "Chargement…"}
                </Button>
              ) : (
                <Notice tone="info">La connexion n&apos;est pas encore ouverte. PFlow vous prévient dès qu&apos;elle l&apos;est.</Notice>
              )}
            </div>
          </Card>
        )}

        {infos && infos.etapes.length > 0 && (
          <Card title={termine ? "C'est connecté ✅" : "Où en est la connexion"} className="shadow-bloc rounded-[var(--radius-sheet)]">
            {termine && infos.numeroAffiche && (
              <p className="mb-3 text-sm">
                Numéro : <strong>{infos.numeroAffiche}</strong>. Votre bot est en <strong>test</strong> : PFlow le vérifie avec vous avant de
                l&apos;ouvrir à vos clients.
              </p>
            )}
            <ul className="space-y-1 text-sm" data-testid="connexion-etapes">
              {infos.etapes
                .filter((e) => ETAPES[e.etape])
                .map((e) => (
                  <li key={e.etape}>
                    {e.ok ? "✅" : "⚠️"} {ETAPES[e.etape]}
                    {!e.ok && " : PFlow s'en occupe"}
                  </li>
                ))}
            </ul>
          </Card>
        )}

        {termine && (
          <Card title="Dernière étape : votre carte chez Meta" className="shadow-bloc rounded-[var(--radius-sheet)]">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>Ouvrez WhatsApp Manager (bouton ci-dessous), avec le même compte Facebook.</li>
              <li>Paramètres → Moyens de paiement → Ajouter une carte.</li>
              <li>C&apos;est tout. Meta prélève seulement les messages envoyés par le bot (les messages de vos clients sont gratuits).</li>
            </ol>
            <a href={WHATSAPP_MANAGER} target="_blank" rel="noreferrer" className="bg-brand shadow-bouton mt-4 flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-bold text-white">
              Ouvrir WhatsApp Manager
            </a>
            <p className="mt-3 text-xs text-muted">Pensez à ouvrir l&apos;appli WhatsApp Business au moins une fois toutes les 2 semaines : sinon Meta coupe le bot.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
