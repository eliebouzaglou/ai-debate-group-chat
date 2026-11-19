import { generateText, Output, streamText, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import type { ApiKeys } from "./models";
import { getModel } from "./providers";
import {
  debaterSystem,
  decisionPrompt,
  moderatorSystem,
  openingPrompt,
  relayMessage,
  verdictPrompt,
} from "./prompts";
import { sanitize } from "./sanitize";
import {
  ModeratorDecisionSchema,
  names,
  VerdictSchema,
  type DebateConfig,
  type DebateEvent,
  type Debater,
  type ModeratorDecision,
  type Verdict,
} from "./types";

export type Emit = (event: DebateEvent) => void;

const DEBATER_MAX_TOKENS = 8000; // includes thinking on reasoning models
const MODERATOR_MAX_TOKENS = 4000;

/** Structured call with a plain-text JSON fallback for providers that lack structured output. */
async function generateJson<S extends z.ZodType>(opts: {
  model: LanguageModel;
  schema: S;
  instructions: string;
  messages: ModelMessage[];
  abortSignal: AbortSignal;
}): Promise<z.infer<S>> {
  try {
    const { output } = await generateText({
      model: opts.model,
      instructions: opts.instructions,
      messages: opts.messages,
      output: Output.object({ schema: opts.schema }),
      maxOutputTokens: MODERATOR_MAX_TOKENS,
      abortSignal: opts.abortSignal,
    });
    return output as z.infer<S>;
  } catch (err) {
    if (opts.abortSignal.aborted) throw err;
    const { text } = await generateText({
      model: opts.model,
      instructions: `${opts.instructions}\n\nReply with a single JSON object only, matching this JSON schema:\n${JSON.stringify(
        z.toJSONSchema(opts.schema),
      )}`,
      messages: opts.messages,
      maxOutputTokens: MODERATOR_MAX_TOKENS,
      abortSignal: opts.abortSignal,
    });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Moderator did not return JSON.");
    return opts.schema.parse(JSON.parse(match[0]));
  }
}

async function streamTurn(opts: {
  model: LanguageModel;
  instructions: string;
  messages: ModelMessage[];
  maxOutputTokens: number;
  abortSignal: AbortSignal;
  onDelta: (t: string) => void;
}): Promise<string> {
  const result = streamText({
    model: opts.model,
    instructions: opts.instructions,
    messages: opts.messages,
    maxOutputTokens: opts.maxOutputTokens,
    abortSignal: opts.abortSignal,
    // streamText doesn't throw on provider errors (bad key, unknown model); it ends the
    // text stream early. Capture the error so the turn fails loudly instead of going blank.
    onError: ({ error }) => {
      streamError = error;
    },
  });
  let streamError: unknown;
  let full = "";
  for await (const chunk of result.textStream) {
    full += chunk;
    opts.onDelta(chunk);
  }
  if (streamError) throw streamError instanceof Error ? streamError : new Error(String(streamError));
  return full.trim();
}

/** Plain transcript line used for the verdict. */
interface Line {
  seat: "mod" | Debater;
  text: string;
}

export async function runDebate(
  config: DebateConfig,
  keys: ApiKeys,
  emit: Emit,
  abortSignal: AbortSignal,
  /** Inject models directly (tests, mock mode). Otherwise built from config + keys. */
  models?: { debater: LanguageModel; moderator: LanguageModel },
): Promise<Verdict | null> {
  const debaterModel = models?.debater ?? getModel(config.debaterModel, keys);
  const moderatorModel = models?.moderator ?? getModel(config.moderatorModel, keys);
  const n = names(config);

  // Three private histories. Each debater only ever sees its own.
  const modHistory: ModelMessage[] = [];
  const history: Record<Debater, ModelMessage[]> = { a: [], b: [] };
  const systems = { a: debaterSystem(config, "a"), b: debaterSystem(config, "b") };
  const modSystem = moderatorSystem(config);
  const transcript: Line[] = [];

  // Opening question, streamed.
  emit({ type: "turn_start", seat: "mod", round: 0 });
  modHistory.push({ role: "user", content: openingPrompt(config) });
  const opening = await streamTurn({
    model: moderatorModel,
    instructions: modSystem,
    messages: modHistory,
    maxOutputTokens: MODERATOR_MAX_TOKENS,
    abortSignal,
    onDelta: (text) => emit({ type: "delta", seat: "mod", text }),
  });
  modHistory.push({ role: "assistant", content: opening });
  emit({ type: "turn_end", seat: "mod", text: opening });
  transcript.push({ seat: "mod", text: opening });

  let speaker: Debater = config.firstSpeaker;
  let nextUserMessage = relayMessage(null, opening);

  for (let round = 1; round <= config.maxRounds; round++) {
    abortSignal.throwIfAborted();

    // 1–2. Debater answers, streamed.
    history[speaker].push({ role: "user", content: nextUserMessage });
    emit({ type: "turn_start", seat: speaker, round });
    const raw = await streamTurn({
      model: debaterModel,
      instructions: systems[speaker],
      messages: history[speaker],
      maxOutputTokens: DEBATER_MAX_TOKENS,
      abortSignal,
      onDelta: (text) => emit({ type: "delta", seat: speaker, text }),
    });
    const answer = raw || "(no answer)";
    history[speaker].push({ role: "assistant", content: answer });
    emit({ type: "turn_end", seat: speaker, text: answer });
    transcript.push({ seat: speaker, text: answer });

    // 3–4. Clean copy for the opponent and the moderator's decision, in parallel.
    // The moderator reads the raw answer.
    modHistory.push({ role: "user", content: decisionPrompt(config, speaker, answer, round) });
    emit({ type: "turn_start", seat: "mod", round });
    const [cleaned, decision] = await Promise.all([
      sanitize(answer, moderatorModel, abortSignal),
      generateJson<typeof ModeratorDecisionSchema>({
        model: moderatorModel,
        schema: ModeratorDecisionSchema,
        instructions: modSystem,
        messages: modHistory,
        abortSignal,
      }) as Promise<ModeratorDecision>,
    ]);
    modHistory.push({ role: "assistant", content: JSON.stringify(decision) });

    const finished = decision.action === "end" || round >= config.maxRounds || !decision.question.trim();
    const modText = finished
      ? `That's time. ${decision.reason}`.trim()
      : decision.question.trim();
    emit({ type: "delta", seat: "mod", text: modText });
    emit({ type: "turn_end", seat: "mod", text: modText });
    transcript.push({ seat: "mod", text: modText });
    if (finished) break;

    // 5. Relay assembled in code: the real argument plus the moderator's question.
    nextUserMessage = relayMessage(cleaned, decision.question.trim());
    speaker = speaker === "a" ? "b" : "a";
  }

  abortSignal.throwIfAborted();
  const label = { mod: `${n.mod} (moderator)`, a: `${n.a} (${config.sideA.label})`, b: `${n.b} (${config.sideB.label})` };
  const text = transcript.map((l) => `${label[l.seat]}: ${l.text}`).join("\n\n");
  emit({ type: "turn_start", seat: "mod", round: -1 });
  const verdict = await generateJson<typeof VerdictSchema>({
    model: moderatorModel,
    schema: VerdictSchema,
    instructions: "You are an impartial debate judge.",
    messages: [{ role: "user", content: verdictPrompt(config, text) }],
    abortSignal,
  }) as Verdict;
  emit({ type: "verdict", ...verdict });
  return verdict;
}
