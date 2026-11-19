"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Markdown from "react-markdown";
import { DebateConfigSchema, names, type CruxState, type DebateConfig, type DebateEvent, type Debater, type Leaning, type Seat, type Verdict } from "@/lib/types";
import { loadConfig, loadKeys } from "@/lib/storage";
import { CHECK_LABEL, downloadMarkdown, FACT_CHECK_LABEL, TRAP_RESULT_LABEL, toMarkdown, type ChatMessage, type Usage } from "@/lib/export";
import { formatCost, formatTokens, slug } from "@/utils";
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
  const [usage, setUsage] = useState<Usage | null>(null);
  const [opener, setOpener] = useState<Debater | null>(null);
  const [scoreboard, setScoreboard] = useState<CruxState[]>([]);
  const [leaning, setLeaning] = useState<{ value: Leaning; afterAnswer: number } | null>(null);
  const [askDraft, setAskDraft] = useState("");
  const [asking, setAsking] = useState(false);
  const roundRef = useRef(0); // latest answer number, readable inside the event handler
  const controllerRef = useRef<AbortController | null>(null);
  const askControllerRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const askInputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback((e: DebateEvent) => {
    switch (e.type) {
      case "turn_start":
        if (e.prep) {
          // Prep runs for both sides at once; the plan cards show their own progress.
          setTyping(null);
          setMessages((ms) => [
            ...ms,
            { id: `prep-${e.seat}`, seat: e.seat, round: 0, text: "", time: now(), done: false, prep: true },
          ]);
          break;
        }
        setTyping({ seat: e.seat, judging: e.round < 0 && !e.rapidFire });
        if (e.seat !== "mod" && !e.rapidFire) {
          setRound(e.round);
          roundRef.current = e.round;
        }
        if (e.round >= 0) {
          setMessages((ms) => [
            ...ms,
            {
              id: `${ms.length}-${e.seat}${e.rapidFire ? "-rf" : ""}`,
              seat: e.seat,
              round: e.round,
              text: "",
              time: now(),
              done: false,
              ...(e.rapidFire ? { rapidFire: true } : {}),
              ...(e.rapidFireAsk ? { rapidFireAsk: true } : {}),
              ...(e.trap ? { trap: e.trap } : {}),
            },
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
          copy[i] = {
            ...copy[i],
            text: e.text,
            done: true,
            ...(e.factCheck ? { factCheck: e.factCheck } : {}),
            ...(e.rapidFire ? { rapidFire: true } : {}),
            ...(e.rapidFireAsk ? { rapidFireAsk: true } : {}),
            ...(e.trap ? { trap: e.trap } : {}),
            ...(e.trapResult ? { trapResult: e.trapResult } : {}),
            ...(e.checkVerdict ? { checkVerdict: e.checkVerdict } : {}),
          };
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
      case "leaning": {
        const { type: _l, ...value } = e;
        void _l;
        setLeaning({ value, afterAnswer: roundRef.current });
        break;
      }
      case "scoreboard":
        setScoreboard(e.cruxes);
        break;
      case "plan_update":
        setMessages((ms) =>
          ms.map((m) => (m.prep && m.seat === e.seat ? { ...m, text: e.text, checked: true, revised: e.revised } : m)),
        );
        break;
      case "ping":
        break;
      case "coin_flip":
        setOpener(e.winner);
        break;
      case "usage":
        setUsage({ inputTokens: e.inputTokens, outputTokens: e.outputTokens, costUsd: e.costUsd });
        break;
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
  }, [messages, typing, verdict, asking]);

  const stop = () => {
    controllerRef.current?.abort();
    askControllerRef.current?.abort();
    setStatus("stopped");
    setTyping(null);
    setAsking(false);
    setMessages((ms) => ms.filter((m) => m.text.trim()).map((m) => ({ ...m, done: true })));
  };

  const canAsk = status === "done" && !!verdict;

  useEffect(() => {
    if (canAsk && !asking) askInputRef.current?.focus();
  }, [canAsk, asking]);

  const askModerator = async (raw: string) => {
    if (!verdict || asking) return;
    const question = raw.trim();
    if (!question) return;

    const transcript = buildTranscript(config, messages);
    const history = messages
      .filter((m) => m.ask && m.done && m.text.trim())
      .map((m) => ({
        role: (m.seat === "you" ? "user" : "assistant") as "user" | "assistant",
        content: m.text,
      }));

    const youId = `ask-you-${Date.now()}`;
    const modId = `ask-mod-${Date.now()}`;
    setAskDraft("");
    setAsking(true);
    setTyping({ seat: "mod", judging: false });
    setMessages((ms) => [
      ...ms,
      { id: youId, seat: "you", round: -1, text: question, time: now(), done: true, ask: true },
      { id: modId, seat: "mod", round: -1, text: "", time: now(), done: false, ask: true },
    ]);

    const controller = new AbortController();
    askControllerRef.current = controller;
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, keys: loadKeys(), verdict, transcript, history, question }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reply = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as DebateEvent;
          if (e.type === "delta" && e.seat === "mod") {
            reply += e.text;
            setTyping(null);
            setMessages((ms) => ms.map((m) => (m.id === modId ? { ...m, text: reply } : m)));
          } else if (e.type === "turn_end" && e.seat === "mod") {
            reply = e.text;
            setMessages((ms) => ms.map((m) => (m.id === modId ? { ...m, text: e.text, done: true } : m)));
          } else if (e.type === "usage") {
            setUsage((u) => ({
              inputTokens: (u?.inputTokens ?? 0) + e.inputTokens,
              outputTokens: (u?.outputTokens ?? 0) + e.outputTokens,
              costUsd: (u?.costUsd ?? 0) + e.costUsd,
            }));
          } else if (e.type === "error") {
            throw new Error(e.message);
          }
        }
      }
      setMessages((ms) => ms.map((m) => (m.id === modId ? { ...m, text: reply || "(no answer)", done: true } : m)));
    } catch (err) {
      if (!controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((ms) =>
          ms.map((m) => (m.id === modId ? { ...m, text: `Couldn't reach ${n.mod}: ${msg}`, done: true } : m)),
        );
      } else {
        setMessages((ms) => ms.filter((m) => m.id !== modId || m.text.trim()).map((m) => (m.id === modId ? { ...m, done: true } : m)));
      }
    } finally {
      setAsking(false);
      setTyping(null);
      askControllerRef.current = null;
      askInputRef.current?.focus();
    }
  };

  const exportMd = () =>
    downloadMarkdown(`${slug(config.topic)}.md`, toMarkdown(config, messages.filter((m) => m.text.trim()), verdict, status === "stopped", usage, opener ? who[opener] : null, scoreboard));

  const plans = messages.filter((m) => m.prep);
  const visible = messages.filter((m) => !m.prep && m.text.length > 0);
  const preparing = status === "running" && plans.some((m) => !m.done);
  const inRapidFire = status === "running" && messages.some((m) => m.rapidFire && !m.done);
  const subtitle = preparing
    ? `${n.a} and ${n.b} are preparing…`
    : inRapidFire
      ? "Rapid fire…"
      : asking || (typing && canAsk)
        ? `${n.mod} is answering…`
        : typing
          ? typing.judging
            ? `${n.mod} is judging…`
            : `${who[typing.seat]} is typing…`
          : canAsk
            ? `Ask ${n.mod} about the verdict`
            : `${n.a}, ${n.b}, ${n.mod}`;

  return (
    <LeaningContext.Provider value={{ leaning, names: { a: n.a, b: n.b, mod: n.mod }, sides: { a: config.sideA.label, b: config.sideB.label } }}>
      <div className="flex h-dvh flex-col">
        {/* Header */}
        <header className="flex items-center gap-3 bg-[var(--header)] px-3 py-2 text-[var(--header-fg)] shadow-sm">
          <Link href="/" aria-label="Back to setup" className="rounded-full p-1.5 hover:bg-white/10">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <div className="flex items-center -space-x-2.5">
            <Avatar seat="a" name={n.a} size={34} />
            <Avatar seat="b" name={n.b} size={34} />
            <LeaningHover placement="below" align="start" className="rounded-full ring-2 ring-[var(--header)]">
              <Avatar seat="mod" name={n.mod} size={34} />
            </LeaningHover>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[0.95rem] font-medium leading-tight">{config.topic}</h1>
            <p className={`truncate text-xs ${typing || preparing || inRapidFire ? "opacity-100" : "opacity-75"}`}>{subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {status === "running" ? (
              <button onClick={stop} className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25">
                Stop
              </button>
            ) : (
              <>
                {(visible.length > 0 || plans.some((m) => m.text)) && (
                  <button onClick={exportMd} className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25">
                    Export .md
                  </button>
                )}
                <Link href="/" className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25">
                  New
                </Link>
              </>
            )}
          </div>
        </header>

        {scoreboard.length > 0 && <Scoreboard cruxes={scoreboard} who={who} />}

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

            {opener && <CoinFlip winner={opener} names={{ a: n.a, b: n.b }} sides={{ a: config.sideA.label, b: config.sideB.label }} />}

            {plans.length > 0 && (
              <>
                <Chip>Prep: private plans</Chip>
                {plans.map((m) => (
                  <PlanCard key={m.id} message={m} name={who[m.seat as Seat]} side={side[m.seat as Seat]} />
                ))}
              </>
            )}

            {visible.map((m, i) => {
              const prev = visible[i - 1];
              const showAskChip = m.ask && m.seat === "you" && !prev?.ask;
              const showRapidChip = !!m.rapidFire && !prev?.rapidFire;
              const showChip =
                !m.ask &&
                !m.rapidFire &&
                m.seat !== "mod" &&
                m.seat !== "you" &&
                m.round > 0 &&
                prev?.round !== m.round;
              const grouped =
                prev &&
                prev.seat === m.seat &&
                !showChip &&
                !showAskChip &&
                !showRapidChip &&
                !!prev.rapidFire === !!m.rapidFire;
              const bubbleName = m.seat === "you" ? "You" : who[m.seat];
              const bubbleSide = m.seat === "you" ? "viewer" : side[m.seat];
              return (
                <div key={m.id} className="contents">
                  {showAskChip && <Chip>Questions for {n.mod}</Chip>}
                  {showRapidChip && <Chip>Rapid fire · cross-ex</Chip>}
                  {showChip && <Chip>{`Answer ${m.round}`}</Chip>}
                  <Bubble message={m} name={bubbleName} side={bubbleSide} grouped={!!grouped} />
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
            {verdict && <VerdictCard verdict={verdict} who={who} side={side} scoreboard={scoreboard} />}
            {canAsk && !asking && messages.every((m) => !m.ask) && (
              <Notice>
                Ask {n.mod} anything about the verdict — why that side won, a specific unanswered point, a call you disagree with.
              </Notice>
            )}
          </div>
        </div>

        {/* Footer, shaped like WhatsApp's input bar */}
        <footer className="bg-[var(--background)] px-3 py-2">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            {canAsk ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void askModerator(askDraft);
                }}
              >
                <input
                  ref={askInputRef}
                  value={askDraft}
                  onChange={(e) => setAskDraft(e.target.value)}
                  disabled={asking}
                  placeholder={`Ask ${n.mod} about the verdict…`}
                  aria-label={`Ask ${n.mod} about the verdict`}
                  className="min-w-0 flex-1 rounded-full bg-[var(--panel)] px-4 py-2.5 text-sm outline-none ring-1 ring-transparent placeholder:text-[var(--muted)] focus:ring-[var(--wa-green)] disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={asking || !askDraft.trim()}
                  aria-label="Send question"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--wa-green)] text-white hover:bg-[var(--wa-green-dark)] disabled:opacity-40"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M3.4 20.6 21 12 3.4 3.4 3 10l11 2-11 2z" />
                  </svg>
                </button>
              </form>
            ) : (
              <>
                <div className="flex-1 truncate rounded-full bg-[var(--panel)] px-4 py-2.5 text-sm text-[var(--muted)]">
                  {status === "running"
                    ? round > 0
                      ? `Answer ${round}`
                      : preparing
                        ? "Preparing game plans…"
                        : "Starting…"
                    : `${status === "done" ? "Debate over" : status === "stopped" ? "Stopped" : "Something went wrong"}${usage ? ` · ${formatTokens(usage.inputTokens + usage.outputTokens)} tokens · about ${formatCost(usage.costUsd)}` : ""
                    }`}
                </div>
                {status === "running" ? (
                  <div className="group relative">
                    <button
                      onClick={stop}
                      aria-label="Stop debate"
                      aria-describedby="spend-popup"
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--wa-green)] text-white hover:bg-[var(--wa-green-dark)]"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
                    </button>
                    <SpendPopup usage={usage} />
                  </div>
                ) : (
                  <Link
                    href="/"
                    className="flex h-11 items-center rounded-full bg-[var(--wa-green)] px-4 text-sm font-medium text-white hover:bg-[var(--wa-green-dark)]"
                  >
                    New debate
                  </Link>
                )}
              </>
            )}
          </div>
          {canAsk && usage && (
            <p className="mx-auto mt-1 max-w-3xl px-1 text-[0.7rem] text-[var(--muted)]">
              {formatTokens(usage.inputTokens + usage.outputTokens)} tokens · about {formatCost(usage.costUsd)} so far
            </p>
          )}
        </footer>
      </div>
    </LeaningContext.Provider>
  );
}

