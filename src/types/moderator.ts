import { z } from "zod";
import { CRUX_COUNT } from "@/config";
import { FactCheckStatusSchema } from "./common";
import { CruxUpdateSchema } from "./crux";

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

/** Moderator's private read of the motion, made before the debate starts. */
export const TopicAnalysisSchema = z.object({
  kind: z
    .enum(["one_right", "both_can_be_right"])
    .describe('"one_right" if the two positions contradict each other so at most one can be correct; "both_can_be_right" if both can be partly correct.'),
  reasoning: z.string().describe("Two or three sentences on why."),
  decidingQuestion: z.string().describe("The core question that would settle the debate."),
});
export type TopicAnalysis = z.infer<typeof TopicAnalysisSchema>;
