import {
  ANALYST_PROMPT,
  ASK_MODERATOR_SYSTEM,
  CRUX_RULING_PROMPT,
  DECISION_PROMPT,
  MODERATOR_SYSTEM,
  OPENING_PROMPT,
  PLAN_CHECK_PROMPT,
  PLAN_CHECK_SYSTEM,
  VERDICT_PROMPT,
} from "@/constants/prompts";
import { sanitize as sanitizeText } from "../sanitize";
import { answerLimit, CRUX_COUNT } from "@/constants/debate";
import {
  ContextBriefSchema,
  CruxRulingSchema,
  ModeratorDecisionSchema,
  type ContextBrief,
  type CruxRuling,
  type CruxState,
  type DebateConfig,
  type Debater as Side,
  type ModeratorDecision,
  type SelfCheck,
  type TopicAnalysis,
  type Verdict,
  VerdictNoDrawSchema,
  VerdictSchema,
} from "@/types";
import { names } from "@/utils/persona";
import type { QA } from "./debater";
import { LLM, type LLMOptions } from "./language-model";

const MODERATOR_MAX_TOKENS = 4000;
const BRIEF_MAX_TOKENS = 8000;
const ASK_MAX_TOKENS = 1200;

export type ModeratorOptions = Omit<LLMOptions, "systemPrompt">;

const other = (seat: Side): Side => (seat === "a" ? "b" : "a");

function sides(config: DebateConfig, seat: Side) {
  const me = seat === "a" ? config.sideA.label : config.sideB.label;
  const them = seat === "a" ? config.sideB.label : config.sideA.label;
  const n = names(config);
  return { me, them, myName: n[seat], theirName: n[seat === "a" ? "b" : "a"] };
}

/**
 * The referee seat: brief, plan check, rulings, opening, decisions, verdict, Q&A.
 *
 *   const mod = new Moderator(config, { keys, abortSignal, onDelta, onUsage });
 *   const brief = await mod.writeBrief();
 *   const opening = await mod.open(opener);
 */
export class Moderator extends LLM {
  readonly config: DebateConfig;
  brief: ContextBrief | null = null;
  analysis: TopicAnalysis | null = null;

  private askReady = false;

  constructor(config: DebateConfig, options: ModeratorOptions) {
    super(config.moderatorModel, {
      ...options,
      systemPrompt: Moderator.systemPrompt(config),
      maxTokens: options.maxTokens ?? MODERATOR_MAX_TOKENS,
    });
    this.config = config;
  }

  // ── backstage ──────────────────────────────────────────────────────────────

  async writeBrief(): Promise<ContextBrief> {
    const rawBrief = (await this.json(ContextBriefSchema, this.analystPrompt(), {
      maxTokens: BRIEF_MAX_TOKENS,
    })) as ContextBrief;

    const cruxes = rawBrief.cruxes.map((c) => c.trim()).filter(Boolean).slice(0, CRUX_COUNT);
    const brief: ContextBrief = {
      ...rawBrief,
      cruxes: cruxes.length ? cruxes : [rawBrief.kindReason || this.config.topic],
    };
    this.brief = brief;
    this.analysis = {
      kind: brief.kind,
      reasoning: brief.kindReason,
      decidingQuestion: brief.cruxes.join(" / "),
    };
    this.onDelta?.(this.briefCardText(brief));
    return brief;
  }

  /** Viewer-facing brief card text (also streamed via onDelta from writeBrief). */
  briefCardText(brief: ContextBrief = this.brief!): string {
    const kind = brief.kind === "one_right" ? "Only one side can be right." : "Both sides can be partly right.";
    return [
      `${kind} ${brief.kindReason.trim()}`,
      ``,
      `Deciding questions:`,
      ...brief.cruxes.map((c, i) => `${i + 1}. ${c}`),
      ``,
      `Referee standard: ${brief.refereeStandard.trim()}`,
    ].join("\n");
  }

  initialScoreboard(): CruxState[] {
    if (!this.brief) throw new Error("Moderator.initialScoreboard() needs writeBrief() first.");
    return this.brief.cruxes.map((question) => ({ question, favours: "open" as const, note: "" }));
  }

  async checkPlan(seat: Side, draft: string): Promise<string> {
    const { me, them, myName, theirName } = sides(this.config, seat);
    return this.completeOnce(
      PLAN_CHECK_PROMPT({ myName, me, theirName, them, topic: this.config.topic, plan: draft }),
      { instructions: PLAN_CHECK_SYSTEM },
    );
  }

  // ── rapid fire ─────────────────────────────────────────────────────────────

  async ruleTrap(
    asker: Side,
    qa: QA[],
    spring: string,
    reply: string,
    check: SelfCheck,
    scoreboard: CruxState[],
  ): Promise<CruxRuling> {
    if (!this.brief) throw new Error("Moderator.ruleTrap() needs writeBrief() first.");
    const n = names(this.config);
    const answerer = other(asker);
    const label = (s: Side) => (s === "a" ? this.config.sideA.label : this.config.sideB.label);
    return this.json(
      CruxRulingSchema,
      CRUX_RULING_PROMPT({
        asker: n[asker],
        askerSide: asker,
        askerLabel: label(asker),
        answerer: n[answerer],
        answererLabel: label(answerer),
        scoreboard: this.formatScoreboard(scoreboard),
        standard: this.brief.refereeStandard,
        qa,
        spring,
        reply,
        check: { verdict: check.verdict, mistake: check.mistake },
      }),
    );
  }