function findOpen(ms: ChatMessage[], seat: Seat) {
  for (let i = ms.length - 1; i >= 0; i--) if (ms[i].seat === seat && !ms[i].done) return i;
  return -1;
}

/** Plain transcript of the debate for post-verdict Q&A (no prep plans, no ask turns). */
function buildTranscript(config: DebateConfig, messages: ChatMessage[]): string {
  const n = names(config);
  const label: Record<Seat, string> = {
    mod: `${n.mod} (moderator)`,
    a: `${n.a} (${config.sideA.label})`,
    b: `${n.b} (${config.sideB.label})`,
  };
  return messages
    .filter((m) => !m.prep && !m.ask && m.seat !== "you" && m.text.trim())
    .map((m) => `${label[m.seat as Seat]}: ${m.text}`)
    .join("\n\n");
}

function Bubble({ message: m, name, side, grouped }: { message: ChatMessage; name: string; side: string; grouped: boolean }) {
  if (m.seat === "you") {
    return (
      <div className={`flex justify-end ${grouped ? "" : "mt-2"}`}>
        <div className={`max-w-[80%] rounded-lg rounded-br-none bg-[var(--bubble-out)] px-3 py-1.5 shadow-[var(--bubble-shadow)] sm:max-w-[70%]`}>
          {!grouped && <div className="text-[0.8rem] font-semibold text-[var(--muted)]">You</div>}
          <p className="whitespace-pre-wrap text-[0.9375rem] leading-snug">{m.text}</p>
          <Meta time={m.time} ticks />
        </div>
      </div>
    );
  }
  if (m.rapidFire && m.seat !== "mod" && m.trap === "check") {
    const right = m.seat === "b";
    const v = m.checkVerdict ?? "not_beaten";
    const tone = v === "beaten" ? "text-red-600 dark:text-red-400" : "text-[var(--wa-green)]";
    const detail = m.text.replace(/^(Beaten|Not beaten)\.?\s*/, "");
    return (
      <div className={`flex items-start gap-2 ${right ? "flex-row-reverse" : ""} mt-1.5`}>
        <div className="w-8 shrink-0" />
        <div className="max-w-[80%] rounded-lg border border-dashed border-[var(--muted)]/50 bg-[var(--panel)]/70 px-3 py-1.5 text-[0.8rem] sm:max-w-[70%]">
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-[var(--muted)]">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <span className="text-[var(--muted)]">{name} asks their coach, privately: did they beat me?</span>
          </div>
          <p className="mt-0.5 leading-snug">
            <span className={`font-semibold ${tone}`}>{CHECK_LABEL[v]}</span>
            {detail ? ` · ${detail}` : ""}
          </p>
        </div>
      </div>
    );
  }
  if (m.rapidFire && m.seat !== "mod" && (m.trap === "spring" || m.trap === "reply")) {
    const right = m.seat === "b";
    return (
      <div className={`flex items-end gap-2 ${right ? "flex-row-reverse" : ""} mt-2`}>
        <div className="w-8 shrink-0">
          <Avatar seat={m.seat} name={name} />
        </div>
        <div
          className={`max-w-[80%] rounded-lg px-3 py-1.5 shadow-[var(--bubble-shadow)] sm:max-w-[70%] ${right ? "rounded-br-none bg-[var(--bubble-out)]" : "rounded-bl-none bg-[var(--bubble-in)]"
            } ${m.trap === "spring" ? "ring-2 ring-[var(--wa-green)]/40" : ""}`}
        >
          <div className="text-[0.75rem] font-semibold" style={{ color: seatColor(m.seat) }}>
            {name} <span className="font-normal text-[var(--muted)]">· {m.trap === "spring" ? "springs the trap" : "replies"}</span>
          </div>
          <p className="whitespace-pre-wrap text-[0.9375rem] leading-snug">
            {m.text}
            {!m.done && <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-current opacity-60" />}
          </p>
          <Meta time={m.time} ticks={right && m.done} />
        </div>
      </div>
    );
  }
  if (m.rapidFire && m.seat !== "mod") {
    const yes = /^yes$/i.test(m.text.trim());
    const no = /^no$/i.test(m.text.trim());
    const right = m.seat === "b";
    if (!m.rapidFireAsk) {
      return (
        <div className={`flex items-end gap-2 ${right ? "flex-row-reverse" : ""} ${grouped ? "" : "mt-1.5"}`}>
          <div className="w-8 shrink-0">{!grouped && <Avatar seat={m.seat} name={name} />}</div>
          <div
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 shadow-[var(--bubble-shadow)] ${right ? "bg-[var(--bubble-out)]" : "bg-[var(--bubble-in)]"
              }`}
          >
            <span className="text-[0.75rem] font-semibold" style={{ color: seatColor(m.seat) }}>
              {name}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[0.8rem] font-semibold tabular-nums ${yes
                ? "bg-[var(--wa-green)]/15 text-[var(--wa-green)]"
                : no
                  ? "bg-red-500/15 text-red-600 dark:text-red-400"
                  : "text-[var(--muted)]"
                }`}
            >
              {m.text || "…"}
            </span>
            <span className="text-[0.65rem] text-[var(--muted)]">{m.time}</span>
          </div>
        </div>
      );
    }
    // Question from one debater to the other.
    return (
      <div className={`flex items-end gap-2 ${right ? "flex-row-reverse" : ""} ${grouped ? "" : "mt-2"}`}>
        <div className="w-8 shrink-0">
          <Avatar seat={m.seat} name={name} />
        </div>
        <div
          className={`max-w-[80%] rounded-lg px-3 py-1.5 shadow-[var(--bubble-shadow)] sm:max-w-[70%] ${right ? "rounded-br-none bg-[var(--bubble-out)]" : "rounded-bl-none bg-[var(--bubble-in)]"
            }`}
        >
          <div className="text-[0.75rem] font-semibold" style={{ color: seatColor(m.seat) }}>
            {name} <span className="font-normal text-[var(--muted)]">· asks</span>
          </div>
          <p className="whitespace-pre-wrap text-[0.9rem] leading-snug">{m.text}</p>
          <Meta time={m.time} ticks={right && m.done} />
        </div>
      </div>
    );
  }
  if (m.seat === "mod" && m.trap === "ruling") {
    const r = m.trapResult ?? "scored";
    const tone =
      r === "closed"
        ? "border-[var(--wa-green)] bg-[var(--wa-green)]/10 text-[var(--wa-green)]"
        : r === "scored"
          ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-[var(--muted)] bg-[var(--panel)] text-[var(--muted)]";
    return (
      <div className="mt-2 flex justify-center">
        <div className={`max-w-[88%] rounded-lg border-l-4 px-3 py-2 shadow-[var(--bubble-shadow)] sm:max-w-[75%] ${tone}`}>
          <div className="mb-0.5 flex items-center gap-1.5">
            <Avatar seat="mod" name={name} size={18} />
            <span className="text-[0.8rem] font-semibold">
              {name} · ruling: {TRAP_RESULT_LABEL[r]}
              {r === "closed" ? " · debate over" : ""}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-[0.9rem] leading-snug text-[var(--foreground)]">{m.text}</p>
          <Meta time={m.time} />
        </div>
      </div>
    );
  }
  if (m.seat === "mod" && m.factCheck) {
    return (
      <div className="mt-2 flex justify-center">
        <div className="max-w-[88%] rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 shadow-[var(--bubble-shadow)] sm:max-w-[75%] dark:bg-red-950/60">
          <div className="mb-0.5 flex items-center gap-1.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-red-600 dark:text-red-400">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v6" />
              <path d="M12 16.5v.5" />
            </svg>
            <span className="text-[0.8rem] font-semibold text-red-700 dark:text-red-300">
              {name} · fact check: {FACT_CHECK_LABEL[m.factCheck] ?? m.factCheck}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-[0.9rem] leading-snug">{m.text}</p>
          <Meta time={m.time} />
        </div>
      </div>
    );
  }
  if (m.seat === "mod") {
    return (
      <div className={`flex justify-center ${grouped ? "" : "mt-2"}`}>
        <div className="max-w-[88%] rounded-lg bg-[var(--bubble-mod)] px-3 py-2 shadow-[var(--bubble-shadow)] sm:max-w-[75%]">
          <LeaningHover placement="below" className="mb-0.5 inline-flex items-center gap-1.5 rounded">
            <Avatar seat="mod" name={name} size={18} />
            <span className="text-[0.8rem] font-semibold" style={{ color: seatColor("mod") }}>
              {name} · moderator
            </span>
          </LeaningHover>
          <p className="whitespace-pre-wrap text-[0.9rem] leading-snug">{m.text}</p>
          <Meta time={m.time} />
        </div>
      </div>
    );
  }

  const seat = m.seat as Debater;
  const right = seat === "b";
  return (
    <div className={`flex items-end gap-2 ${right ? "flex-row-reverse" : ""} ${grouped ? "" : "mt-2"}`}>
      <div className="w-8 shrink-0">{!grouped && <Avatar seat={seat} name={name} />}</div>
      <div
        className={`relative max-w-[80%] rounded-lg px-3 py-1.5 shadow-[var(--bubble-shadow)] sm:max-w-[70%] ${right ? "bg-[var(--bubble-out)]" : "bg-[var(--bubble-in)]"
          } ${!grouped ? (right ? "rounded-br-none" : "rounded-bl-none") : ""}`}
      >
        {!grouped && (
          <div className="text-[0.8rem] font-semibold" style={{ color: seatColor(seat) }}>
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

function SpendPopup({ usage }: { usage: Usage | null }) {
  const total = usage ? usage.inputTokens + usage.outputTokens : 0;
  return (
    <div
      id="spend-popup"
      role="tooltip"
      className="pointer-events-none invisible absolute bottom-full right-0 z-10 mb-2 w-60 translate-y-1 rounded-xl bg-[var(--panel)] p-3 text-sm opacity-0 shadow-lg ring-1 ring-[var(--border)] transition duration-150 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
    >
      <p className="text-xs text-[var(--muted)]">Spent so far</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">about {formatCost(usage?.costUsd ?? 0)}</p>
      <dl className="mt-2 space-y-0.5 text-xs tabular-nums">
        <div className="flex justify-between">
          <dt className="text-[var(--muted)]">Tokens</dt>
          <dd>{total.toLocaleString("en-US")}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--muted)]">Read (input)</dt>
          <dd>{(usage?.inputTokens ?? 0).toLocaleString("en-US")}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--muted)]">Written (output)</dt>
          <dd>{(usage?.outputTokens ?? 0).toLocaleString("en-US")}</dd>
        </div>
      </dl>
      <p className="mt-2 border-t border-[var(--border)] pt-2 text-[0.7rem] leading-snug text-[var(--muted)]">
        Estimated from list prices. Updates after every message. Click to stop the debate.
      </p>
    </div>
  );
}

