import { z } from "zod";
import { CruxUpdateSchema } from "./crux";

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
