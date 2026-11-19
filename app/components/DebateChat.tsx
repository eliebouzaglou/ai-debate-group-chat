"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DebateConfigSchema, names, type DebateConfig, type DebateEvent, type Seat, type Verdict } from "@/lib/types";
import { loadConfig, loadKeys } from "@/lib/storage";
import { downloadMarkdown, slug, toMarkdown, type ChatMessage } from "@/lib/export";
import { Avatar, seatColor } from "./Avatar";

type Status = "running" | "stopped" | "done" | "error";

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function DebateChat() {
  const [config] = useState<DebateConfig | null>(() => {
    const parsed = DebateConfigSchema.safeParse(loadConfig());
    return parsed.success ? parsed.data : null;
  });
  if (!config) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p>No debate set up in this browser yet.</p>
        <p className="max-w-sm text-sm text-[var(--muted)]">
          Choose a topic, sides and an API key on the setup page, then press Start debate.
        </p>
        <Link href="/" className="rounded-full bg-[var(--wa-green)] px-4 py-2 text-sm font-medium text-white">
          Set one up
        </Link>
      </main>
    );
  }
  return <Chat config={config} />;
}

function Chat({ config }: { config: DebateConfig }) {
  const n = names(config);
  const who: Record<Seat, string> = { a: n.a, b: n.b, mod: n.mod };
  const side: Record<Seat, string> = { a: config.sideA.label, b: config.sideB.label, mod: "Moderator" };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState<{ seat: Seat; judging: boolean } | null>({ seat: "mod", judging: false });
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [status, setStatus] = useState<Status>("running");
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [mock, setMock] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const handle = useCallback((e: DebateEvent) => {
    switch (e.type) {
      case "turn_start":
        setTyping({ seat: e.seat, judging: e.round < 0 });
        if (e.seat !== "mod") setRound(e.round);
        if (e.round >= 0) {
          setMessages((ms) => [
            ...ms,
            { id: `${ms.length}-${e.seat}`, seat: e.seat, round: e.round, text: "", time: now(), done: false },
          ]);
        }
        break;
      case "delta":
        setTyping((t) => (t?.seat === e.seat ? null : t));
        setMessages((ms) => {
          const i = findOpen(ms, e.seat);
          if (i < 0) return ms;
          const copy = ms.slice();
          copy[i] = { ...copy[i], text: copy[i].text + e.text };
          return copy;
        });
        break;
      case "turn_end":
        setTyping((t) => (t?.seat === e.seat ? null : t));
        setMessages((ms) => {
          const i = findOpen(ms, e.seat);
          if (i < 0) return ms;
          const copy = ms.slice();
          copy[i] = { ...copy[i], text: e.text, done: true };
          return copy;
        });
        break;
      case "verdict": {
        const { type: _t, ...v } = e;
        void _t;
        setTyping(null);
        setVerdict(v);
        break;
      }
      case "error":
        setError(e.message);
        setStatus("error");
        setTyping(null);
        break;
      case "done":
        setTyping(null);
        setStatus((s) => (s === "running" ? "done" : s));
        break;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;

    (async () => {
      try {
        const res = await fetch("/api/debate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config, keys: loadKeys() }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Server returned ${res.status}`);
        }
        setMock(res.headers.get("X-Debate-Mock") === "1");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line) handle(JSON.parse(line) as DebateEvent);
          }
        }
        setStatus((s) => (s === "running" ? "done" : s));
        setTyping(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
        setTyping(null);
      }
    })();

    return () => controller.abort();
  }, [config, handle]);

  // Keep the newest message in view unless the reader scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, typing, verdict]);

  const stop = () => {
    controllerRef.current?.abort();
    setStatus("stopped");
    setTyping(null);
    setMessages((ms) => ms.filter((m) => m.text.trim()).map((m) => ({ ...m, done: true })));
  };

  const exportMd = () =>
    downloadMarkdown(`${slug(config.topic)}.md`, toMarkdown(config, messages.filter((m) => m.text.trim()), verdict, status === "stopped"));

  const visible = messages.filter((m) => m.text.length > 0);
  const subtitle = typing
    ? typing.judging
      ? `${n.mod} is judging…`
      : `${who[typing.seat]} is typing…`
    : `${n.a}, ${n.b}, ${n.mod}`;

  return (
    <div className="flex h-dvh flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 bg-[var(--header)] px-3 py-2 text-[var(--header-fg)] shadow-sm">
        <Link href="/" aria-label="Back to setup" className="rounded-full p-1.5 hover:bg-white/10">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <div className="flex -space-x-2.5">
          <Avatar seat="a" name={n.a} size={34} />
          <Avatar seat="b" name={n.b} size={34} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[0.95rem] font-medium leading-tight">{config.topic}</h1>
          <p className={`truncate text-xs ${typing ? "opacity-100" : "opacity-75"}`}>{subtitle}</p>
        </div>
        {status === "running" ? (
          <button onClick={stop} className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25">
            Stop
          </button>
        ) : (
          visible.length > 0 && (
            <button onClick={exportMd} className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25">
              Export .md
            </button>
          )
        )}
      </header>

      {/* Chat */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="chat-wallpaper flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-1.5 px-3 py-4 sm:px-6">
          <Notice>
            {n.a} ({config.sideA.label}) vs {n.b} ({config.sideB.label}) · moderated by {n.mod}
          </Notice>
          {mock && (
            <Notice tone="error">
              Mock mode (DEBATE_MOCK=1): replies are canned, no real model is being called. Restart with npm run dev for a real debate.
            </Notice>
          )}

          {visible.map((m, i) => {
            const prev = visible[i - 1];
            const showChip = m.seat !== "mod" && m.round > 0 && prev?.round !== m.round;
            const grouped = prev && prev.seat === m.seat && !showChip;
            return (
              <div key={m.id} className="contents">
                {showChip && <Chip>{config.untilConcession ? `Answer ${m.round}` : `Answer ${m.round} of ${config.maxRounds}`}</Chip>}
                <Bubble message={m} name={who[m.seat]} side={side[m.seat]} grouped={!!grouped} />
              </div>
            );
          })}

          {typing && <Typing seat={typing.seat} name={who[typing.seat]} />}

          {status === "stopped" && <Notice>Debate stopped. No more tokens are being spent.</Notice>}
          {error && (
            <Notice tone="error">
              {error}
            </Notice>
          )}
          {verdict && <VerdictCard verdict={verdict} who={who} side={side} />}
        </div>
      </div>

      {/* Footer, shaped like WhatsApp's input bar */}
      <footer className="bg-[var(--background)] px-3 py-2">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <div className="flex-1 truncate rounded-full bg-[var(--panel)] px-4 py-2.5 text-sm text-[var(--muted)]">
            {status === "running"
              ? round > 0
                ? config.untilConcession
                  ? `Answer ${round} · until someone concedes`
                  : `Answer ${round} of up to ${config.maxRounds}`
                : "Starting…"
              : status === "done"
                ? "Debate over"
                : status === "stopped"
                  ? "Stopped"
                  : "Something went wrong"}
          </div>
          {status === "running" ? (
            <button
              onClick={stop}
              aria-label="Stop debate"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--wa-green)] text-white hover:bg-[var(--wa-green-dark)]"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
            </button>
          ) : (
            <Link
              href="/"
              className="flex h-11 items-center rounded-full bg-[var(--wa-green)] px-4 text-sm font-medium text-white hover:bg-[var(--wa-green-dark)]"
            >
              New debate
            </Link>
          )}
        </div>
      </footer>
    </div>
  );
}

