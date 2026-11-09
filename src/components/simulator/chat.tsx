"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { OutgoingMessage } from "@/engine";
import type { ChatEntry } from "@/simulator/session";

/** Gras WhatsApp (*texte*) et retours à la ligne. */
function WhatsAppText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((p, i) => (/^\*[^*\n]+\*$/.test(p) ? <strong key={i}>{p.slice(1, -1)}</strong> : <span key={i}>{p}</span>))}
    </span>
  );
}

function Bubble({ side, children, label, time }: { side: "left" | "right"; children: ReactNode; label?: string; time: string }) {
  return (
    <div className={`flex ${side === "right" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-[13.5px] leading-snug text-[#111b21] shadow-[0_1px_0.5px_rgb(0_0_0/0.13)] ${
          side === "right" ? "rounded-tr-sm bg-[#d9fdd3]" : "rounded-tl-sm bg-white"
        }`}
      >
        {label && <p className="mb-0.5 text-[11px] font-semibold text-pink">{label}</p>}
        {children}
        <p className="mt-0.5 text-right text-[10px] text-[#667781]">{time}</p>
      </div>
    </div>
  );
}

function ActionButton({ children, onClick, href, disabled }: { children: ReactNode; onClick?: () => void; href?: string; disabled?: boolean }) {
  const cls = "block w-full rounded-lg bg-white py-2 text-center text-[13.5px] font-medium text-[#027eb5] shadow-[0_1px_0.5px_rgb(0_0_0/0.13)] hover:bg-[#f5f6f6] disabled:opacity-50";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function BotMessage({ message, time, onReply, disabled }: { message: OutgoingMessage; time: string; onReply: (id: string, title: string, list: boolean) => void; disabled: boolean }) {
  const [listOpen, setListOpen] = useState(false);
  if (message.kind === "typing") return null;
  return (
    <div className="max-w-[85%] space-y-1">
      <Bubble side="left" time={time}>
        <WhatsAppText text={message.text} />
      </Bubble>
      {message.kind === "buttons" &&
        message.buttons.map((b) => (
          <ActionButton key={b.id} disabled={disabled} onClick={() => onReply(b.id, b.title, false)}>
            ↩︎ {b.title}
          </ActionButton>
        ))}
      {message.kind === "link" && <ActionButton href={message.url}>🔗 {message.buttonLabel}</ActionButton>}
      {message.kind === "list" && (
        <>
          <ActionButton onClick={() => setListOpen((o) => !o)}>☰ {message.buttonLabel}</ActionButton>
          {listOpen && (
            <div className="overflow-hidden rounded-lg bg-white shadow-[0_1px_0.5px_rgb(0_0_0/0.13)]">
              {message.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={disabled}
                  className="block w-full border-b border-[#e9edef] px-3 py-2 text-left text-[13.5px] last:border-0 hover:bg-[#f5f6f6]"
                  onClick={() => {
                    setListOpen(false);
                    onReply(item.id, item.title, true);
                  }}
                >
                  {item.title}
                  {item.description && <span className="block text-[12px] text-[#667781]">{item.description}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Chat({
  entries,
  typing,
  busy,
  formatTime,
  onText,
  onReply,
  empty,
}: {
  entries: ChatEntry[];
  typing: boolean;
  busy: boolean;
  formatTime: (iso: string) => string;
  onText: (text: string) => void;
  onReply: (id: string, title: string, list: boolean) => void;
  empty?: ReactNode;
}) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries.length, typing]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#efeae2] text-[#111b21] [color-scheme:light]">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" data-testid="chat">
        {entries.length === 0 && empty}
        {entries.map((e) => {
          const time = formatTime(e.at);
          if (e.from === "client") {
            return (
              <Bubble key={e.id} side="right" time={time}>
                <WhatsAppText text={e.text} />
              </Bubble>
            );
          }
          if (e.from === "gerant") {
            return (
              <Bubble key={e.id} side="left" time={time} label="Gérant (appli WhatsApp Business)">
                <WhatsAppText text={e.text} />
              </Bubble>
            );
          }
          if (e.from === "system") {
            return (
              <p key={e.id} className="mx-auto w-fit max-w-[90%] rounded-lg bg-[#ffeecd] px-2.5 py-1 text-center text-[12px] text-[#54656f]">
                {e.text}
              </p>
            );
          }
          return <BotMessage key={e.id} message={e.message} time={time} onReply={onReply} disabled={busy} />;
        })}
        {typing && (
          <div className="flex w-fit items-center gap-1 rounded-xl rounded-tl-sm bg-white px-3 py-2.5 shadow-[0_1px_0.5px_rgb(0_0_0/0.13)]" aria-label="en train d'écrire">
            <span className="size-1.5 animate-bounce rounded-full bg-[#8696a0] [animation-delay:-0.3s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-[#8696a0] [animation-delay:-0.15s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-[#8696a0]" />
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2 border-t border-black/5 bg-[#f0f2f5] p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() || busy) return;
          onText(text.trim());
          setText("");
        }}
      >
        <input
          aria-label="Message du client"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Écrire comme le client…"
          className="min-w-0 flex-1 rounded-full bg-white px-4 py-2 text-sm text-[#111b21] [color-scheme:light] placeholder:text-[#667781] focus:outline-none"
        />
        <button type="submit" disabled={busy || !text.trim()} className="rounded-full bg-[#00a884] px-4 text-sm font-semibold text-white disabled:opacity-40">
          Envoyer
        </button>
      </form>
    </div>
  );
}
