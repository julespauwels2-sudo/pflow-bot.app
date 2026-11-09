"use client";

/**
 * Page État : « Connecter le WhatsApp d'un resto » (Embedded Signup v4, coexistence). Jules génère un lien unique
 * (7 jours) pour un resto du CRM et l'envoie au gérant ; la carte liste les connexions en cours et terminées, avec
 * le déroulé et les erreurs.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Loading, Notice, Select } from "@/components/ui";
import { errorText } from "@/data/browser";
import { accessToken } from "@/lib/supabase";

interface Ligne {
  id: string;
  nomResto: string;
  etat: "lien_envoye" | "en_cours" | "terminee" | "erreur" | "annulee" | "expiree" | "debranchee";
  clientTest?: boolean;
  expireLe: string;
  creeLe: string;
  termineLe: string | null;
  numeroAffiche: string | null;
  wabaId: string | null;
  canalId: string | null;
  etapes: { etape: string; ok: boolean; detail?: string; le: string }[];
  erreur: string | null;
}
interface Donnees {
  manque: string[];
  tableAbsente: boolean;
  connexions: Ligne[];
  restos: { id: string; nom: string }[];
}

const ETATS: Record<Ligne["etat"], { texte: string; ton: "neutral" | "success" | "warning" | "info" }> = {
  debranchee: { texte: "Débranché", ton: "neutral" },
  lien_envoye: { texte: "Lien envoyé", ton: "info" },
  en_cours: { texte: "En cours", ton: "info" },
  terminee: { texte: "Connecté (canal en test)", ton: "success" },
  erreur: { texte: "Erreur", ton: "warning" },
  annulee: { texte: "Abandonné par le gérant", ton: "warning" },
  expiree: { texte: "Lien expiré", ton: "neutral" },
};

const date = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function ConnexionsWhatsAppCard() {
  const [data, setData] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resto, setResto] = useState("");
  const [nomTest, setNomTest] = useState("");
  const [lien, setLien] = useState<{ url: string; nomResto: string; expireLe: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const appel = useCallback(async (init?: RequestInit) => {
    const token = await accessToken();
    const r = await fetch("/api/connexions-whatsapp", { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ?? `Erreur ${r.status}`);
    return body;
  }, []);

  const charger = useCallback(() => {
    appel().then(
      (d: Donnees) => {
        setData(d);
        setResto((r) => r || d.restos[0]?.id || "");
      },
      (e) => setErreur(errorText(e)),
    );
  }, [appel]);

  useEffect(() => {
    let annule = false;
    appel().then(
      (d: Donnees) => {
        if (annule) return;
        setData(d);
        setResto((r) => r || d.restos[0]?.id || "");
      },
      (e) => !annule && setErreur(errorText(e)),
    );
    return () => {
      annule = true;
    };
  }, [appel]);

  async function debrancher(c: Ligne) {
    if (!window.confirm(`Débrancher ${c.nomResto}${c.numeroAffiche ? ` (${c.numeroAffiche})` : ""} ? L'app PFlow Bots est désabonnée de son compte, le canal est coupé (le bot ne répond plus) et son jeton est effacé. Le gérant garde son appli et son numéro.`)) return;
    setBusy(true);
    setErreur(null);
    try {
      await appel({ method: "POST", body: JSON.stringify({ action: "debrancher", id: c.id }) });
      charger();
    } catch (e) {
      setErreur(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function generer(test = false) {
    setBusy(true);
    setErreur(null);
    try {
      setLien(await appel({ method: "POST", body: JSON.stringify(test ? { clientTest: { nom: nomTest } } : { restaurantId: resto }) }));
      charger();
    } catch (e) {
      setErreur(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Connecter le WhatsApp d'un resto (Embedded Signup)"
      description="Le gérant garde son appli WhatsApp Business (coexistence). Il reçoit un lien unique valable 7 jours ; à la fin, son canal est créé en test et les 10 modèles de la livraison sont demandés à Meta. Il paie Meta avec sa propre carte."
      className="lg:col-span-2"
    >
      <div className="space-y-3" data-testid="connexions-whatsapp">
        {erreur && (
          <Notice tone="error" onClose={() => setErreur(null)}>
            {erreur}
          </Notice>
        )}
        {!data && !erreur && <Loading />}
        {data && data.manque.length > 0 && (
          <Notice tone="info">
            Pas encore prêt : variables Vercel manquantes <code>{data.manque.join(", ")}</code> (voir docs/etape-c/embedded-signup.md).
          </Notice>
        )}
        {data?.tableAbsente && <Notice tone="info">Migration 20261111000000_bot_connexions_whatsapp à jouer (SQL à valider).</Notice>}
        {data && data.restos.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Resto" value={resto} onChange={(e) => setResto(e.target.value)} className="max-w-xs">
              {data.restos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nom}
                </option>
              ))}
            </Select>
            <Button onClick={() => void generer()} disabled={!resto || busy || data.tableAbsente} data-testid="connexion-generer">
              {busy ? "Création…" : "Créer le lien"}
            </Button>
          </div>
        )}
        {data && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Nom du client test"
              placeholder="Client test hors CRM (ex. Cedyan Energy)"
              value={nomTest}
              onChange={(e) => setNomTest(e.target.value)}
              className="w-full max-w-xs rounded-[var(--radius-field)] border-2 border-nuit/15 bg-white px-3 py-2 text-sm text-nuit focus:border-blue focus:ring-4 focus:ring-blue/25 focus:outline-none"
              data-testid="connexion-test-nom"
            />
            <Button variant="secondary" onClick={() => void generer(true)} disabled={nomTest.trim().length < 2 || busy || data.tableAbsente} data-testid="connexion-test">
              Lien pour un client test
            </Button>
            <span className="text-xs text-muted">Relié à aucun resto ; son canal reste en test, seul ton numéro reçoit des réponses.</span>
          </div>
        )}
        {lien && (
          <Notice tone="success" onClose={() => setLien(null)}>
            Lien pour <strong>{lien.nomResto}</strong> (valable jusqu&apos;au {date(lien.expireLe)}, montré une seule fois) :
            <br />
            <code className="break-all" data-testid="connexion-lien">
              {lien.url}
            </code>
            <br />
            <button type="button" className="mt-1 text-sm font-semibold text-rose underline" onClick={() => void navigator.clipboard?.writeText(lien.url)}>
              Copier le lien
            </button>
          </Notice>
        )}
        {data && data.connexions.length === 0 && !data.tableAbsente && <p className="text-sm text-muted">Aucune connexion pour l&apos;instant.</p>}
        {data && data.connexions.length > 0 && (
          <ul className="divide-y divide-rule text-sm">
            {data.connexions.map((c) => (
              <li key={c.id} className="space-y-1 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{c.nomResto}</strong>
                  <Badge tone={ETATS[c.etat].ton}>{ETATS[c.etat].texte}</Badge>
                  {c.clientTest && <Badge tone="info">Client test</Badge>}
                  {c.numeroAffiche && <span className="text-muted">{c.numeroAffiche}</span>}
                  <span className="text-xs text-muted">
                    créé le {date(c.creeLe)}
                    {c.termineLe ? ` · terminé le ${date(c.termineLe)}` : ` · expire le ${date(c.expireLe)}`}
                  </span>
                </div>
                {c.erreur && <p className="text-xs text-alerte">{c.erreur}</p>}
                {c.etat === "terminee" && (
                  <button type="button" className="text-xs font-semibold text-muted underline hover:text-alerte" disabled={busy} onClick={() => void debrancher(c)}>
                    Débrancher ce numéro
                  </button>
                )}
                {c.etapes.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted">Déroulé ({c.etapes.length} étapes)</summary>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {c.etapes.map((e, i) => (
                        <li key={i}>
                          {e.ok ? "✅" : "⚠️"} {e.etape}
                          {e.detail ? ` : ${e.detail}` : ""} <span className="text-muted">({date(e.le)})</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

interface CompteModeles {
  canalId: string;
  libelle: string;
  compteId: string | null;
  jeton: "client" | "general";
  etat?: { name: string; status: string | null; motif?: string }[];
  crees?: string[];
  echecs?: { name: string; erreur: string }[];
  error?: string;
}

const STATUTS: Record<string, { texte: string; ton: "neutral" | "success" | "warning" | "info" }> = {
  APPROVED: { texte: "Approuvé", ton: "success" },
  PENDING: { texte: "En examen", ton: "info" },
  IN_APPEAL: { texte: "En appel", ton: "info" },
  REJECTED: { texte: "Refusé", ton: "warning" },
  PAUSED: { texte: "En pause", ton: "warning" },
  DISABLED: { texte: "Désactivé", ton: "warning" },
};

/**
 * Page État : les 10 modèles WhatsApp de la livraison, COMPTE PAR COMPTE (chaque resto a son compte WhatsApp ; un
 * modèle appartient à un compte). Statut chez Meta, et création des manquants (soumis à l'examen), jamais de
 * modification.
 */
