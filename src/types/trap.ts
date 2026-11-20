import { z } from "zod";
import { RAPID_FIRE_COUNT } from "@/config";

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

export type TrapStage = "spring" | "check" | "reply" | "ruling";