  // ── long debate ────────────────────────────────────────────────────────────

  async open(opener: Side, rulings: string[]): Promise<string> {
    this.push(
      {
        role: "user",
        content: `Rapid fire is done and nobody won it outright. Rulings:\n${rulings.join("\n")}\nHold both sides to their yes/no answers in the debate.`,
      },
      { role: "assistant", content: "Noted. Opening the debate." },
    );
    const n = names(this.config);
    return this.stream(
      OPENING_PROMPT({
        firstName: n[opener],
        firstLabel: opener === "a" ? this.config.sideA.label : this.config.sideB.label,
      }),
    );
  }

  async decide(
    speaker: Side,
    answer: string,
    round: number,
    scoreboard: CruxState[],
  ): Promise<ModeratorDecision> {
    const n = names(this.config);
    const o = other(speaker);
    const label = (s: Side) => (s === "a" ? this.config.sideA.label : this.config.sideB.label);
    const limit = answerLimit();
    return this.json(
      ModeratorDecisionSchema,
      DECISION_PROMPT({
        scoreboard: this.formatScoreboard(scoreboard),
        round,
        speakerName: n[speaker],
        speakerLabel: label(speaker),
        otherName: n[o],
        otherLabel: label(o),
        answer,
        last: round >= limit,
      }),
    );
  }

  async sanitize(text: string): Promise<string> {
    return sanitizeText(text, this.resolveModel(), this.abortSignal, (usage) => {
      this.reportUsage(usage);
    });
  }

  // ── verdict + Q&A ──────────────────────────────────────────────────────────

  async verdict(transcript: string, scoreboard: CruxState[]): Promise<Verdict> {
    if (!this.brief || !this.analysis) {
      throw new Error("Moderator.verdict() needs writeBrief() first.");
    }
    const oneRight = this.analysis.kind === "one_right";
    const n = names(this.config);
    const kind =
      this.analysis.kind === "one_right" ? "Only one side can be right." : "Both sides can be partly right.";
    const analysisLine = `${kind} ${this.analysis.reasoning.trim()} Deciding questions: ${this.analysis.decidingQuestion.trim()}`;
    return this.jsonOnce(
      oneRight ? VerdictNoDrawSchema : VerdictSchema,
      VERDICT_PROMPT({
        scoreboard: this.formatScoreboard(scoreboard),
        standard: this.brief.refereeStandard,
        oneRight,
        analysis: analysisLine,
        a: n.a,
        b: n.b,
        sideA: this.config.sideA.label,
        sideB: this.config.sideB.label,
        transcript,
      }),
      {
        instructions:
          "You are an impartial judge. Your job is to decide which side of the motion is correct, not who debated better.",
      },
    ) as Promise<Verdict>;
  }

  ensureAsk(verdict: Verdict, transcript: string): void {
    if (this.askReady) return;
    const n = names(this.config);
    const winnerLabel =
      verdict.winner === "draw"
        ? "Both sides equally right"
        : `${n[verdict.winner]} (${verdict.winner === "a" ? this.config.sideA.label : this.config.sideB.label}) is right`;
    this.setSystem(
      ASK_MODERATOR_SYSTEM({
        mod: n.mod,
        a: n.a,
        b: n.b,
        sideA: this.config.sideA.label,
        sideB: this.config.sideB.label,
        topic: this.config.topic,
        winnerLabel,
        reason: verdict.reason,
        unanswered: verdict.unanswered,
        concessions: verdict.concessions,
        transcript,
      }),
    );
    this.clearHistory();
    this.maxTokens = ASK_MAX_TOKENS;
    this.askReady = true;
  }

  async ask(question: string): Promise<string> {
    if (!this.askReady) {
      throw new Error("Moderator.ask() needs ensureAsk(verdict, transcript) first.");
    }
    return (await this.stream(question)) || "(no answer)";
  }

  // ── prompts (owned by this seat) ───────────────────────────────────────────

  private static systemPrompt(config: DebateConfig): string {
    const n = names(config);
    return MODERATOR_SYSTEM({
      mod: n.mod,
      a: n.a,
      b: n.b,
      topic: config.topic,
      sideA: config.sideA.label,
      sideB: config.sideB.label,
    });
  }

  private analystPrompt(): string {
    const n = names(this.config);
    return ANALYST_PROMPT({
      topic: this.config.topic,
      a: n.a,
      b: n.b,
      sideA: this.config.sideA.label,
      sideB: this.config.sideB.label,
      cruxCount: CRUX_COUNT,
    });
  }

  private formatScoreboard(cruxes: CruxState[]): string {
    const n = names(this.config);
    return cruxes
      .map((c, i) => {
        const who = c.favours === "open" ? "open" : `favours ${n[c.favours]} (side "${c.favours}")`;
        return `${i + 1}. ${c.question} — ${who}${c.note ? `: ${c.note}` : ""}`;
      })
      .join("\n");
  }
}