export function ModelesLivraisonCard() {
  const [comptes, setComptes] = useState<CompteModeles[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function appel(init?: RequestInit) {
    const token = await accessToken();
    const r = await fetch("/api/etat/modeles-livraison", { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    const body = (await r.json().catch(() => ({}))) as { comptes?: CompteModeles[]; error?: string };
    if (!r.ok) throw new Error(body.error ?? `Erreur ${r.status}`);
    return body.comptes ?? [];
  }

  async function lancer(init?: RequestInit, confirmer?: string) {
    if (confirmer && !window.confirm(confirmer)) return;
    setBusy(true);
    setErreur(null);
    try {
      const recus = await appel(init);
      setComptes((old) => (init && old ? old.map((c) => recus.find((r) => r.canalId === c.canalId) ?? c) : recus));
    } catch (e) {
      setErreur(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const manquants = (c: CompteModeles) => c.etat?.filter((t) => !t.status).length ?? 0;
  const total = comptes?.reduce((n, c) => n + manquants(c), 0) ?? 0;
  return (
    <Card
      title="Modèles WhatsApp de la livraison (par compte)"
      description="Chaque numéro de resto a son compte WhatsApp, et un modèle appartient à un compte : il faut les 10 modèles sur le compte de chaque resto. Hors fenêtre de 24 h, la livraison ne peut prévenir le client qu'avec un modèle approuvé."
      className="lg:col-span-2"
    >
      <div className="space-y-3" data-testid="modeles-livraison">
        {erreur && (
          <Notice tone="error" onClose={() => setErreur(null)}>
            {erreur}
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void lancer()} disabled={busy}>
            {busy ? "Lecture chez Meta…" : comptes ? "Actualiser" : "Voir les modèles de chaque compte"}
          </Button>
          {comptes && total > 0 && (
            <Button
              onClick={() => void lancer({ method: "POST", body: JSON.stringify({ tous: true }) }, `Créer les ${total} modèles manquants sur tous les comptes et les soumettre à Meta ?`)}
              disabled={busy}
              data-testid="modeles-creer-tous"
            >
              Créer les {total} manquants sur tous les comptes
            </Button>
          )}
        </div>
        {comptes && comptes.length === 0 && <p className="text-sm text-muted">Aucun canal de resto pour l&apos;instant.</p>}
        {comptes?.map((c) => (
          <div key={c.canalId} className="rounded-2xl border border-rule p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <strong>{c.libelle}</strong>
              {c.compteId && <span className="font-mono text-xs text-muted">compte {c.compteId}</span>}
              <span className="text-xs text-muted">jeton {c.jeton === "client" ? "du client" : "général"}</span>
              {manquants(c) > 0 && (
                <Button
                  variant="secondary"
                  className="ml-auto"
                  disabled={busy}
                  onClick={() => void lancer({ method: "POST", body: JSON.stringify({ canalId: c.canalId }) }, `Créer les ${manquants(c)} modèles manquants sur le compte ${c.compteId} ?`)}
                >
                  Créer les {manquants(c)} manquants
                </Button>
              )}
            </div>
            {c.error && <p className="mt-1 text-xs text-alerte">{c.error}</p>}
            {c.etat && (
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {c.etat.map((t) => (
                  <li key={t.name} className="flex flex-wrap items-center gap-2">
                    <code className="text-xs">{t.name}</code>
                    {t.status ? <Badge tone={STATUTS[t.status]?.ton ?? "neutral"}>{STATUTS[t.status]?.texte ?? t.status}</Badge> : <Badge tone="neutral">Absent</Badge>}
                    {t.motif && <span className="text-xs text-alerte">{t.motif}</span>}
                  </li>
                ))}
              </ul>
            )}
            {c.crees && c.crees.length > 0 && <p className="mt-1 text-xs text-ok">{c.crees.length} créé(s) et soumis à Meta (réponse en quelques heures, parfois 1 à 2 jours).</p>}
            {c.echecs?.map((e) => (
              <p key={e.name} className="mt-1 text-xs text-alerte">
                {e.name} : {e.erreur}
              </p>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}