function findOpen(ms: ChatMessage[], seat: Seat) {
  for (let i = ms.length - 1; i >= 0; i--) if (ms[i].seat === seat && !ms[i].done) return i;
  return -1;
}

function Bubble({ message: m, name, side, grouped }: { message: ChatMessage; name: string; side: string; grouped: boolean }) {
  if (m.seat === "mod") {
    return (
      <div className={`flex justify-center ${grouped ? "" : "mt-2"}`}>
        <div className="max-w-[88%] rounded-lg bg-[var(--bubble-mod)] px-3 py-2 shadow-[var(--bubble-shadow)] sm:max-w-[75%]">
          <div className="mb-0.5 flex items-center gap-1.5">
            <Avatar seat="mod" name={name} size={18} />
            <span className="text-[0.8rem] font-semibold" style={{ color: seatColor("mod") }}>
              {name} · moderator
            </span>
          </div>
          <p className="whitespace-pre-wrap text-[0.9rem] leading-snug">{m.text}</p>
          <Meta time={m.time} />
        </div>
      </div>
    );
  }

  const right = m.seat === "b";
  return (
    <div className={`flex items-end gap-2 ${right ? "flex-row-reverse" : ""} ${grouped ? "" : "mt-2"}`}>
      <div className="w-8 shrink-0">{!grouped && <Avatar seat={m.seat} name={name} />}</div>
      <div
        className={`relative max-w-[80%] rounded-lg px-3 py-1.5 shadow-[var(--bubble-shadow)] sm:max-w-[70%] ${
          right ? "bg-[var(--bubble-out)]" : "bg-[var(--bubble-in)]"
        } ${!grouped ? (right ? "rounded-br-none" : "rounded-bl-none") : ""}`}
      >
        {!grouped && (
          <div className="text-[0.8rem] font-semibold" style={{ color: seatColor(m.seat) }}>
            {name} <span className="font-normal text-[var(--muted)]">· {side}</span>
          </div>
        )}
        <p className="whitespace-pre-wrap text-[0.9375rem] leading-snug">
          {m.text}
          {!m.done && <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-current opacity-60" />}
        </p>
        <Meta time={m.time} ticks={right && m.done} />
      </div>
    </div>
  );
}

function Meta({ time, ticks }: { time: string; ticks?: boolean }) {
  return (
    <div className="-mb-0.5 mt-0.5 flex items-center justify-end gap-1 text-[0.68rem] text-[var(--muted)]">
      {time}
      {ticks && (
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none" stroke="var(--tick)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m1 6 3 3 6-7" />
          <path d="m6 9 1 0 6-7" />
        </svg>
      )}
    </div>
  );
}

function Typing({ seat, name }: { seat: Seat; name: string }) {
  const dots = (
    <div className="flex h-5 items-center gap-1">
      <span className="typing-dot h-2 w-2 rounded-full bg-[var(--muted)]" />
      <span className="typing-dot h-2 w-2 rounded-full bg-[var(--muted)]" />
      <span className="typing-dot h-2 w-2 rounded-full bg-[var(--muted)]" />
    </div>
  );
  if (seat === "mod") {
    return (
      <div className="mt-2 flex justify-center" aria-label={`${name} is typing`}>
        <div className="flex items-center gap-2 rounded-lg bg-[var(--bubble-mod)] px-3 py-2 shadow-[var(--bubble-shadow)]">
          <Avatar seat="mod" name={name} size={18} />
          {dots}
        </div>
      </div>
    );
  }
  const right = seat === "b";
  return (
    <div className={`mt-2 flex items-end gap-2 ${right ? "flex-row-reverse" : ""}`} aria-label={`${name} is typing`}>
      <Avatar seat={seat} name={name} />
      <div
        className={`rounded-lg px-3.5 py-2.5 shadow-[var(--bubble-shadow)] ${
          right ? "rounded-br-none bg-[var(--bubble-out)]" : "rounded-bl-none bg-[var(--bubble-in)]"
        }`}
      >
        {dots}
      </div>
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div className="my-1 flex justify-center">
      <div
        className={`max-w-[90%] rounded-lg px-3 py-1.5 text-center text-xs shadow-[var(--bubble-shadow)] ${
          tone === "error" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-[var(--panel)] text-[var(--muted)]"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex justify-center">
      <span className="rounded-md bg-[var(--panel)] px-2.5 py-1 text-[0.7rem] font-medium text-[var(--muted)] shadow-[var(--bubble-shadow)]">
        {children}
      </span>
    </div>
  );
}

function VerdictCard({ verdict, who, side }: { verdict: Verdict; who: Record<Seat, string>; side: Record<Seat, string> }) {
  const winner = verdict.winner;
  return (
    <div className="mt-4 flex justify-center">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-[var(--panel)] shadow-md">
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          {winner === "draw" ? (
            <div className="flex -space-x-2">
              <Avatar seat="a" name={who.a} size={40} />
              <Avatar seat="b" name={who.b} size={40} />
            </div>
          ) : (
            <Avatar seat={winner} name={who[winner]} size={44} />
          )}
          <div>
            <p className="text-xs text-[var(--muted)]">{who.mod}&apos;s verdict</p>
            <p className="text-lg font-semibold" style={{ color: winner === "draw" ? undefined : seatColor(winner) }}>
              {winner === "draw" ? "It's a draw" : `${who[winner]} (${side[winner]}) wins`}
            </p>
          </div>
        </div>
        <div className="space-y-3 px-4 py-3 text-sm">
          <p className="leading-relaxed">{verdict.reason}</p>
          <List title="Left unanswered" items={verdict.unanswered} />
          <List title="Concessions" items={verdict.concessions} />
        </div>
      </div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-[var(--muted)]">{title}</p>
      <ul className="list-disc space-y-1 pl-5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
