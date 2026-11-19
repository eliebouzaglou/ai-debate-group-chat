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
  maxRounds: z.number().int().min(1).max(20),
  /** "All the way": ignore maxRounds and run until someone concedes (with a safety cap). */
  untilConcession: z.boolean().default(false),
});
export type DebateConfig = z.infer<typeof DebateConfigSchema>;

/** Hard stop for "all the way" debates, so two stubborn models can't spend forever. */
export const UNTIL_CONCESSION_CAP = 30;

/** The real answer limit for a debate. */
export function answerLimit(config: DebateConfig): number {
  return config.untilConcession ? UNTIL_CONCESSION_CAP : config.maxRounds;
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
            "more_persuasive",
          ]),
          side: z.enum(["a", "b"]).describe("The debater this reason is about."),
          note: z.string().describe("A few words of specifics."),
        }),
      )
      .describe("Up to four of the most important reasons, most important first."),
  }),
  action: z.enum(["continue", "end"]),
  question: z.string().describe("Next question for the other debater. Empty if ending."),
  reason: z.string().describe("One sentence on why the debate continues or ends."),
});
export type ModeratorDecision = z.infer<typeof ModeratorDecisionSchema>;
export type Leaning = ModeratorDecision["leaning"];

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
export const RAPID_FIRE_COUNT = 3;

export const RapidFireQuestionsSchema = z.object({
  questions: z
    .array(z.string().trim().min(5).max(220))
    .min(RAPID_FIRE_COUNT)
    .max(RAPID_FIRE_COUNT + 1)
    .describe(`Exactly ${RAPID_FIRE_COUNT} short yes/no questions for both debaters.`),
});
export type RapidFireQuestions = z.infer<typeof RapidFireQuestionsSchema>;

export const YesNoSchema = z.object({
  answer: z.enum(["yes", "no"]).describe("The only allowed answers."),
});
export type YesNo = z.infer<typeof YesNoSchema>;

export const VerdictSchema = z.object({
  winner: z.enum(["a", "b", "draw"]),
  reason: z.string(),
  unanswered: z.array(z.string()).describe("Points one side raised that the other never answered, prefixed with who failed to answer."),
  concessions: z.array(z.string()).describe("Explicit or implicit concessions, prefixed with who conceded."),
});
export type Verdict = z.infer<typeof VerdictSchema>;

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

export type DebateEvent =
  | { type: "turn_start"; seat: Seat; round: number; /** Private pre-debate game plan. */ prep?: boolean; /** Opening yes/no round. */ rapidFire?: boolean }
  | { type: "delta"; seat: Seat; text: string }
  | { type: "turn_end"; seat: Seat; text: string; /** Set when this moderator message is a source fact-check. */ factCheck?: FactCheckStatus; rapidFire?: boolean }
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
