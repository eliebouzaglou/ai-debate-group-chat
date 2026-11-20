import {
  DEBATER_SYSTEM,
  PLAN_SECTION,
  RAPID_FIRE_ANSWER_PROMPT,
  RAPID_FIRE_COMMITMENTS,
  RAPID_FIRE_NEXT_PROMPT,
  RAPID_FIRE_SPRING_PROMPT,
} from "@/constants/prompts";
import { RAPID_FIRE_COUNT } from "@/config";
import {
  RapidFireNextSchema,
  YesNoSchema,
  type DebateConfig,
  type Debater as Side,
} from "@/types";
import { names } from "@/utils/persona";
import { Coach, type QA } from "./coach";
import { LLM, type LLMOptions } from "./language-model";

export type { PrepResult, TrapResolution, QA } from "./coach";

const DEBATER_MAX_TOKENS = 8000;

export type DebaterOptions = Omit<LLMOptions, "systemPrompt">;

export type RapidFireExchange = {
  asker: Side;
  question: string;
  answer: "yes" | "no";
};

function sides(config: DebateConfig, seat: Side) {
  const me = seat === "a" ? config.sideA.label : config.sideB.label;
  const them = seat === "a" ? config.sideB.label : config.sideA.label;
  const n = names(config);
  return { me, them, myName: n[seat], theirName: n[seat === "a" ? "b" : "a"] };
}

/**
 * One debate seat (side a or b): private history, battle plan, rapid-fire, answers.
 * Prep / trap self-check live on `this.coach` (same model, COACH_SYSTEM).
 *
 *   const { draft, plan } = await a.coach.prepare(brief, (d) => mod.checkPlan("a", d));
 *   a.pinPlan(plan);
 *   const answer = await a.answer(relay);
 */
export class Debater extends LLM {
  readonly seat: Side;
  readonly config: DebateConfig;
  readonly coach: Coach;
  plan = "";

  constructor(config: DebateConfig, seat: Side, options: DebaterOptions) {
    super(config.debaterModel, {
      ...options,
      systemPrompt: Debater.systemPrompt(config, seat),
      maxTokens: options.maxTokens ?? DEBATER_MAX_TOKENS,
    });
    this.config = config;
    this.seat = seat;
    // Same keys / model / delta / usage wiring as this seat.
    this.coach = new Coach(config, seat, options);
  }

  /** Pin the coach's plan into debater instructions for the rest of the debate. */
  pinPlan(plan: string): void {
    this.plan = plan;
    this.coach.plan = plan;
    this.setSystem(Debater.systemPrompt(this.config, this.seat) + PLAN_SECTION(plan));
  }

  /** Pin rapid-fire yes/no commitments into instructions. */
  pinRapidFire(exchanges: RapidFireExchange[]): void {
    const asked = exchanges.filter((e) => e.asker === this.seat);
    const answered = exchanges.filter((e) => e.asker !== this.seat);
    const blocks = [
      asked.length
        ? `You asked:\n${asked.map((e, i) => `${i + 1}. ${e.question} → they said ${e.answer}.`).join("\n")}`
        : "",
      answered.length
        ? `They asked you:\n${answered.map((e, i) => `${i + 1}. ${e.question} → you said ${e.answer}.`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    this.setSystem(this.systemPrompt + RAPID_FIRE_COMMITMENTS(blocks));
  }

  // ── rapid fire (this seat speaking) ────────────────────────────────────────

  async nextRapidFireQuestion(qa: QA[]): Promise<{ question: string; ready: boolean }> {
    return this.jsonOnce(
      RapidFireNextSchema,
      RAPID_FIRE_NEXT_PROMPT({
        theirName: sides(this.config, this.seat).theirName,
        max: RAPID_FIRE_COUNT,
        qa,
      }),
    );
  }

  async answerRapidFire(
    asker: Side,
    question: string,
    index: number,
    total: number = RAPID_FIRE_COUNT,
  ): Promise<"yes" | "no"> {
    const { me } = sides(this.config, this.seat);
    const result = await this.jsonOnce(
      YesNoSchema,
      RAPID_FIRE_ANSWER_PROMPT({
        question,
        theirName: names(this.config)[asker],
        me,
        index,
        total,
      }),
    );
    return result.answer;
  }

  async spring(qa: QA[]): Promise<string> {
    return (
      (await this.streamOnce(
        RAPID_FIRE_SPRING_PROMPT({
          theirName: sides(this.config, this.seat).theirName,
          qa,
        }),
      )) || "(no conclusion)"
    );
  }

  // ── long debate ────────────────────────────────────────────────────────────

  async answer(relay: string): Promise<string> {
    return (await this.stream(relay)) || "(no answer)";
  }

  private static systemPrompt(config: DebateConfig, seat: Side): string {
    const { me, them, myName, theirName } = sides(config, seat);
    return DEBATER_SYSTEM({ myName, theirName, me, them, topic: config.topic });
  }
}
