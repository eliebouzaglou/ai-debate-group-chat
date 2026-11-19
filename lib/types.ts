import { z } from "zod";
import { MODEL_IDS } from "./models";

export const ModelIdSchema = z.enum(MODEL_IDS);

export const SideSchema = z.object({ label: z.string().trim().min(1).max(60) });

export const DebateConfigSchema = z.object({
  topic: z.string().trim().min(3).max(500),
  sideA: SideSchema,
  sideB: SideSchema,
  debaterModel: ModelIdSchema,
  moderatorModel: ModelIdSchema,
});
export type DebateConfig = z.infer<typeof DebateConfigSchema>;

/** Hard stop so two stubborn models can't spend forever. Debates otherwise run until a concession or an unanswered decisive point. */
export const ANSWER_CAP = 30;

/** Safety answer limit for a debate. */
export function answerLimit(): number {
  return ANSWER_CAP;
}

/** Plain-text check for an explicit concession ("I concede"), ignoring "I won't concede" etc. */
export function hasConcession(text: string): boolean {
  return /(^|[^a-z'])i concede\b(?!\s+(nothing|no\b|none|only|that\b|this\b|one\b))/i.test(text) &&
    !/\b(won'?t|will not|never|don'?t|do not|not going to)\s+concede\b/i.test(text);
}

export const ApiKeysSchema = z.object({
  anthropic: z.string().optional(),
  openai: z.string().optional(),
  openrouter: z.string().optional(),
});

export const DebateRequestSchema = z.object({
  config: DebateConfigSchema,
  keys: ApiKeysSchema,
});

export type Seat = "mod" | "a" | "b";
export type Debater = "a" | "b";

export const FactCheckStatusSchema = z.enum(["clean", "unsupported", "wrong", "fake"]);
export type FactCheckStatus = z.infer<typeof FactCheckStatusSchema>;

/** Who a deciding question currently favours. */
export const FavoursSchema = z.enum(["a", "b", "open"]);
export type Favours = z.infer<typeof FavoursSchema>;

export const CruxUpdateSchema = z.object({
  favours: FavoursSchema.describe('"a" or "b" if that side has won this deciding question so far, otherwise "open".'),
  note: z.string().describe("Quote the admission, or cite the checked fact, that settled it. Empty if open."),
});
export type CruxUpdate = z.infer<typeof CruxUpdateSchema>;

/** One row of the visible scoreboard. */
export type CruxState = { question: string; favours: Favours; note: string };

export const ModeratorDecisionSchema = z.object({
  factCheck: z.object({
    status: FactCheckStatusSchema.describe(
      'Worst problem with the sources in the latest answer: "fake" (the source does not exist), "wrong" (it exists but does not say that, or the figure, date or author is wrong), "unsupported" (a factual claim with no source, or too vague to check), or "clean".',
    ),
    callout: z
      .string()
      .describe("If not clean: one or two sentences to the speaker, by name, naming the source and exactly what is wrong. Empty if clean."),
  }),
  leaning: z.object({
    toward: z.enum(["a", "b", "even"]).describe("Who is winning the debate so far."),
    margin: z.enum(["slight", "clear", "decisive"]).describe("How far ahead they are. Use \"slight\" when \"even\"."),
    summary: z.string().describe("One sentence on why."),
    reasons: z
      .array(
        z.object({
          kind: z.enum([
            "false_claim",
            "unsupported_claim",
            "unanswered_point",
            "dodged_question",
            "contradiction",
            "trap_landed",
            "concession",
            "stronger_evidence",
            "sounder_reasoning",
          ]),
          side: z.enum(["a", "b"]).describe("The debater this reason is about."),
          note: z.string().describe("A few words of specifics."),
        }),
      )
      .describe("Up to four of the most important reasons, most important first."),
  }),
  cruxes: z
    .array(CruxUpdateSchema)
    .describe("The scoreboard: one entry per deciding question, in order. Keep an entry as it was unless this exchange settled it."),
  action: z.enum(["continue", "end"]),
  question: z.string().describe("Next question for the other debater. Empty if ending."),
  reason: z.string().describe("One sentence on why the debate continues or ends."),
});
export type ModeratorDecision = z.infer<typeof ModeratorDecisionSchema>;
export type Leaning = ModeratorDecision["leaning"];

/** How many deciding questions the backstage brief settles on. */
export const CRUX_COUNT = 3;

/** Backstage brief, written by the moderator before prep. It never reaches the debaters as-is. */
export const ContextBriefSchema = z.object({
  kind: z
    .enum(["one_right", "both_can_be_right"])
    .describe('"one_right" if the two positions contradict each other so at most one can be correct; "both_can_be_right" if both can be partly correct.'),
  kindReason: z.string().describe("Two sentences on why."),
  commitments: z.object({
    a: z.string().describe("What side a is committed to accepting: texts, data, definitions, core claims, with specific references."),
    b: z.string().describe("The same for side b."),
  }),
  sharedGround: z.string().describe("What both sides accept, usable as a neutral authority between them."),
  cruxes: z
    .array(z.string())
    .describe(`Exactly ${CRUX_COUNT} neutral, checkable deciding questions, each with "Settled by:" evidence and which answer favours which side.`),
  weakSpots: z.object({
    a: z.string().describe("Where side a's own commitments are hardest to hold together."),
    b: z.string().describe("The same for side b."),
  }),
  coachBriefs: z.object({
    a: z.string().describe("One paragraph to side a's coach: what the opponent is committed to, and the strongest lines to build traps from."),
    b: z.string().describe("The same for side b's coach. Equally strong."),
  }),
  refereeStandard: z
    .string()
    .describe("The fixed standard for ruling who wins each deciding question, so the same transcript always gets the same ruling."),
});
export type ContextBrief = z.infer<typeof ContextBriefSchema>;

/** The defender's private "did they beat me?" check, from its own coach, plus what it says out loud. */
export const SelfCheckSchema = z.object({
  verdict: z
    .enum(["beaten", "not_beaten"])
    .describe(
      '"beaten": the chain forces my position to fail and I must forfeit. "not_beaten": there is a real hole (false premise or broken step) I can name without taking back an answer.',
    ),
  mistake: z.string().describe("Which of my answers or claims was a mistake, if any, in one sentence. Empty if none."),
  reply: z
    .string()
    .describe(
      'Exactly what I say back, 40 to 110 words of plain speech. If beaten: a short forfeit that includes the words "I concede." If not beaten: name the exact false premise or broken step — no hedging, no "partly."',
    ),
});
export type SelfCheck = z.infer<typeof SelfCheckSchema>;

/** Referee's ruling on one rapid-fire trap, scored per deciding question. */
export const CruxRulingSchema = z.object({
  cruxes: z.array(CruxUpdateSchema).describe("The scoreboard after this exchange: one entry per deciding question, in order."),
  explanation: z.string().describe("Two or three sentences for the audience: the admission, the fact, the step, and which deciding question moved."),
});
export type CruxRuling = z.infer<typeof CruxRulingSchema>;

/** Moderator's private read of the motion, made before the debate starts. */
export const TopicAnalysisSchema = z.object({
  kind: z
    .enum(["one_right", "both_can_be_right"])
    .describe('"one_right" if the two positions contradict each other so at most one can be correct; "both_can_be_right" if both can be partly correct.'),
  reasoning: z.string().describe("Two or three sentences on why."),
  decidingQuestion: z.string().describe("The core question that would settle the debate."),
});
export type TopicAnalysis = z.infer<typeof TopicAnalysisSchema>;

/** How many yes/no questions open every debate. */
/** Most yes/no questions one side may fire in its rapid-fire trap chain. */
export const RAPID_FIRE_COUNT = 5;

/** Asker picks its next rapid-fire question live, after seeing the previous answers. */
export const RapidFireNextSchema = z.object({
  question: z.string().describe("The next single-clause yes/no question. Empty if ready to spring."),
  ready: z.boolean().describe("True when you have the admissions you need and want to spring the trap now."),
});

/** Moderator's ruling on one side's rapid-fire trap. */
export const TrapRulingSchema = z.object({
  result: z
    .enum(["closed", "scored", "escaped"])
    .describe('"closed": the trap holds and the opponent\'s position fails (debate ends). "scored": a real point, but their position survives. "escaped": they showed a false premise, a broken step, or the fact was wrong.'),
  explanation: z.string().describe("Two or three sentences for the audience, naming the key admission, fact and step."),
});
export type TrapResult = z.infer<typeof TrapRulingSchema>["result"];

export const RapidFireQuestionsSchema = z.object({
  questions: z
    .array(z.string().trim().min(5).max(220))
    .min(RAPID_FIRE_COUNT)
    .max(RAPID_FIRE_COUNT + 1)
    .describe(`Exactly ${RAPID_FIRE_COUNT} short yes/no questions to ask the opponent.`),
});
export type RapidFireQuestions = z.infer<typeof RapidFireQuestionsSchema>;

export const YesNoSchema = z.object({
  answer: z.enum(["yes", "no"]).describe("The only allowed answers."),
});
export type YesNo = z.infer<typeof YesNoSchema>;

export const VerdictSchema = z.object({
  winner: z.enum(["a", "b", "draw"]).describe("The side whose position is correct on the motion."),
  reason: z.string().describe("Why that position is correct on the merits: specific facts and reasoning, not debating performance."),
  confidence: z.enum(["low", "medium", "high"]).describe("How sure you are that this position is the correct one."),
  unanswered: z.array(z.string()).describe("Points one side raised that the other never answered, prefixed with who failed to answer."),
  concessions: z.array(z.string()).describe("Explicit or implicit concessions, prefixed with who conceded."),
  cruxes: z
    .array(CruxUpdateSchema)
    .default([])
    .describe("Your final ruling on each deciding question, in order, applying the referee standard."),
});
export type Verdict = z.infer<typeof VerdictSchema> & {
  /** Set by the engine: true when the moderator judged that only one side can be right. */
  oneRight?: boolean;
};

/** Same shape, but "draw" is not an allowed answer: for motions where only one side can be right. */
export const VerdictNoDrawSchema = VerdictSchema.extend({ winner: z.enum(["a", "b"]) });

/** Post-debate question to the moderator about their verdict. */
export const AskModeratorRequestSchema = z.object({
  config: DebateConfigSchema,
  keys: ApiKeysSchema,
  verdict: VerdictSchema,
  transcript: z.string().min(1).max(200_000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8_000),
      }),
    )
    .max(40)
    .default([]),
  question: z.string().trim().min(1).max(2_000),
});

