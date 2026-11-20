import type { ModelMessage } from "ai";
import {
  COACH_PREP_PROMPT,
  COACH_SYSTEM,
  PLAN_REVISE_PROMPT,
  SELF_CHECK_PROMPT,
} from "@/constants/prompts";
import {
  hasConcession,
  names,
  RAPID_FIRE_COUNT,
  SelfCheckSchema,
  type ContextBrief,
  type DebateConfig,
  type Debater as Side,
  type SelfCheck,
} from "../types";
import { LLM, type LLMOptions } from "./language-model";

const COACH_MAX_TOKENS = 8000;

export type CoachOptions = Omit<LLMOptions, "systemPrompt">;

export type QA = { question: string; answer: "yes" | "no" };

export interface PrepResult {
  draft: string;
  plan: string;
  revised: boolean;
}

export interface TrapResolution {
  check: SelfCheck;
  /** Viewer-facing private-check line ("Beaten. …" / "Not beaten"). */
  checkText: string;
  /** Public reply, with forced concession wording when beaten. */
  reply: string;
  conceded: boolean;
}

function sides(config: DebateConfig, seat: Side) {
  const me = seat === "a" ? config.sideA.label : config.sideB.label;
  const them = seat === "a" ? config.sideB.label : config.sideA.label;
  const n = names(config);
  return { me, them, myName: n[seat], theirName: n[seat === "a" ? "b" : "a"] };
}

/**
 * Side coach: same model as the debater, COACH_SYSTEM, ephemeral history.
 * Owned by Debater — not a match seat with its own long-debate thread.
 *
 *   const { draft, plan } = await a.coach.prepare(brief, (d) => mod.checkPlan("a", d));
 *   a.pinPlan(plan);
 *   const { reply, conceded } = await a.coach.resolveTrap(qa, spring);
 */
export class Coach extends LLM {
  readonly seat: Side;
  readonly config: DebateConfig;
  /** Last plan this coach drafted/revised (used for resolveTrap). */
  plan = "";

  constructor(config: DebateConfig, seat: Side, options: CoachOptions) {
    super(config.debaterModel, {
      ...options,
      systemPrompt: COACH_SYSTEM,
      maxTokens: options.maxTokens ?? COACH_MAX_TOKENS,
    });
    this.config = config;
    this.seat = seat;
  }

  async draftPlan(brief: ContextBrief): Promise<string> {
    return (
      (await this.streamOnce(this.prepPrompt(brief))) || "(no plan)"
    );
  }

  async revisePlan(draft: string, notes: string, brief: ContextBrief): Promise<string> {
    const prep: ModelMessage[] = [
      { role: "user", content: this.prepPrompt(brief) },
      { role: "assistant", content: draft },
    ];
    const revised = await this.completeOnce(PLAN_REVISE_PROMPT(notes), { messages: prep });
    return revised || draft;
  }

  /**
   * Draft → fact-check (caller) → optional revise.
   * Does not touch the debater's system prompt — caller should `debater.pinPlan(plan)`.
   */
  async prepare(
    brief: ContextBrief,
    factCheck: (draft: string) => Promise<string>,
  ): Promise<PrepResult> {
    const draft = await this.draftPlan(brief);
    const notes = await factCheck(draft);
    let plan = draft;
    if (notes && !/^\s*no changes needed\.?\s*$/i.test(notes)) {
      plan = await this.revisePlan(draft, notes, brief);
    }
    this.plan = plan;
    return { draft, plan, revised: plan !== draft };
  }

  /** Private "did they beat me?" check + public reply after a rapid-fire spring. */
  async resolveTrap(qa: QA[], spring: string): Promise<TrapResolution> {
    const { me, myName, theirName } = sides(this.config, this.seat);
    const check = await this.jsonOnce(
      SelfCheckSchema,
      SELF_CHECK_PROMPT({ myName, me, theirName, topic: this.config.topic, qa, spring }),
      {
        instructions: `${COACH_SYSTEM}\n\nFor reference, the battle plan you wrote with your client before the debate:\n${this.plan}`,
      },
    );
    const checkLabel = check.verdict === "beaten" ? "Beaten" : "Not beaten";
    const checkText = check.mistake.trim() ? `${checkLabel}. ${check.mistake.trim()}` : checkLabel;
    const conceded = check.verdict === "beaten" || hasConcession(check.reply);
    const reply =
      conceded && !hasConcession(check.reply)
        ? `${check.reply.trim()} I concede.`.trim()
        : check.reply.trim() || "(no reply)";
    return { check, checkText, reply, conceded };
  }

  private prepPrompt(brief: ContextBrief): string {
    const { me, them, myName, theirName } = sides(this.config, this.seat);
    const opp = this.seat === "a" ? "b" : "a";
    const slice = [
      `- What your opponent is committed to: ${brief.commitments[opp]}`,
      `- Shared ground: ${brief.sharedGround}`,
      `- What would actually settle it:\n${brief.cruxes.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}`,
      `- Where your opponent's position is hardest to hold together: ${brief.weakSpots[opp]}`,
      `- Their advice: ${brief.coachBriefs[this.seat]}`,
    ].join("\n");
    return COACH_PREP_PROMPT({
      myName,
      me,
      theirName,
      them,
      topic: this.config.topic,
      brief: slice,
      rapidFireCount: RAPID_FIRE_COUNT,
    });
  }
}
