import type { ModelMessage } from "ai";
import { COACH_SYSTEM } from "../constants/prompts";
import {
  coachPrepPrompt,
  debaterSystem,
  debaterSystemWithPlan,
  planIsClean,
  planRevisePrompt,
  rapidFireAnswerPrompt,
  rapidFireNextPrompt,
  rapidFireSpringPrompt,
  selfCheckPrompt,
  withRapidFireCommitments,
  type QA,
  type RapidFireExchange,
} from "../prompts";
import {
  RAPID_FIRE_COUNT,
  RapidFireNextSchema,
  SelfCheckSchema,
  YesNoSchema,
  type ContextBrief,
  type DebateConfig,
  type Debater as Side,
  type SelfCheck,
} from "../types";
import { LLM, type LLMOptions } from "./language-model";

const DEBATER_MAX_TOKENS = 8000;

export type DebaterOptions = Omit<LLMOptions, "systemPrompt">;

/**
 * One debate seat (side a or b): private history, battle plan, rapid-fire, answers.
 *
 *   const a = new Debater(config, "a", { keys, abortSignal, onDelta, onUsage });
 *   const plan = await a.prepare(brief);
 *   const answer = await a.answer(relayMessage);
 */
export class Debater extends LLM {
  readonly seat: Side;
  readonly config: DebateConfig;
  plan = "";

  constructor(config: DebateConfig, seat: Side, options: DebaterOptions) {
    super(config.debaterModel, {
      ...options,
      systemPrompt: debaterSystem(config, seat),
      maxTokens: options.maxTokens ?? DEBATER_MAX_TOKENS,
    });
    this.config = config;
    this.seat = seat;
  }

  // ── coach prep (ephemeral — does not touch debate history) ─────────────────

  /** Draft a battle plan from this side's slice of the brief. */
  async draftPlan(brief: ContextBrief): Promise<string> {
    const text =
      (await this.streamOnce(coachPrepPrompt(this.config, this.seat, brief), {
        instructions: COACH_SYSTEM,
      })) || "(no plan)";
    return text;
  }

  /** One revision pass after the fact-checker returns notes. */
  async revisePlan(draft: string, notes: string, brief: ContextBrief): Promise<string> {
    const prep: ModelMessage[] = [
      { role: "user", content: coachPrepPrompt(this.config, this.seat, brief) },
      { role: "assistant", content: draft },
    ];
    const revised = await this.completeOnce(planRevisePrompt(notes), {
      instructions: COACH_SYSTEM,
      messages: prep,
    });
    return revised || draft;
  }

  /** Draft → (caller fact-checks) → optional revise → pin into system prompt. */
  async prepare(brief: ContextBrief, factCheck: (draft: string) => Promise<string>): Promise<string> {
    const draft = await this.draftPlan(brief);
    const notes = await factCheck(draft);
    let plan = draft;
    if (notes && !planIsClean(notes)) {
      plan = await this.revisePlan(draft, notes, brief);
    }
    this.pinPlan(plan);
    return plan;
  }

  /** Pin the final plan into instructions for the rest of the debate. */
  pinPlan(plan: string): void {
    this.plan = plan;
    this.setSystem(debaterSystemWithPlan(this.config, this.seat, plan));
  }

  /** Pin rapid-fire yes/no commitments into instructions. */
  pinRapidFire(exchanges: RapidFireExchange[]): void {
    this.setSystem(withRapidFireCommitments(this.systemPrompt, this.seat, exchanges));
  }

  // ── rapid fire (ephemeral) ─────────────────────────────────────────────────

  /** Pick the next yes/no question, or stop early when ready. */
  async nextRapidFireQuestion(qa: QA[]): Promise<{ question: string; ready: boolean }> {
    return this.jsonOnce(RapidFireNextSchema, rapidFireNextPrompt(this.config, this.seat, qa));
  }

  /** Answer one rapid-fire question with yes or no. */
  async answerRapidFire(
    asker: Side,
    question: string,
    index: number,
    total: number = RAPID_FIRE_COUNT,
  ): Promise<"yes" | "no"> {
    const result = await this.jsonOnce(
      YesNoSchema,
      rapidFireAnswerPrompt(this.config, this.seat, asker, question, index, total),
    );
    return result.answer;
  }

  /** Spring the trap after the yes/no chain. */
  async spring(qa: QA[]): Promise<string> {
    return (
      (await this.streamOnce(rapidFireSpringPrompt(this.config, this.seat, qa))) || "(no conclusion)"
    );
  }

  /** Private coach check: beaten or not, and the public reply. */
  async selfCheck(qa: QA[], spring: string): Promise<SelfCheck> {
    return this.jsonOnce(SelfCheckSchema, selfCheckPrompt(this.config, this.seat, qa, spring), {
      instructions: `${COACH_SYSTEM}\n\nFor reference, the battle plan you wrote with your client before the debate:\n${this.plan}`,
    });
  }

  // ── long debate (uses private history) ─────────────────────────────────────

  /** Stream one debate answer; appends to this seat's history. */
  async answer(relay: string): Promise<string> {
    return (await this.stream(relay)) || "(no answer)";
  }
}