function PlanCard({ message: m, name, side }: { message: ChatMessage; name: string; side: string }) {
  const seat = m.seat as Seat;
  const right = seat === "b";
  const mod = seat === "mod";
  return (
    <div className={`mt-2 flex items-start gap-2 ${mod ? "justify-center" : right ? "flex-row-reverse" : ""}`}>
      {!mod && (
        <div className="w-8 shrink-0">
          <Avatar seat={seat} name={name} />
        </div>
      )}
      <details
        className={`group max-w-[80%] rounded-lg border border-dashed border-[var(--muted)]/50 px-3 py-2 sm:max-w-[70%] ${mod ? "bg-[var(--bubble-mod)]/70" : right ? "bg-[var(--bubble-out)]/60" : "bg-[var(--bubble-in)]/70"
          }`}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[0.8rem]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-[var(--muted)]">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span>
            <span className="font-semibold" style={{ color: seatColor(seat) }}>
              {mod ? `${name}'s backstage brief` : `${name}'s game plan`}
            </span>{" "}
            <span className="text-[var(--muted)]">
              {mod ? "· private" : `· ${side} · only ${name} sees this`}
              {!mod && m.checked ? (m.revised ? " · fact-checked, revised" : " · fact-checked") : ""}
            </span>
          </span>
          {m.done && (mod || m.checked) ? (
            <span className="ml-auto shrink-0 pl-2 text-xs font-medium text-[var(--wa-green)] group-open:hidden">Show</span>
          ) : (
            <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-xs text-[var(--muted)]">
              {mod ? "thinking" : m.done ? "fact-checking" : "setting traps"}
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
            </span>
          )}
        </summary>
        <div className="plan-md mt-2 border-t border-[var(--border)] pt-2 text-[0.85rem] leading-snug">
          {m.text ? <Markdown>{m.text}</Markdown> : "…"}
        </div>
      </details>
    </div>
  );
}

