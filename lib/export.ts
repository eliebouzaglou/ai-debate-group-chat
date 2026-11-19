import { names, type DebateConfig, type Seat, type Verdict } from "./types";
import { getModelInfo } from "./models";

export interface ChatMessage {
  id: string;
  seat: Seat;
  round: number;
  text: string;
  time: string;
  done: boolean;
}

export function toMarkdown(config: DebateConfig, messages: ChatMessage[], verdict: Verdict | null, stopped: boolean): string {
  const n = names(config);
  const who: Record<Seat, string> = {
    mod: `${n.mod} (moderator)`,
    a: `${n.a} (${config.sideA.label})`,
    b: `${n.b} (${config.sideB.label})`,
  };
  const out: string[] = [
    `# ${config.topic}`,
    ``,
    `- **${who.a}** vs **${who.b}**`,
    `- Debaters: ${getModelInfo(config.debaterModel).label} · Moderator: ${getModelInfo(config.moderatorModel).label}`,
    `- Up to ${config.maxRounds} answers`,
    ``,
    `---`,
    ``,
  ];
  for (const m of messages) {
    if (!m.text.trim()) continue;
    const prefix = m.seat !== "mod" && m.round > 0 ? ` · answer ${m.round}` : "";
    out.push(`**${who[m.seat]}**${prefix}`, ``, m.seat === "mod" ? `> ${m.text.replace(/\n/g, "\n> ")}` : m.text, ``);
  }
  if (stopped) out.push(`_Debate stopped early._`, ``);
  if (verdict) {
    const winner = verdict.winner === "draw" ? "Draw" : `${who[verdict.winner]} wins`;
    out.push(`---`, ``, `## Verdict: ${winner}`, ``, verdict.reason, ``);
    if (verdict.unanswered.length) out.push(`### Unanswered points`, ...verdict.unanswered.map((u) => `- ${u}`), ``);
    if (verdict.concessions.length) out.push(`### Concessions`, ...verdict.concessions.map((c) => `- ${c}`), ``);
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
