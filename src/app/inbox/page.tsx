"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { MobileConversation, MobileInboxList } from "@/components/inbox-mobile";
import { useIsMobile } from "@/components/mobile";
import { OPEN_CONVERSATION_EVENT, PushControls } from "@/components/pwa";
import { markSeen, readSeen, type SeenState } from "@/lib/inbox-view";
import { Badge, Button, Card, Loading, Notice, Textarea } from "@/components/ui";
import type { InboxCanal, InboxConversation } from "@/channels/core/inbox";
import type { StoredMessage } from "@/channels/core/types";
import { accessToken } from "@/lib/supabase";

type InboxState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "off"; missing: string[] }
  | { status: "ready"; mode: "supabase" | "memory"; canaux: InboxCanal[] };

type Thread = { messages: (StoredMessage & { texte: string })[] };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Erreur ${response.status}`);
  return body;
}

const REFRESH_MS = 5000;
const who = (canal: InboxCanal, conv: InboxConversation) => conv.nom || (canal.plateforme === "instagram" ? `Instagram ${conv.waId.slice(-4)}` : `+${conv.waId}`);
const time = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function InboxPage() {
  const [state, setState] = useState<InboxState>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const isMobile = useIsMobile();
  const [seen, setSeen] = useState<SeenState>({ initAt: new Date(0).toISOString(), seen: {} });
  useEffect(() => {
    // Mémoire « déjà lu » de cet appareil (localStorage), lue une fois la page affichée.
    void Promise.resolve().then(() => setSeen(readSeen()));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ available: boolean; missing?: string[]; mode?: "supabase" | "memory"; canaux?: InboxCanal[] }>("/api/inbox");
      if (!data.available) setState({ status: "off", missing: data.missing ?? [] });
      else setState({ status: "ready", mode: data.mode!, canaux: data.canaux ?? [] });
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const loadThread = useCallback(async (contactId: string) => {
    try {
      setThread(await api<Thread>(`/api/inbox/${encodeURIComponent(contactId)}`));
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

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refresh();
      if (selected) await loadThread(selected);
    };
    void tick();
    const timer = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh, loadThread, selected]);

  async function act(action: Record<string, unknown>, success: string | null): Promise<boolean> {
    if (!selected) return false;
    try {
      await api(`/api/inbox/${encodeURIComponent(selected)}`, { method: "POST", body: JSON.stringify(action) });
      setNotice(success ? { tone: "success", text: success } : null);
      await refresh();
      await loadThread(selected);
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  const conversations = state.status === "ready" ? state.canaux.flatMap((c) => c.conversations.map((v) => ({ canal: c, conv: v }))) : [];
  const current = conversations.find((x) => x.conv.contactId === selected);

  if (isMobile) {
    return (
      <AppShell mobile>
        {state.status === "loading" && <Loading />}
        {state.status === "error" && <Notice tone="error">{state.error}</Notice>}
        {state.status === "off" && <Notice tone="info">Aucun canal (WhatsApp, Instagram) n&apos;est encore branché. Variables manquantes : {state.missing.join(", ")}.</Notice>}
        {state.status === "ready" && (
          <>
            <MobileInboxList
              canaux={state.canaux}
              seen={seen}
              notice={current ? null : notice}
              onCloseNotice={() => setNotice(null)}
              onOpen={openConversation}
              extra={state.mode === "memory" ? <SimulateForm plateformes={[...new Set(state.canaux.map((c) => c.plateforme))]} onSent={refresh} onError={(text) => setNotice({ tone: "error", text })} /> : null}
            />
            {current && (
              <MobileConversation
                canal={current.canal}
                conv={current.conv}
                thread={thread}
                notice={notice}
                onCloseNotice={() => setNotice(null)}
                onBack={backToList}
                onTakeOver={async () => void (await act({ type: "reprendre" }, "Tu as la main : le bot se tait pour ce client."))}
                onRelease={async () => void (await act({ type: "relancer" }, "Le bot a repris la conversation."))}
                onReply={(texte) => act({ type: "repondre", texte }, null)}
              />
            )}
          </>
        )}
      </AppShell>
    );
  }

  return (
    <AppShell mobile>
      <h1 className="text-3xl font-semibold">Boîte de réception</h1>
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
        {state.status === "ready" && <PushControls compact />}
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
            {state.mode === "memory" && <SimulateForm plateformes={[...new Set(state.canaux.map((c) => c.plateforme))]} onSent={refresh} onError={(text) => setNotice({ tone: "error", text })} />}
            <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
              <Card title="Conversations">
                {state.canaux.length === 0 && <p className="text-sm text-muted">Aucun compte WhatsApp ou Instagram relié.</p>}
                <div className="space-y-4" data-testid="inbox-list">
                  {state.canaux.map((canal) => (
                    <div key={canal.canalId}>
                      <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                        {canal.plateforme === "instagram" ? "📸 " : "💬 "}
                        {canal.nomResto} {canal.numero && <span className="font-normal normal-case">· {canal.numero}</span>}
                        {canal.etat !== "actif" && <span className="ml-1 normal-case">({canal.etat})</span>}
                      </p>
                      {canal.conversations.length === 0 && <p className="mt-1 text-sm text-muted">Aucune conversation.</p>}
                      <ul className="mt-1 divide-y divide-rule">
                        {canal.conversations.map((conv) => (
                          <li key={conv.contactId}>
                            <button
                              type="button"
                              className={`w-full rounded-xl px-2 py-2 text-left hover:bg-page ${selected === conv.contactId ? "bg-page" : ""}`}
                              onClick={() => show(conv.contactId)}
                            >
                              <span className="flex items-center gap-1.5">
                                <span className="font-semibold">{who(canal, conv)}</span>
                                {conv.transfertOuvert && <Badge tone="warning">🔔 Attend l&apos;équipe</Badge>}
                                {conv.pause && <Badge>{pauseLabel(conv)}</Badge>}
                                {conv.demoEnCours && <Badge tone="info">Démo {conv.demoEnCours}</Badge>}
                              </span>
                              {conv.dernierMessage && (
                                <span className="block truncate text-xs text-muted">
                                  {conv.dernierMessage.sens === "entrant" ? "" : "↪ "}
                                  {conv.dernierMessage.texte} · {time(conv.dernierMessage.at)}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title={current ? who(current.canal, current.conv) : "Conversation"} className="min-w-0">
                {!current || !thread ? (
                  <p className="text-sm text-muted">Choisis une conversation.</p>
                ) : (
                  <ConversationView
                    conv={current.conv}
                    thread={thread}
                    onTakeOver={() => act({ type: "reprendre" }, "Tu as la main : le bot se tait pour ce client.")}
                    onRelease={() => act({ type: "relancer" }, "Le bot a repris la conversation.")}
                    onReply={async (texte) => void (await act({ type: "repondre", texte }, "Message envoyé."))}
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

function pauseLabel(conv: InboxConversation): string {
  if (!conv.pause) return "";
  const who = { transfert_humain: "transfert", echo_gerant: "le gérant a répondu", manuel: "main reprise" }[conv.pause.reason];
  return `⏸ Bot en pause (${who})`;
}

function ConversationView({
  conv,
  thread,
  onTakeOver,
  onRelease,
  onReply,
}: {
  conv: InboxConversation;
  thread: Thread;
  onTakeOver: () => void;
  onRelease: () => void;
  onReply: (texte: string) => Promise<void> | void;
}) {
  const [texte, setTexte] = useState("");
  return (
    <div className="space-y-3" data-testid="inbox-thread">
      <div className="flex flex-wrap items-center gap-2">
        {conv.pause ? (
          <>
            <span className="text-sm text-muted">
              {pauseLabel(conv)}
              {conv.pause.until ? ` jusqu'à ${time(conv.pause.until)}` : " (jusqu'à ce que tu le relances)"}
            </span>
            <Button onClick={onRelease}>Rendre au bot</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onTakeOver}>
            Reprendre la main
          </Button>
        )}
        <span className="ml-auto text-xs text-muted">{conv.fenetreOuverte ? "Fenêtre de 24 h ouverte" : "Fenêtre de 24 h fermée"}</span>
      </div>
      <div className="max-h-[60vh] space-y-1.5 overflow-y-auto rounded-2xl bg-[#efeae2] p-3">
        {thread.messages.map((m) => (
          <div key={m.id} className={`flex ${m.sens === "entrant" ? "justify-start" : "justify-end"}`}>
            <div
              className={`max-w-[80%] rounded-xl px-3 py-1.5 text-sm whitespace-pre-wrap shadow-sm ${
                m.sens === "entrant" ? "bg-white" : m.auteur === "humain" ? "bg-[#d9fdd3]" : "bg-[#e7f0ff]"
              }`}
            >
              <span className="mb-0.5 block text-[10px] font-semibold text-muted">
                {m.sens === "entrant" ? "Client" : m.sens === "echo" ? "Gérant (appli)" : m.auteur === "humain" ? "Équipe" : "Bot"} · {time(m.at)}
                {m.statut === "echec" && <span className="text-coral"> · échec{m.erreur ? ` : ${m.erreur}` : ""}</span>}
                {m.statut === "lu" && " · lu"}
              </span>
              {m.texte}
            </div>
          </div>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!texte.trim()) return;
          await onReply(texte);
          setTexte("");
        }}
      >
        <Textarea
          aria-label="Réponse"
          rows={2}
          disabled={!conv.fenetreOuverte}
          placeholder={conv.fenetreOuverte ? "Répondre au client (le bot se met en pause)…" : "Fenêtre de 24 h fermée : le client doit réécrire"}
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
        />
        <Button type="submit" disabled={!conv.fenetreOuverte || !texte.trim()}>
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
      className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-line bg-white p-3 text-sm"
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
