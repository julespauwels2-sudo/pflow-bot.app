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
  etat: "lien_envoye" | "en_cours" | "terminee" | "erreur" | "annulee" | "expiree";
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

  async function generer() {
    setBusy(true);
    setErreur(null);
    try {
      setLien(await appel({ method: "POST", body: JSON.stringify({ restaurantId: resto }) }));
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
            <Button onClick={generer} disabled={!resto || busy || data.tableAbsente} data-testid="connexion-generer">
              {busy ? "Création…" : "Créer le lien"}
            </Button>
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
            <button type="button" className="mt-1 text-sm font-semibold text-pink-3 underline" onClick={() => void navigator.clipboard?.writeText(lien.url)}>
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
                  {c.numeroAffiche && <span className="text-muted">{c.numeroAffiche}</span>}
                  <span className="text-xs text-muted">
                    créé le {date(c.creeLe)}
                    {c.termineLe ? ` · terminé le ${date(c.termineLe)}` : ` · expire le ${date(c.expireLe)}`}
                  </span>
                </div>
                {c.erreur && <p className="text-xs text-coral">{c.erreur}</p>}
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
