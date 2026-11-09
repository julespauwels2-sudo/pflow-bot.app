"use client";

/**
 * Application installable et notifications push (côté navigateur).
 * - PwaRegister (dans le layout) : enregistre public/sw.js et, quand on touche une notification, ouvre la
 *   conversation dans la page déjà ouverte.
 * - PushControls : bouton « Activer les notifications » (geste de l'utilisateur, exigé par l'iPhone), état de cet
 *   appareil, « Envoyer une notification de test ».
 * Sur iPhone : iOS 16.4 ou plus, et SEULEMENT depuis l'app ajoutée à l'écran d'accueil (Partager → Sur l'écran
 * d'accueil). Voir docs/etape-c/notifications-push.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { accessToken } from "@/lib/supabase";
import { Badge, Button, Notice } from "./ui";

/** Événement de la page : « ouvre cette conversation » (contact de la boîte de réception). */
export const OPEN_CONVERSATION_EVENT = "pflow-ouvrir-conversation";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== "pflow-ouvrir" || !data.url) return;
      const url = new URL(data.url, window.location.origin);
      if (url.origin !== window.location.origin) return;
      const contact = url.searchParams.get("contact");
      if (url.pathname === "/inbox" && window.location.pathname === "/inbox" && contact) {
        window.history.replaceState(null, "", `${url.pathname}${url.search}`);
        window.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT, { detail: contact }));
      } else {
        // Rechargement voulu : la page de la conversation s'ouvre avec son état complet.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`${url.pathname}${url.search}`);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);
  return null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok && !(body && typeof body === "object" && "statut" in body)) throw new Error(body.error ?? `Erreur ${response.status}`);
  return body;
}

/** Clé publique VAPID (base64url) → octets, pour pushManager.subscribe. */
export function vapidKeyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** « iPhone (Safari) », « Mac (Chrome) »… pour s'y retrouver dans la liste des appareils. */
export function deviceLabel(userAgent: string, touchPoints = 0): string {
  const device = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Macintosh/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "PC Windows"
            : "Ordinateur";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\/|FxiOS/.test(userAgent) ? "Firefox" : /Chrome\/|CriOS/.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "navigateur";
  return `${device} (${browser})`;
}

type Support =
  | { ok: true }
  | { ok: false; reason: "iphone_ecran_accueil" | "ios_trop_ancien" | "navigateur" };

function pushSupport(): Support {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const apis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (ios && !standalone) return { ok: false, reason: "iphone_ecran_accueil" };
  if (!apis) return { ok: false, reason: ios ? "ios_trop_ancien" : "navigateur" };
  return { ok: true };
}

interface Appareil {
  endpoint: string;
  appareil: string | null;
  creeLe: string | null;
  dernierEnvoiLe: string | null;
  dernierEchecLe: string | null;
  dernierEchec: string | null;
}
/** Enregistre l'abonnement de cet appareil côté serveur. */
async function save(subscription: PushSubscription) {
  const json = subscription.toJSON();
  await api("/api/push", {
    method: "POST",
    body: JSON.stringify({ subscription: { endpoint: json.endpoint, keys: json.keys }, appareil: deviceLabel(navigator.userAgent, navigator.maxTouchPoints) }),
  });
}

type ServerState = { configure: boolean; publicKey: string | null; appareils: Appareil[] };
type View =
  | { status: "loading" }
  | { status: "unsupported"; reason: Extract<Support, { ok: false }>["reason"] }
  | { status: "ready"; server: ServerState; permission: NotificationPermission; endpoint: string | null };

const time = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const UNSUPPORTED: Record<Extract<Support, { ok: false }>["reason"], string> = {
  iphone_ecran_accueil:
    "Sur iPhone, les notifications ne marchent que depuis l'app installée : dans Safari, touche Partager puis « Sur l'écran d'accueil », ouvre PFlow Bots depuis la nouvelle icône, connecte-toi, puis reviens ici.",
  ios_trop_ancien: "Cet iPhone ne gère pas les notifications web : il faut iOS 16.4 ou plus (Réglages → Général → Mise à jour logicielle).",
  navigateur: "Ce navigateur ne gère pas les notifications push.",
};

