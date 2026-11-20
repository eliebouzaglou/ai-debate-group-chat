import { z } from "zod";
import { FavoursSchema, type Favours } from "./common";

export const CruxUpdateSchema = z.object({
  favours: FavoursSchema.describe('"a" or "b" if that side has won this deciding question so far, otherwise "open".'),
  note: z.string().describe("Quote the admission, or cite the checked fact, that settled it. Empty if open."),
});
export type CruxUpdate = z.infer<typeof CruxUpdateSchema>;

/** One row of the visible scoreboard. */
export type CruxState = { question: string; favours: Favours; note: string };

/** Referee's ruling on one rapid-fire trap, scored per deciding question. */
export const CruxRulingSchema = z.object({
  cruxes: z.array(CruxUpdateSchema).describe("The scoreboard after this exchange: one entry per deciding question, in order."),
  explanation: z.string().describe("Two or three sentences for the audience: the admission, the fact, the step, and which deciding question moved."),
});
export type CruxRuling = z.infer<typeof CruxRulingSchema>;
