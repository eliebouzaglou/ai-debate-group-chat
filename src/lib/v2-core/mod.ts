import { PLAN_CHECK_SYSTEM } from "../constants/prompts";
import {
  analysisFromBrief,
  analystPrompt,
  askModeratorSystem,
  cruxRulingPrompt,
  decisionPrompt,
  describeBrief,
  moderatorSystem,
  openingPrompt,
  planCheckPrompt,
  verdictPrompt,
  type QA,
} from "../prompts";
import { sanitize as sanitizeText } from "../sanitize";
import {
  ContextBriefSchema,
  CRUX_COUNT,
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
} from "../types";
import { LLM, type LLMOptions } from "./language-model";

const MODERATOR_MAX_TOKENS = 4000;
const BRIEF_MAX_TOKENS = 8000;
const ASK_MAX_TOKENS = 1200;

export type ModeratorOptions = Omit<LLMOptions, "systemPrompt">;

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
      systemPrompt: moderatorSystem(config),
      maxTokens: options.maxTokens ?? MODERATOR_MAX_TOKENS,
    });
    this.config = config;
  }

  // ── backstage ──────────────────────────────────────────────────────────────

  /** Write the context brief; appends to mod history. Surfaces describeBrief via onDelta. */
  async writeBrief(): Promise<ContextBrief> {
    const rawBrief = (await this.json(ContextBriefSchema, analystPrompt(this.config), {
      maxTokens: BRIEF_MAX_TOKENS,
    })) as ContextBrief;

    const cruxes = rawBrief.cruxes.map((c) => c.trim()).filter(Boolean).slice(0, CRUX_COUNT);
    const brief: ContextBrief = {
      ...rawBrief,
      cruxes: cruxes.length ? cruxes : [rawBrief.kindReason || this.config.topic],
    };
    this.brief = brief;
    this.analysis = analysisFromBrief(brief);
    this.onDelta?.(describeBrief(brief));
    return brief;
  }

  /** Empty scoreboard rows from the brief's deciding questions. */
  initialScoreboard(): CruxState[] {
    if (!this.brief) throw new Error("Moderator.initialScoreboard() needs writeBrief() first.");
    return this.brief.cruxes.map((question) => ({ question, favours: "open" as const, note: "" }));
  }

  /** Fact-check a side's draft plan (ephemeral; uses PLAN_CHECK_SYSTEM). */
  async checkPlan(seat: Side, draft: string): Promise<string> {
    return this.completeOnce(planCheckPrompt(this.config, seat, draft), {
      instructions: PLAN_CHECK_SYSTEM,
    });
  }

  // ── rapid fire ─────────────────────────────────────────────────────────────

  /** Score a rapid-fire trap against the scoreboard; uses this.brief's referee standard. */
  async ruleTrap(
    asker: Side,
    qa: QA[],
    spring: string,
    reply: string,
    check: SelfCheck,
    scoreboard: CruxState[],
  ): Promise<CruxRuling> {
    if (!this.brief) throw new Error("Moderator.ruleTrap() needs writeBrief() first.");
    return this.json(
      CruxRulingSchema,
      cruxRulingPrompt(
        this.config,
        asker,
        qa,
        spring,
        reply,
        check,
        scoreboard,
        this.brief.refereeStandard,
      ),
    );
  }

  // ── long debate ────────────────────────────────────────────────────────────

  /** Note that rapid fire ended without a knockout, then stream the opening. */
  async open(opener: Side, rulings: string[]): Promise<string> {
    this.push(
      {
        role: "user",
        content: `Rapid fire is done and nobody won it outright. Rulings:\n${rulings.join("\n")}\nHold both sides to their yes/no answers in the debate.`,
      },
      { role: "assistant", content: "Noted. Opening the debate." },
    );
    return this.stream(openingPrompt(this.config, opener));
  }

  /** Decide after a debater's answer; appends to mod history. */
  async decide(
    speaker: Side,
    answer: string,
    round: number,
    scoreboard: CruxState[],
  ): Promise<ModeratorDecision> {
    return this.json(
      ModeratorDecisionSchema,
      decisionPrompt(this.config, speaker, answer, round, scoreboard),
    );
  }

  /** Clean AI-tell phrasing from a debater's answer (for the opponent's relay). */
  async sanitize(text: string): Promise<string> {
    return sanitizeText(text, this.resolveModel(), this.abortSignal, (usage) => {
      this.reportUsage(usage);
    });
  }

  // ── verdict + Q&A ──────────────────────────────────────────────────────────

  /** Final judgment from the transcript; uses this.analysis + this.brief. */
  async verdict(transcript: string, scoreboard: CruxState[]): Promise<Verdict> {
    if (!this.brief || !this.analysis) {
      throw new Error("Moderator.verdict() needs writeBrief() first.");
    }
    const oneRight = this.analysis.kind === "one_right";
    return this.jsonOnce(
      oneRight ? VerdictNoDrawSchema : VerdictSchema,
      verdictPrompt(this.config, transcript, this.analysis, scoreboard, this.brief.refereeStandard),
      {
        instructions:
          "You are an impartial judge. Your job is to decide which side of the motion is correct, not who debated better.",
      },
    ) as Promise<Verdict>;
  }

  /**
   * Arm post-debate Q&A (idempotent). Swaps system prompt and clears debate history.
   * Call once before ask(); subsequent asks keep accumulating on this seat.
   */
  ensureAsk(verdict: Verdict, transcript: string): void {
    if (this.askReady) return;
    this.setSystem(askModeratorSystem(this.config, verdict, transcript));
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
}