/** Notifications de CET appareil. `compact` : version courte pour la boîte de réception. */
export function PushControls({ compact = false, onChange }: { compact?: boolean; onChange?: () => void }) {
  const [view, setView] = useState<View>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const registration = useRef<ServiceWorkerRegistration | null>(null);

  const load = useCallback(async () => {
    const support = pushSupport();
    if (!support.ok) return setView({ status: "unsupported", reason: support.reason });
    try {
      registration.current = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const [server, subscription] = await Promise.all([api<ServerState>("/api/push"), registration.current.pushManager.getSubscription()]);
      // Abonnement présent sur l'appareil mais inconnu du serveur (base vidée, autre compte…) : on le renvoie.
      if (subscription && Notification.permission === "granted" && server.configure && !server.appareils.some((a) => a.endpoint === subscription.endpoint)) {
        await save(subscription).catch(() => undefined);
        server.appareils = (await api<ServerState>("/api/push")).appareils;
      }
      setView({ status: "ready", server, permission: Notification.permission, endpoint: subscription?.endpoint ?? null });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    // Hors du rendu (microtâche) : l'état de l'appareil est lu une fois la page affichée.
    void Promise.resolve().then(load);
  }, [load]);

  // Appelé directement par le toucher du bouton : l'iPhone n'accepte la demande d'autorisation qu'après un geste.
  async function enable() {
    if (view.status !== "ready" || !view.server.publicKey || !registration.current) return;
    setBusy(true);
    setNotice(null);
    try {
      const subscription =
        (await registration.current.pushManager.getSubscription()) ??
        (await registration.current.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(view.server.publicKey) }));
      await save(subscription);
      setNotice({ tone: "success", text: "Notifications activées sur cet appareil." });
      await load();
      onChange?.();
    } catch (error) {
      const denied = typeof Notification !== "undefined" && Notification.permission === "denied";
      setNotice({
        tone: "error",
        text: denied
          ? "Notifications refusées. Pour les autoriser : sur iPhone, Réglages → Notifications → PFlow Bots ; sur ordinateur, réglages du site (cadenas à gauche de l'adresse)."
          : `Activation impossible : ${error instanceof Error ? error.message : String(error)}`,
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!registration.current) return;
    setBusy(true);
    try {
      const subscription = await registration.current.pushManager.getSubscription();
      if (subscription) {
        await api("/api/push", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
      setNotice({ tone: "info", text: "Notifications désactivées sur cet appareil." });
      await load();
      onChange?.();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(endpoint: string) {
    setBusy(true);
    try {
      await api("/api/push", { method: "DELETE", body: JSON.stringify({ endpoint }) });
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await api<{ statut: string; envoyes: number; erreurs: string[] }>("/api/push/test", { method: "POST" });
      if (result.statut === "envoyee") setNotice({ tone: "success", text: `Notification de test envoyée à ${result.envoyes} appareil(s).` });
      else setNotice({ tone: "error", text: `Notification de test non envoyée : ${result.erreurs.join(" | ") || result.statut}` });
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  const noticeBox = notice && (
    <Notice tone={notice.tone} onClose={() => setNotice(null)}>
      {notice.text}
    </Notice>
  );

  if (view.status === "loading") return compact ? null : <p className="text-sm text-muted">Vérification de cet appareil…{noticeBox}</p>;
  if (view.status === "unsupported") {
    // Dans la boîte de réception, on ne parle de l'iPhone que s'il faut agir (installer l'app).
    if (compact && view.reason === "navigateur") return null;
    return <Notice tone="info">{UNSUPPORTED[view.reason]}</Notice>;
  }

  const { server, permission, endpoint } = view;
  const thisDevice = endpoint ? server.appareils.find((a) => a.endpoint === endpoint) : undefined;
  if (!server.configure) {
    return compact ? null : <Notice tone="info">Clés VAPID absentes : ajoute VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY dans Vercel (VAPID_SUBJECT facultatif ; voir la doc).</Notice>;
  }
  if (compact && thisDevice) return noticeBox || null;

  return (
    <div className="space-y-2" data-testid="push-controls">
      {noticeBox}
      <div className="flex flex-wrap items-center gap-2">
        {thisDevice ? (
          <>
            <Badge tone="success">🔔 Notifications activées sur cet appareil</Badge>
            <Button variant="secondary" onClick={test} disabled={busy}>
              Envoyer une notification de test
            </Button>
            <Button variant="secondary" onClick={disable} disabled={busy}>
              Désactiver sur cet appareil
            </Button>
          </>
        ) : permission === "denied" ? (
          <Notice tone="error">
            Notifications refusées sur cet appareil. Sur iPhone : Réglages → Notifications → PFlow Bots, puis rouvre l&apos;app. Sur ordinateur : réglages
            du site (cadenas à gauche de l&apos;adresse), puis recharge la page.
          </Notice>
        ) : (
          <>
            <Button onClick={enable} disabled={busy}>
              {busy ? "Activation…" : "🔔 Activer les notifications"}
            </Button>
            {compact && <span className="text-xs text-muted">Pour être prévenu sur cet appareil quand un client attend une réponse.</span>}
          </>
        )}
      </div>
      {!compact && (
        <>
          {server.appareils.length > 0 ? (
            <ul className="divide-y divide-rule text-sm" data-testid="push-appareils">
              {server.appareils.map((a) => (
                <li key={a.endpoint} className="flex flex-wrap items-baseline gap-2 py-1">
                  <strong>{a.appareil ?? "Appareil"}</strong>
                  {a.endpoint === endpoint && <Badge tone="info">cet appareil</Badge>}
                  {a.creeLe && <span className="text-xs text-muted">ajouté le {time(a.creeLe)}</span>}
                  {a.dernierEnvoiLe && <span className="text-xs text-muted">· dernière notification {time(a.dernierEnvoiLe)}</span>}
                  {a.dernierEchecLe && (!a.dernierEnvoiLe || a.dernierEchecLe > a.dernierEnvoiLe) && (
                    <span className="text-xs text-alerte">
                      · échec {time(a.dernierEchecLe)} : {a.dernierEchec}
                    </span>
                  )}
                  {a.endpoint !== endpoint && (
                    <button type="button" className="ml-auto text-xs text-muted underline max-md:min-h-11" onClick={() => remove(a.endpoint)} disabled={busy}>
                      Retirer
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Aucun appareil abonné : aucune alerte ne peut vous joindre (elles restent seulement visibles dans la boîte de réception).</p>
          )}
          {server.appareils.length > 0 && !thisDevice && (
            <Button variant="secondary" onClick={test} disabled={busy}>
              Envoyer une notification de test
            </Button>
          )}
        </>
      )}
    </div>
  );
}
