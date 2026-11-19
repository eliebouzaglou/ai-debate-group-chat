import { names, type CruxState, type DebateConfig, type Seat, type Verdict } from "./types";
import { getModelInfo } from "./models";

export interface ChatMessage {
  id: string;
  /** "you" = viewer asking the moderator about the verdict after the debate. */
  seat: Seat | "you";
  round: number;
  text: string;
  time: string;
  done: boolean;
  /** Private pre-debate game plan, never shown to the opponent or moderator. */
  prep?: boolean;
  /** Moderator fact-check of a source: "unsupported" | "wrong" | "fake". */
  factCheck?: string;
  /** Post-debate Q&A with the moderator about the verdict. */
  ask?: boolean;
  /** Opening yes/no rapid-fire round. */
  rapidFire?: boolean;
  /** Rapid-fire question (vs yes/no answer). */
  rapidFireAsk?: boolean;
  /** Rapid-fire trap stage. */
  trap?: "spring" | "check" | "reply" | "ruling";
  /** The defender's private verdict on a trap. */
  checkVerdict?: "beaten" | "partly" | "not_beaten";
  /** Prep plan has been through the fact-check. */
  checked?: boolean;
  /** Prep plan was revised after the fact-check. */
  revised?: boolean;
  /** Moderator's ruling on a trap. */
  trapResult?: "closed" | "scored" | "escaped";
}

export const TRAP_RESULT_LABEL = { closed: "Trap closed", scored: "Point scored", escaped: "Escaped" } as const;
export const CHECK_LABEL = { beaten: "Beaten", partly: "Partly beaten", not_beaten: "Not beaten" } as const;

export const FACT_CHECK_LABEL: Record<string, string> = {
  fake: "fake source",
  wrong: "wrong source",
  unsupported: "no source",
};

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return "<$0.001";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString("en-US");
}

export function toMarkdown(
  config: DebateConfig,
  messages: ChatMessage[],
  verdict: Verdict | null,
  stopped: boolean,
  usage?: Usage | null,
  openerName?: string | null,
  scoreboard?: CruxState[],
): string {
  const n = names(config);
  const who: Record<Seat | "you", string> = {
    mod: `${n.mod} (moderator)`,
    a: `${n.a} (${config.sideA.label})`,
    b: `${n.b} (${config.sideB.label})`,
    you: "You",
  };
  const out: string[] = [
    `# ${config.topic}`,
    ``,
    `- **${who.a}** vs **${who.b}**`,
    `- Debaters: ${getModelInfo(config.debaterModel).label} · Moderator: ${getModelInfo(config.moderatorModel).label}`,
    config.untilConcession ? `- All the way: until someone concedes` : `- Up to ${config.maxRounds} answers`,
    ...(openerName ? [`- Coin flip: ${openerName} opens`] : []),
    ...(usage
      ? [`- Spent: about ${formatCost(usage.costUsd)} (${(usage.inputTokens + usage.outputTokens).toLocaleString("en-US")} tokens, estimated from list prices)`]
      : []),
    ``,
    `---`,
    ``,
  ];
  const plans = messages.filter((m) => m.prep && m.text.trim());
  if (plans.length) {
    out.push(`## Private prep`, ``, `_Written before the debate. Each debater's plan was seen only by that debater; the moderator's read of the motion only by the moderator._`, ``);
    for (const m of plans) out.push(`### ${who[m.seat]}`, ``, m.text, ``);
    out.push(`---`, ``);
  }
  const rapid = messages.filter((m) => m.rapidFire && m.text.trim());
  if (rapid.length) {
    out.push(`## Rapid fire`, ``, `_Each side fires a chain of yes/no questions, springs its conclusion, gets one reply, and the moderator rules. A closed trap ends the debate._`, ``);
    for (const m of rapid) {
      const tag =
        m.trap === "ruling" && m.trapResult
          ? ` · ruling: ${TRAP_RESULT_LABEL[m.trapResult]}`
          : m.trap === "check"
            ? " · private check (own coach)"
          : m.trap === "spring"
            ? " · springs the trap"
            : m.trap === "reply"
              ? " · replies"
              : m.rapidFireAsk
                ? " · asks"
                : "";
      out.push(`**${who[m.seat as Seat]}${tag}**`, ``, m.seat === "mod" ? `> ${m.text.replace(/\n/g, "\n> ")}` : m.text, ``);
    }
    out.push(`---`, ``);
  }
  if (plans.length || rapid.length) out.push(`## Debate`, ``);
  for (const m of messages) {
    if (m.prep || m.ask || m.rapidFire || !m.text.trim()) continue;
    const prefix = m.seat !== "mod" && m.round > 0 ? ` · answer ${m.round}` : "";
    const label = m.factCheck ? `**${who.mod} · fact check: ${FACT_CHECK_LABEL[m.factCheck] ?? m.factCheck}**` : `**${who[m.seat]}**${prefix}`;
    out.push(label, ``, m.seat === "mod" ? `> ${m.text.replace(/\n/g, "\n> ")}` : m.text, ``);
  }
  if (stopped) out.push(`_Debate stopped early._`, ``);
  if (verdict) {
    const winner =
      verdict.winner === "draw"
        ? "Both equally right"
        : `${who[verdict.winner]} ${verdict.oneRight ? "is right" : "is more right"}`;
    out.push(`---`, ``, `## Verdict: ${winner}`, ``, ...(verdict.confidence ? [`_Confidence: ${verdict.confidence}_`, ``] : []), verdict.reason, ``);
    if (scoreboard?.length) {
      out.push(`### Deciding questions`);
      scoreboard.forEach((c, i) => {
        const r = verdict.cruxes?.[i] ?? c;
        const res = r.favours === "open" ? "open" : who[r.favours as Seat];
        out.push(`${i + 1}. ${c.question} — **${res}**${r.note ? `: ${r.note}` : ""}`);
      });
      out.push(``);
    }
    if (verdict.unanswered.length) out.push(`### Unanswered points`, ...verdict.unanswered.map((u) => `- ${u}`), ``);
    if (verdict.concessions.length) out.push(`### Concessions`, ...verdict.concessions.map((c) => `- ${c}`), ``);
  }
  const asks = messages.filter((m) => m.ask && m.text.trim());
  if (asks.length) {
    out.push(`---`, ``, `## Questions for the moderator`, ``);
    for (const m of asks) {
      out.push(`**${who[m.seat]}**`, ``, m.seat === "mod" ? `> ${m.text.replace(/\n/g, "\n> ")}` : m.text, ``);
    }
  }
  return out.join("\n");
}

export function downloadMarkdown(filename: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "debate";
}