const LeaningContext = createContext<{
  leaning: { value: Leaning; afterAnswer: number } | null;
  names: Record<Seat, string>;
  sides: Record<Debater, string>;
} | null>(null);

const REASON_LABEL: Record<Leaning["reasons"][number]["kind"], { label: string; good: boolean }> = {
  false_claim: { label: "False claim", good: false },
  unsupported_claim: { label: "Unsupported claim", good: false },
  unanswered_point: { label: "Left unanswered", good: false },
  dodged_question: { label: "Dodged question", good: false },
  contradiction: { label: "Contradiction", good: false },
  concession: { label: "Conceded a point", good: false },
  trap_landed: { label: "Trap landed", good: true },
  stronger_evidence: { label: "Stronger evidence", good: true },
  sounder_reasoning: { label: "Sounder reasoning", good: true },
};

// How far the marker sits toward the leading side.
const MARGIN_OFFSET = { slight: 12, clear: 28, decisive: 44 } as const;

/** Wraps the moderator's avatar/name; hovering or focusing it shows who the moderator is leaning toward. */
function LeaningHover({
  children,
  placement,
  align = "center",
  className = "",
}: {
  children: React.ReactNode;
  placement: "below" | "above";
  /** "start" pins the popup's left edge to the trigger, for triggers near the screen's left edge. */
  align?: "center" | "start";
  className?: string;
}) {
  const ctx = useContext(LeaningContext);
  if (!ctx) return <>{children}</>;
  return (
    <span tabIndex={0} aria-label={`${ctx.names.mod}'s leaning`} className={`group/lean relative cursor-help outline-none focus-visible:ring-2 focus-visible:ring-[var(--wa-green)] ${className}`}>
      {children}
      <LeaningPopup placement={placement} align={align} />
    </span>
  );
}