export type TrapStage = "spring" | "check" | "reply" | "ruling";

export type DebateEvent =
  | {
      type: "turn_start";
      seat: Seat;
      round: number;
      /** Private pre-debate game plan. */
      prep?: boolean;
      /** Opening yes/no cross-ex. */
      rapidFire?: boolean;
      /** This turn is the question (not the yes/no answer). */
      rapidFireAsk?: boolean;
      /** Rapid-fire trap stage: the asker's conclusion, the defender's private check, its reply, or the ruling. */
      trap?: TrapStage;
    }
  | { type: "delta"; seat: Seat; text: string }
  | {
      type: "turn_end";
      seat: Seat;
      text: string;
      /** Set when this moderator message is a source fact-check. */
      factCheck?: FactCheckStatus;
      rapidFire?: boolean;
      rapidFireAsk?: boolean;
      trap?: TrapStage;
      trapResult?: TrapResult;
      /** The defender's private verdict on whether it was beaten. */
      checkVerdict?: SelfCheck["verdict"];
    }
  | { type: "scoreboard"; cruxes: CruxState[] }
  | { type: "plan_update"; seat: Debater; text: string; revised: boolean } // plan after the fact-check
  | ({ type: "verdict" } & Verdict)
  | { type: "coin_flip"; winner: Debater }
  | ({ type: "leaning" } & Leaning)
  | { type: "ping" } // keeps the connection alive during long silences
  | { type: "usage"; inputTokens: number; outputTokens: number; costUsd: number } // running totals
  | { type: "error"; message: string }
  | { type: "done" };

