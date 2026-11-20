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
  planIsClean,
  verdictPrompt,
  type QA,
} from "../prompts";
import { regexSanitize, sanitize as sanitizeText } from "../sanitize";
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

  /** Fact-check a side's draft plan (ephemeral; uses PLAN_CHECK_SYSTEM). */
  async checkPlan(seat: Side, draft: string): Promise<string> {
    return this.completeOnce(planCheckPrompt(this.config, seat, draft), {
      instructions: PLAN_CHECK_SYSTEM,
    });
  }

  planLooksClean(notes: string): boolean {
    return planIsClean(notes);
  }

  // ── rapid fire ─────────────────────────────────────────────────────────────

  /** Score a rapid-fire trap against the scoreboard; appends to mod history. */
  async ruleTrap(
    asker: Side,
    qa: QA[],
    spring: string,
    reply: string,
    check: SelfCheck,
    scoreboard: CruxState[],
    standard: string,
  ): Promise<CruxRuling> {
    return this.json(
      CruxRulingSchema,
      cruxRulingPrompt(this.config, asker, qa, spring, reply, check, scoreboard, standard),
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
      this.onUsage?.({
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        costUsd: LLM.estimateCost(this.modelId, usage.inputTokens ?? 0, usage.outputTokens ?? 0),
        usage,
      });
    });
  }

  /** Strip obvious AI tells without a model call. */
  sanitizeQuick(text: string): string {
    return regexSanitize(text);
  }

  // ── verdict + Q&A ──────────────────────────────────────────────────────────

  /** Final judgment from the transcript (ephemeral; does not use mod history). */
  async verdict(
    transcript: string,
    analysis: TopicAnalysis,
    scoreboard: CruxState[],
    standard: string,
  ): Promise<Verdict> {
    const oneRight = analysis.kind === "one_right";
    return this.jsonOnce(
      oneRight ? VerdictNoDrawSchema : VerdictSchema,
      verdictPrompt(this.config, transcript, analysis, scoreboard, standard),
      {
        instructions:
          "You are an impartial judge. Your job is to decide which side of the motion is correct, not who debated better.",
      },
    ) as Promise<Verdict>;
  }

  /**
   * Post-debate viewer Q&A. Swaps system prompt to the ask context;
   * subsequent ask() turns append to this seat's history.
   */
  beginAsk(verdict: Verdict, transcript: string): void {
    this.setSystem(askModeratorSystem(this.config, verdict, transcript));
    this.history.length = 0;
    this.maxTokens = 1200;
  }

  async ask(question: string): Promise<string> {
    return (await this.stream(question)) || "(no answer)";
  }
}