function LeaningPopup({ placement, align }: { placement: "below" | "above"; align: "center" | "start" }) {
  const ctx = useContext(LeaningContext)!;
  const { leaning, names: who, sides } = ctx;
  const v = leaning?.value;
  const pos = !v || v.toward === "even" ? 50 : 50 + (v.toward === "b" ? 1 : -1) * MARGIN_OFFSET[v.margin];
  return (
    <span
      role="tooltip"
      className={`pointer-events-none invisible absolute z-30 block w-72 max-w-[calc(100vw-2rem)] rounded-xl ${align === "start" ? "-left-16" : "left-1/2 -translate-x-1/2"} bg-[var(--panel)] p-3 text-left text-sm font-normal text-[var(--foreground)] opacity-0 shadow-lg ring-1 ring-[var(--border)] transition duration-150 group-hover/lean:visible group-hover/lean:opacity-100 group-focus-within/lean:visible group-focus-within/lean:opacity-100 ${placement === "below" ? "top-full mt-2" : "bottom-full mb-2"
        }`}
    >
      <span className="block text-xs text-[var(--muted)]">{who.mod}&apos;s private leaning</span>
      {!v ? (
        <span className="mt-1 block text-[0.8rem] text-[var(--muted)]">No read yet. {who.mod} updates this after every answer.</span>
      ) : (
        <>
          <span className="mt-0.5 block text-base font-semibold" style={{ color: v.toward === "even" ? undefined : seatColor(v.toward) }}>
            {v.toward === "even" ? "Even so far" : `Leaning ${who[v.toward]} · ${v.margin}`}
          </span>
          {/* meter: side a on the left, side b on the right */}
          <span className="mt-2 block">
            <span className="relative block h-2 rounded-full" style={{ background: `linear-gradient(to right, ${seatColor("a")}, var(--border) 50%, ${seatColor("b")})` }}>
              <span className="absolute top-1/2 block h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--foreground)] ring-2 ring-[var(--panel)]" style={{ left: `${pos}%` }} />
            </span>
            <span className="mt-1 flex justify-between text-[0.68rem] text-[var(--muted)]">
              <span>{who.a} · {sides.a}</span>
              <span>{who.b} · {sides.b}</span>
            </span>
          </span>
          <span className="mt-2 block text-[0.8rem] leading-snug">{v.summary}</span>
          {v.reasons.length > 0 && (
            <span className="mt-2 block space-y-1">
              {v.reasons.slice(0, 4).map((r, i) => {
                const meta = REASON_LABEL[r.kind] ?? { label: r.kind, good: false };
                return (
                  <span key={i} className="flex items-start gap-1.5 text-[0.75rem] leading-snug">
                    <span className={`mt-px shrink-0 rounded px-1 text-[0.65rem] font-semibold ${meta.good ? "bg-[var(--wa-green)]/15 text-[var(--wa-green)]" : "bg-red-500/15 text-red-600 dark:text-red-400"}`}>
                      {meta.label}
                    </span>
                    <span>
                      <span className="font-medium" style={{ color: seatColor(r.side) }}>{who[r.side]}</span>: {r.note}
                    </span>
                  </span>
                );
              })}
            </span>
          )}
        </>
      )}
      <span className="mt-2 block border-t border-[var(--border)] pt-2 text-[0.68rem] text-[var(--muted)]">
        {leaning ? `As of answer ${leaning.afterAnswer}. ` : ""}The debaters never see this.
      </span>
    </span>
  );
}