/** Alliterative persona name for a side, e.g. "Republican" -> "Rita". */
const NAMES: Record<string, string[]> = {
  a: ["Alex", "Ada"], b: ["Bea", "Boris"], c: ["Cora", "Cal"], d: ["Dana", "Dex"], e: ["Eli", "Esme"],
  f: ["Finn", "Faye"], g: ["Gus", "Greta"], h: ["Hank", "Hazel"], i: ["Ivy", "Ike"], j: ["Jade", "Jules"],
  k: ["Kai", "Kira"], l: ["Leo", "Lena"], m: ["Max", "Mila"], n: ["Nora", "Ned"], o: ["Otto", "Opal"],
  p: ["Pia", "Pete"], q: ["Quinn", "Queenie"], r: ["Rita", "Rex"], s: ["Sam", "Sofia"], t: ["Theo", "Tess"],
  u: ["Uma", "Ugo"], v: ["Vera", "Vic"], w: ["Wes", "Willa"], x: ["Xena", "Xavi"], y: ["Yara", "Yusuf"],
  z: ["Zoe", "Zane"],
};

export function personaName(label: string, seat: Debater, otherLabel?: string): string {
  const letter = label.trim()[0]?.toLowerCase() ?? "x";
  const pool = NAMES[letter] ?? ["Robin", "Morgan"];
  // If both sides start with the same letter, give them different names.
  const clash = otherLabel && otherLabel.trim()[0]?.toLowerCase() === letter;
  return pool[clash && seat === "b" ? 1 : 0];
}

export const MODERATOR_NAME = "Morgan";

export function names(config: DebateConfig) {
  return {
    a: personaName(config.sideA.label, "a", config.sideB.label),
    b: personaName(config.sideB.label, "b", config.sideA.label),
    mod: MODERATOR_NAME,
  };
}
