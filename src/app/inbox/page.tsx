"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { MobileConversation, MobileInboxList } from "@/components/inbox-mobile";
import { MobileHeader, useIsMobile } from "@/components/mobile";
import { OPEN_CONVERSATION_EVENT, PushControls } from "@/components/pwa";
import { FILTRE_PAR_DEFAUT, filtrerCanaux, isUnread, lastAt, markSeen, plainExtract, readSeen, shortTime, sortConversations, type InboxFiltre, type SeenState } from "@/lib/inbox-view";
import { BarreEtat, EtatBadge, FiltresInbox, ListeMessages, RechercheInbox } from "@/components/inbox-parts";
import { POLL_MS, useInboxRealtime } from "@/lib/inbox-realtime";
import { fusionnerConversation, majConversationListe, nouvelEnvoi, reglerEnvoi, type EnvoiLocal, type LigneConversation, type MessageAffiche } from "@/lib/inbox-envoi";
import { Button, Card, Loading, Notice, Textarea } from "@/components/ui";
import type { InboxCanal, InboxConversation } from "@/channels/core/inbox";
import { accessToken } from "@/lib/supabase";
import { useAuth } from "@/components/auth-gate";

type InboxState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "off"; missing: string[] }
  | { status: "ready"; mode: "supabase" | "memory"; canaux: InboxCanal[] };

type Thread = { messages: MessageAffiche[] };

async function call<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T & { error?: string } }> {
  const token = await accessToken();
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  return { ok: response.ok, status: response.status, body };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { ok, status, body } = await call<T>(path, init);
  if (!ok) throw new Error(body.error ?? `Erreur ${status}`);
  return body;
}

/** Réponse de POST /api/inbox/[contactId]. */
type ActionResponse = { ok?: boolean; pause?: InboxConversation["pause"]; message?: MessageAffiche };

const who = (canal: InboxCanal, conv: InboxConversation) => conv.nom || (canal.plateforme === "instagram" ? `Instagram ${conv.waId.slice(-4)}` : `+${conv.waId}`);
/** Qui a écrit le dernier message, pour l'extrait de la liste. */
const prefixe = (d: NonNullable<InboxConversation["dernierMessage"]>) => (d.sens === "entrant" ? "" : d.sens === "echo" || d.auteur === "humain" ? "👩‍🍳 Équipe : " : "🤖 ");