function CoinFlip({ winner, names, sides }: { winner: Debater; names: Record<Debater, string>; sides: Record<Debater, string> }) {
  // Several full turns, landing on the winner's face: A is the front (0deg), B the back (180deg).
  const end = winner === "a" ? "1800deg" : "1980deg";
  return (
    <div className="my-2 flex flex-col items-center gap-2" role="status" aria-label={`Coin flip: ${names[winner]} opens`}>
      <div className="coin-stage h-28 pt-6">
        <div className="coin-toss">
          <div className="coin" style={{ "--coin-end": end } as React.CSSProperties}>
            {(["a", "b"] as const).map((s) => (
              <div
                key={s}
                className={`coin-face ${s === "b" ? "coin-back" : ""}`}
                style={{ background: seatColor(s) }}
              >
                <span className="max-w-[72px] truncate text-sm font-semibold leading-tight">{names[s]}</span>
                <span className="max-w-[72px] truncate text-[0.6rem] opacity-80">{sides[s]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="coin-result rounded-md bg-[var(--panel)] px-2.5 py-1 text-xs font-medium shadow-[var(--bubble-shadow)]">
        Coin flip: <span style={{ color: seatColor(winner) }}>{names[winner]}</span> opens
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
        className={`rounded-lg px-3.5 py-2.5 shadow-[var(--bubble-shadow)] ${right ? "rounded-br-none bg-[var(--bubble-out)]" : "rounded-bl-none bg-[var(--bubble-in)]"
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
        className={`max-w-[90%] rounded-lg px-3 py-1.5 text-center text-xs shadow-[var(--bubble-shadow)] ${tone === "error" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-[var(--panel)] text-[var(--muted)]"
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

function CruxDot({ favours }: { favours: CruxState["favours"] }) {
  return (
    <span
      aria-hidden
      className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-[var(--border)]"
      style={{ background: favours === "open" ? "transparent" : seatColor(favours) }}
    />
  );
}

/** Slim bar under the header: who has won each deciding question so far. Click for details. */
function Scoreboard({ cruxes, who }: { cruxes: CruxState[]; who: Record<Seat, string> }) {
  const [open, setOpen] = useState(false);
  const a = cruxes.filter((c) => c.favours === "a").length;
  const b = cruxes.filter((c) => c.favours === "b").length;
  return (
    <div className="border-b border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-1.5 text-left text-xs"
      >
        <span className="text-[var(--muted)]">Deciding questions</span>
        <span className="flex items-center gap-1">
          {cruxes.map((c, i) => (
            <CruxDot key={i} favours={c.favours} />
          ))}
        </span>
        <span className="tabular-nums">
          <span className="font-semibold" style={{ color: seatColor("a") }}>{who.a} {a}</span>
          <span className="text-[var(--muted)]"> · </span>
          <span className="font-semibold" style={{ color: seatColor("b") }}>{who.b} {b}</span>
          <span className="text-[var(--muted)]"> · open {cruxes.length - a - b}</span>
        </span>
        <span className="ml-auto text-[var(--muted)]">{open ? "Hide" : "Details"}</span>
      </button>
      {open && (
        <ol className="mx-auto max-w-3xl space-y-1 px-4 pb-2 text-xs">
          {cruxes.map((c, i) => (
            <li key={i} className="flex gap-2">
              <CruxDot favours={c.favours} />
              <span>
                <span className="font-medium">{i + 1}. {c.question}</span>{" "}
                <span style={{ color: c.favours === "open" ? undefined : seatColor(c.favours) }}>
                  · {c.favours === "open" ? "open" : who[c.favours]}
                </span>
                {c.note ? <span className="text-[var(--muted)]"> · {c.note}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function VerdictCard({
  verdict,
  who,
  side,
  scoreboard,
}: {
  verdict: Verdict;
  who: Record<Seat, string>;
  side: Record<Seat, string>;
  scoreboard: CruxState[];
}) {
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
              {winner === "draw"
                ? "Both equally right"
                : verdict.oneRight
                  ? `${who[winner]} (${side[winner]}) is right`
                  : `${who[winner]} (${side[winner]}) is more right`}
            </p>
          </div>
        </div>
        <div className="space-y-3 px-4 py-3 text-sm">
          {verdict.confidence && (
            <p className="text-xs text-[var(--muted)]">
              Confidence: <span className="font-medium text-[var(--foreground)]">{verdict.confidence}</span>
            </p>
          )}
          <p className="leading-relaxed">{verdict.reason}</p>
          <List title="Left unanswered" items={verdict.unanswered} />
          <List title="Concessions" items={verdict.concessions} />
          {scoreboard.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-[var(--muted)]">Deciding questions</p>
              <ol className="space-y-1">
                {scoreboard.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <CruxDot favours={c.favours} />
                    <span>
                      {c.question}{" "}
                      <span className="font-medium" style={{ color: c.favours === "open" ? undefined : seatColor(c.favours) }}>
                        · {c.favours === "open" ? "open" : who[c.favours]}
                      </span>
                      {c.note ? <span className="text-[var(--muted)]"> · {c.note}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
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
