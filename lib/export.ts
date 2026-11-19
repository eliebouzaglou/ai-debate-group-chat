import { names, type DebateConfig, type Seat, type Verdict } from "./types";
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
}

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
    out.push(`## Rapid fire`, ``, `_Short yes/no questions before the debate opens._`, ``);
    for (const m of rapid) {
      out.push(`**${who[m.seat]}**`, ``, m.seat === "mod" ? `> ${m.text.replace(/\n/g, "\n> ")}` : m.text, ``);
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
    const winner = verdict.winner === "draw" ? "Draw" : `${who[verdict.winner]} wins`;
    out.push(`---`, ``, `## Verdict: ${winner}`, ``, verdict.reason, ``);
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