export default function InboxPage() {
  const { role } = useAuth();
  const [state, setState] = useState<InboxState>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  // Réponses envoyées depuis cet écran, par conversation (affichées tout de suite, puis confirmées).
  const [envois, setEnvois] = useState<Record<string, EnvoiLocal[]>>({});
  const selectedRef = useRef<string | null>(null);
  // Les réponses partent l'une après l'autre (même ordre chez le client), sans bloquer l'écran.
  const file = useRef<Promise<void>>(Promise.resolve());
  const isMobile = useIsMobile();
  const [seen, setSeen] = useState<SeenState>({ initAt: new Date(0).toISOString(), seen: {} });
  // Filtre par resto ; numéros de test de Meta (+1 555 …) masqués par défaut.
  const [filtre, setFiltre] = useState<InboxFiltre>(FILTRE_PAR_DEFAUT);
  useEffect(() => {
    // Mémoire « déjà lu » de cet appareil (localStorage), lue une fois la page affichée.
    void Promise.resolve().then(() => setSeen(readSeen()));
  }, []);

  // Recherche (nom, numéro ou contenu d'un message) : envoyée au serveur 300 ms après la dernière frappe.
  const [recherche, setRecherche] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(recherche.trim()), 300);
    return () => clearTimeout(t);
  }, [recherche]);
  const qRef = useRef("");
  const refresh = useCallback(async () => {
    try {
      const query = qRef.current ? `?q=${encodeURIComponent(qRef.current)}` : "";
      const data = await api<{ available: boolean; missing?: string[]; mode?: "supabase" | "memory"; canaux?: InboxCanal[] }>(`/api/inbox${query}`);
      if (!data.available) setState({ status: "off", missing: data.missing ?? [] });
      else setState({ status: "ready", mode: data.mode!, canaux: data.canaux ?? [] });
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const loadThread = useCallback(async (contactId: string) => {
    try {
      const data = await api<Thread>(`/api/inbox/${encodeURIComponent(contactId)}`);
      // Réponse arrivée après un changement de conversation : on l'ignore.
      if (selectedRef.current === contactId) setThread(data);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  // Notification touchée : /inbox?contact=… ouvre la conversation (ou l'événement envoyé par le service worker
  // quand la page est déjà ouverte). Sur téléphone : directement en plein écran.
  const scrollToThread = useRef(false);
  useEffect(() => {
    // Tablette / petit ordinateur : la conversation est sous la liste, on y descend une fois chargée.
    if (!thread || !scrollToThread.current) return;
    scrollToThread.current = false;
    if (!window.matchMedia("(max-width: 767px)").matches) document.querySelector("[data-testid=inbox-thread]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [thread]);
  const show = useCallback(
    (contactId: string | null) => {
      selectedRef.current = contactId;
      setSelected(contactId);
      setThread(null);
      if (!contactId) return;
      scrollToThread.current = true;
      void loadThread(contactId);
    },
    [loadThread],
  );
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("contact");
    if (initial) void Promise.resolve().then(() => show(initial));
    const onOpen = (event: Event) => show((event as CustomEvent<string>).detail);
    // Retour arrière (geste de l'iPhone, flèche) : l'adresse dit quelle conversation est ouverte.
    const onPop = () => show(new URLSearchParams(window.location.search).get("contact"));
    window.addEventListener(OPEN_CONVERSATION_EVENT, onOpen);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener(OPEN_CONVERSATION_EVENT, onOpen);
      window.removeEventListener("popstate", onPop);
    };
  }, [show]);

  /** Ouvre une conversation et la garde dans l'historique (le retour arrière revient à la liste). */
  function openConversation(contactId: string) {
    window.history.pushState({ pflowConversation: true }, "", `/inbox?contact=${encodeURIComponent(contactId)}`);
    show(contactId);
  }
  function backToList() {
    if ((window.history.state as { pflowConversation?: boolean } | null)?.pflowConversation) window.history.back();
    else {
      // Ouverte depuis une notification : pas de page précédente dans l'historique.
      window.history.replaceState(null, "", "/inbox");
      show(null);
    }
  }

  // Conversation ouverte : ses messages sont lus sur cet appareil.
  useEffect(() => {
    const last = thread?.messages.at(-1)?.at;
    if (selected && last) void Promise.resolve().then(() => setSeen((s) => markSeen(s, selected, last)));
  }, [selected, thread]);
  // Lu aussi pour l'utilisateur sur le serveur (ordinateur et iPhone synchronisés), une fois par nouveau message.
  const luEnvoye = useRef<Record<string, string>>({});
  useEffect(() => {
    const last = thread?.messages.at(-1)?.at;
    if (!selected || !last || luEnvoye.current[selected] === last) return;
    luEnvoye.current[selected] = last;
    void call(`/api/inbox/${encodeURIComponent(selected)}`, { method: "POST", body: JSON.stringify({ type: "lu", at: last }) }).catch(() => undefined);
  }, [selected, thread]);

  // Temps réel : un message ou un changement de pause recharge tout de suite ; sinon rafraîchissement toutes les 5 s.
  const sync = useInboxRealtime(
    useCallback(() => {
      void refresh();
      if (selectedRef.current) void loadThread(selectedRef.current);
    }, [refresh, loadThread]),
  );

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      // Liste et conversation en même temps : la conversation n'attend plus la liste (plus lente).
      await Promise.all([refresh(), selected ? loadThread(selected) : null]);
    };
    qRef.current = q;
    void tick();
    const timer = setInterval(tick, POLL_MS[sync]);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh, loadThread, selected, sync, q]);

  /** Reprendre la main / rendre au bot : la pause s'affiche dès la réponse, la liste se recharge ensuite. */
  async function act(action: { type: "reprendre" | "relancer" }, success: string): Promise<void> {
    const contactId = selected;
    if (!contactId) return;
    try {
      const result = await api<ActionResponse>(`/api/inbox/${encodeURIComponent(contactId)}`, { method: "POST", body: JSON.stringify(action) });
      setNotice({ tone: "success", text: success });
      setState((s) => (s.status === "ready" ? { ...s, canaux: majConversationListe(s.canaux, contactId, { pause: result.pause ?? null }) } : s));
      void Promise.all([refresh(), loadThread(contactId)]);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Répondre : le message s'affiche tout de suite (« envoi… »), part dans l'ordre, puis « envoyé ✓ » ou « échec ». */
  function repondre(contactId: string, texte: string) {
    const envoi = nouvelEnvoi(texte);
    setEnvois((all) => ({ ...all, [contactId]: [...(all[contactId] ?? []), envoi] }));
    file.current = file.current.then(() => envoyer(contactId, envoi));
  }

  async function envoyer(contactId: string, envoi: EnvoiLocal) {
    let resultat: Parameters<typeof reglerEnvoi>[2];
    try {
      const { ok, status, body } = await call<ActionResponse>(`/api/inbox/${encodeURIComponent(contactId)}`, {
        method: "POST",
        body: JSON.stringify({ type: "repondre", texte: envoi.texte }),
      });
      resultat = ok ? { ok: true, ...(body.message ? { message: body.message } : {}) } : { ok: false, erreur: body.error ?? `Erreur ${status}`, ...(body.message ? { message: body.message } : {}) };
      if (ok) {
        const at = body.message?.at ?? envoi.at;
        setState((s) =>
          s.status === "ready"
            ? { ...s, canaux: majConversationListe(s.canaux, contactId, { ...("pause" in body ? { pause: body.pause ?? null } : {}), dernierMessage: { texte: envoi.texte, sens: "sortant", at } }) }
            : s,
        );
      }
    } catch (error) {
      // Réseau coupé : rien n'est parti (ou on ne le sait pas) ; « Réessayer » reste possible.
      resultat = { ok: false, erreur: error instanceof Error ? error.message : String(error) };
    }
    setEnvois((all) => ({ ...all, [contactId]: reglerEnvoi(all[contactId] ?? [], envoi.tempId, resultat) }));
  }

  function reessayer(contactId: string, tempId: string) {
    const envoi = (envois[contactId] ?? []).find((e) => e.tempId === tempId);
    if (!envoi) return;
    setEnvois((all) => ({ ...all, [contactId]: (all[contactId] ?? []).filter((e) => e.tempId !== tempId) }));
    repondre(contactId, envoi.texte);
  }

  const visibles = state.status === "ready" ? filtrerCanaux(state.canaux, filtre) : [];
  const rows = sortConversations(visibles);
  const conversations = state.status === "ready" ? state.canaux.flatMap((c) => c.conversations.map((v) => ({ canal: c, conv: v }))) : [];
  const current = conversations.find((x) => x.conv.contactId === selected);
  const lignes: LigneConversation[] | null =
    thread && current ? fusionnerConversation(thread.messages, envois[current.conv.contactId] ?? [], { canalId: current.canal.canalId, contactId: current.conv.contactId }) : null;

  if (isMobile) {
    return (
      <AppShell mobile>
        {state.status !== "ready" && <MobileHeader title="Boîte de réception" />}
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <Notice tone="error">{state.error}</Notice>}
        {state.status === "off" && <Notice tone="info">Aucun canal (WhatsApp, Instagram) n&apos;est encore branché. Variables manquantes : {state.missing.join(", ")}.</Notice>}
        {state.status === "ready" && (
          <>
            <MobileInboxList
              canaux={visibles}
              filtres={
                <div className="space-y-2">
                  <RechercheInbox value={recherche} onChange={setRecherche} sync={sync} sombre />
                  <FiltresInbox canaux={state.canaux} filtre={filtre} onChange={setFiltre} sombre />
                </div>
              }
              seen={seen}
              notice={current ? null : notice}
              onCloseNotice={() => setNotice(null)}
              onOpen={openConversation}
              extra={state.mode === "memory" && role === "admin" ? <SimulateForm plateformes={[...new Set(state.canaux.map((c) => c.plateforme))]} onSent={refresh} onError={(text) => setNotice({ tone: "error", text })} /> : null}
            />
            {current && (
              <MobileConversation
                canal={current.canal}
                conv={current.conv}
                lignes={lignes}
                notice={notice}
                onCloseNotice={() => setNotice(null)}
                onBack={backToList}
                onTakeOver={async () => void (await act({ type: "reprendre" }, "Tu as la main : le bot se tait pour ce client."))}
                onRelease={async () => void (await act({ type: "relancer" }, "Rendu au bot : il répond de nouveau à ce client."))}
                onReply={(texte) => repondre(current.conv.contactId, texte)}
                onRetry={(tempId) => reessayer(current.conv.contactId, tempId)}
              />
            )}
          </>
        )}
      </AppShell>
    );
  }

  return (
    <AppShell mobile>
      <h1 className="text-5xl">Boîte de <span className="text-rose">réception</span></h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Les conversations WhatsApp et Instagram de chaque resto. Reprends la main quand un client a besoin d&apos;une personne : le bot se tait jusqu&apos;à ce
        que tu le relances.
      </p>
      <div className="mt-6 space-y-4">
        {notice && (
          <Notice tone={notice.tone} onClose={() => setNotice(null)}>
            {notice.text}
          </Notice>
        )}
        {state.status === "ready" && role === "admin" && <PushControls compact />}
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <Notice tone="error">{state.error}</Notice>}
        {state.status === "off" && (
          <Notice tone="info">
            Aucun canal (WhatsApp, Instagram) n&apos;est encore branché (étape C). Variables manquantes : {state.missing.join(", ")}. Pour tester sans Meta :
            mode démo (voir <code>docs/journal.md</code>).
          </Notice>
        )}
        {state.status === "ready" && (
          <>
            {state.mode === "memory" && role === "admin" && <SimulateForm plateformes={[...new Set(state.canaux.map((c) => c.plateforme))]} onSent={refresh} onError={(text) => setNotice({ tone: "error", text })} />}
            <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
              <Card title="Conversations">
                <RechercheInbox value={recherche} onChange={setRecherche} sync={sync} />
                <FiltresInbox canaux={state.canaux} filtre={filtre} onChange={setFiltre} />
                {rows.length === 0 && <p className="mt-3 text-sm text-muted">Aucune conversation.</p>}
                <ul className="mt-3 divide-y divide-rule" data-testid="inbox-list">
                  {rows.map(({ canal, conv }) => {
                    const unread = isUnread(conv, seen);
                    const d = conv.dernierMessage;
                    return (
                      <li key={conv.contactId}>
                        <button
                          type="button"
                          className={`w-full rounded-xl px-2 py-2 text-left hover:bg-ink/5 ${selected === conv.contactId ? "bg-ink/5" : ""}`}
                          onClick={() => show(conv.contactId)}
                          data-testid="inbox-row"
                        >
                          <span className="flex items-baseline gap-2">
                            <span className={`min-w-0 flex-1 truncate ${unread ? "font-extrabold" : "font-semibold"}`}>{who(canal, conv)}</span>
                            {unread && <span className="bg-brand size-2.5 shrink-0 self-center rounded-full" aria-label="non lu" />}
                            <span className={`shrink-0 text-xs ${unread ? "font-bold text-rose" : "text-muted"}`}>{shortTime(lastAt(conv))}</span>
                          </span>
                          {conv.correspondance ? (
                            <span className="block truncate text-xs text-ink" data-testid="inbox-correspondance">
                              🔎 « {plainExtract(conv.correspondance)} »
                            </span>
                          ) : (
                            d && (
                              <span className={`block truncate text-xs ${unread ? "font-semibold text-ink" : "text-muted"}`}>
                                {prefixe(d)}
                                {plainExtract(d.texte)}
                              </span>
                            )
                          )}
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <EtatBadge conv={conv} />
                            <span className="truncate text-xs text-muted">
                              {canal.plateforme === "instagram" ? "📸" : "💬"} {canal.nomResto}
                              {canal.testMeta ? " · test Meta" : ""}
                              {conv.demoEnCours ? ` · démo ${conv.demoEnCours}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
              <Card title={current ? who(current.canal, current.conv) : "Conversation"} className="min-w-0">
                {!current || !lignes ? (
                  <p className="text-sm text-muted">Choisis une conversation.</p>
                ) : (
                  <ConversationView
                    conv={current.conv}
                    lignes={lignes}
                    onTakeOver={() => void act({ type: "reprendre" }, "Tu as la main : le bot se tait pour ce client.")}
                    onRelease={() => void act({ type: "relancer" }, "Rendu au bot : il répond de nouveau à ce client.")}
                    onReply={(texte) => repondre(current.conv.contactId, texte)}
                    onRetry={(tempId) => reessayer(current.conv.contactId, tempId)}
                  />
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function ConversationView({
  conv,
  lignes,
  onTakeOver,
  onRelease,
  onReply,
  onRetry,
}: {
  conv: InboxConversation;
  lignes: LigneConversation[];
  onTakeOver: () => void;
  onRelease: () => void;
  onReply: (texte: string) => void;
  onRetry: (tempId: string) => void;
}) {
  const [texte, setTexte] = useState("");
  // Dernier message visible : à l'ouverture et à chaque nouveau message (si on était déjà en bas, ou après un envoi).
  const zone = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = zone.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lignes.length]);
  return (
    <div className="space-y-3" data-testid="inbox-thread">
      <BarreEtat conv={conv} onTakeOver={onTakeOver} onRelease={onRelease} />
      <p className="text-xs text-muted">{conv.fenetreOuverte ? "Fenêtre de 24 h ouverte : tu peux répondre." : "Fenêtre de 24 h fermée : tu pourras répondre quand le client réécrira."}</p>
      <div
        ref={zone}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="max-h-[60vh] space-y-1.5 overflow-y-auto rounded-2xl bg-chat-motif p-3 aplat-nuit"
      >
        <ListeMessages lignes={lignes} onRetry={onRetry} />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!texte.trim()) return;
          // Affiché tout de suite dans la conversation : la zone se vide sans attendre Meta.
          stick.current = true;
          onReply(texte);
          setTexte("");
        }}
      >
        <Textarea
          aria-label="Réponse"
          rows={2}
          disabled={!conv.fenetreOuverte}
          placeholder={conv.fenetreOuverte ? "Répondre au client (le bot se met en pause 12 h)…" : "Fenêtre de 24 h fermée : le client doit réécrire"}
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
        />
        <Button type="submit" className="self-end" disabled={!conv.fenetreOuverte || !texte.trim()}>
          Envoyer
        </Button>
      </form>
    </div>
  );
}

/** Mode démo : simuler un message client (aucun numéro WhatsApp nécessaire). */
function SimulateForm({ plateformes, onSent, onError }: { plateformes: InboxCanal["plateforme"][]; onSent: () => void; onError: (text: string) => void }) {
  const [plateforme, setPlateforme] = useState<InboxCanal["plateforme"]>(plateformes[0] ?? "whatsapp");
  const [texte, setTexte] = useState("bonjour");
  const [nom, setNom] = useState("Léa");
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-pink/40 carte p-3 text-sm shadow-card"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api("/api/inbox/simuler", { method: "POST", body: JSON.stringify({ texte, nom, plateforme }) });
          onSent();
        } catch (error) {
          onError(error instanceof Error ? error.message : String(error));
        }
      }}
    >
      <span className="font-semibold">Mode démo :</span>
      {plateformes.length > 1 && (
        <select aria-label="Plateforme simulée" className="rounded-lg border border-line px-2 py-1" value={plateforme} onChange={(e) => setPlateforme(e.target.value as InboxCanal["plateforme"])}>
          {plateformes.map((p) => (
            <option key={p} value={p}>
              {p === "instagram" ? "Instagram" : "WhatsApp"}
            </option>
          ))}
        </select>
      )}
      <input aria-label="Nom du client simulé" className="w-28 rounded-lg border border-line px-2 py-1" value={nom} onChange={(e) => setNom(e.target.value)} />
      <input aria-label="Message du client simulé" className="min-w-48 flex-1 rounded-lg border border-line px-2 py-1" value={texte} onChange={(e) => setTexte(e.target.value)} />
      <Button type="submit" variant="secondary">
        Simuler un message client
      </Button>
    </form>
  );
}
