import { generateText, Output, streamText, type LanguageModel, type LanguageModelUsage, type ModelMessage } from "ai";
import { z } from "zod";
import { estimateCost, type ApiKeys, type ModelId } from "./models";
import { getModel } from "./providers";
import {
  debaterSystem,
  debaterSystemWithPlan,
  decisionPrompt,
  moderatorSystem,
  openingPrompt,
  prepPrompt,
  rapidFireAnswerPrompt,
  rapidFireNextPrompt,
  rapidFireReplyPrompt,
  rapidFireSpringPrompt,
  trapRulingPrompt,
  type QA,
  relayMessage,
  topicAnalysisPrompt,
  describeAnalysis,
  verdictPrompt,
  withRapidFireCommitments,
  type RapidFireExchange,
} from "./prompts";
import { sanitize } from "./sanitize";
import {
  answerLimit,
  hasConcession,
  ModeratorDecisionSchema,
  names,
  RAPID_FIRE_COUNT,
  RapidFireNextSchema,
  TrapRulingSchema,
  TopicAnalysisSchema,
  VerdictNoDrawSchema,
  VerdictSchema,
  YesNoSchema,
  type TopicAnalysis,
  type DebateConfig,
  type DebateEvent,
  type Debater,
  type ModeratorDecision,
  type Verdict,
} from "./types";

export type Emit = (event: DebateEvent) => void;
type OnUsage = (usage: LanguageModelUsage) => void;

const DEBATER_MAX_TOKENS = 8000; // includes thinking on reasoning models
const MODERATOR_MAX_TOKENS = 4000;

/** Structured call with a plain-text JSON fallback for providers that lack structured output. */
async function generateJson<S extends z.ZodType>(opts: {
  model: LanguageModel;
  schema: S;
  instructions: string;
  messages: ModelMessage[];
  abortSignal: AbortSignal;
  onUsage: OnUsage;
}): Promise<z.infer<S>> {
  try {
    const { output, usage } = await generateText({
      model: opts.model,
      instructions: opts.instructions,
      messages: opts.messages,
      output: Output.object({ schema: opts.schema }),
      maxOutputTokens: MODERATOR_MAX_TOKENS,
      abortSignal: opts.abortSignal,
    });
    opts.onUsage(usage);
    return output as z.infer<S>;
  } catch (err) {
    if (opts.abortSignal.aborted) throw err;
    // A failed parse was still billed; count it if the SDK reports usage on the error.
    const failedUsage = (err as { usage?: LanguageModelUsage }).usage;
    if (failedUsage) opts.onUsage(failedUsage);
    const { text, usage } = await generateText({
      model: opts.model,
      instructions: `${opts.instructions}\n\nReply with a single JSON object only, matching this JSON schema:\n${JSON.stringify(
        z.toJSONSchema(opts.schema),
      )}`,
      messages: opts.messages,
      maxOutputTokens: MODERATOR_MAX_TOKENS,
      abortSignal: opts.abortSignal,
    });
    opts.onUsage(usage);
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
  onUsage: OnUsage;
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
  opts.onUsage(await result.usage);
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
  /** Force who opens (CLI/tests). Otherwise a fair coin flip decides. */
  firstSpeaker?: Debater,
): Promise<Verdict | null> {
  const debaterModel = models?.debater ?? getModel(config.debaterModel, keys);
  const moderatorModel = models?.moderator ?? getModel(config.moderatorModel, keys);
  const n = names(config);

  // Running token and cost totals, sent to the viewer after every model call.
  const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const meter =
    (id: ModelId): OnUsage =>
    (u) => {
      const input = u.inputTokens ?? 0;
      const output = u.outputTokens ?? 0;
      totals.inputTokens += input;
      totals.outputTokens += output;
      totals.costUsd += estimateCost(id, input, output);
      emit({ type: "usage", ...totals });
    };
  const debaterMeter = meter(config.debaterModel);
  const moderatorMeter = meter(config.moderatorModel);

  // Three private histories. Each debater only ever sees its own.
  const modHistory: ModelMessage[] = [];
  const history: Record<Debater, ModelMessage[]> = { a: [], b: [] };
  const systems: Record<Debater, string> = { a: debaterSystem(config, "a"), b: debaterSystem(config, "b") };
  const modSystem = moderatorSystem(config);
  const transcript: Line[] = [];

  // Coin flip for who opens.
  const opener: Debater = firstSpeaker ?? (crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? "b" : "a");
  emit({ type: "coin_flip", winner: opener });

  // Prep, all in parallel:
  // - each debater privately writes a game plan with traps (kept in its own history only);
  // - the moderator privately decides whether only one side can be right (kept in its history,
  //   so the read is fixed before any argument is heard, and used for the verdict).
  let analysis: TopicAnalysis = { kind: "both_can_be_right", reasoning: "", decidingQuestion: "" };
  const analyse = async () => {
    emit({ type: "turn_start", seat: "mod", round: 0, prep: true });
    modHistory.push({ role: "user", content: topicAnalysisPrompt(config) });
    analysis = (await generateJson<typeof TopicAnalysisSchema>({
      model: moderatorModel,
      onUsage: moderatorMeter,
      schema: TopicAnalysisSchema,
      instructions: modSystem,
      messages: modHistory,
      abortSignal,
    })) as TopicAnalysis;
    modHistory.push({ role: "assistant", content: JSON.stringify(analysis) });
    const summary = describeAnalysis(analysis);
    emit({ type: "delta", seat: "mod", text: summary });
    emit({ type: "turn_end", seat: "mod", text: summary });
  };
  await Promise.all([
    analyse(),
    ...(["a", "b"] as const).map(async (seat) => {
      history[seat].push({ role: "user", content: prepPrompt(config, seat) });
      emit({ type: "turn_start", seat, round: 0, prep: true });
      const plan = await streamTurn({
        model: debaterModel,
        onUsage: debaterMeter,
        instructions: systems[seat],
        messages: history[seat],
        maxOutputTokens: DEBATER_MAX_TOKENS,
        abortSignal,
        onDelta: (text) => emit({ type: "delta", seat, text }),
      });
      emit({ type: "turn_end", seat, text: plan || "(no plan)" });
      // Pin the plan into this debater's instructions so it stays in view for the whole debate,
      // instead of sinking further back in the history with every turn.
      systems[seat] = debaterSystemWithPlan(config, seat, plan || "(no plan)");
      history[seat] = [];
    }),
  ]);
  abortSignal.throwIfAborted();

  // Rapid fire: each side, coin-flip winner first, fires its knockout chain of yes/no questions
  // in a row (choosing each next question after seeing the last answer), springs its conclusion,
  // gets one reply, and the moderator rules. A closed trap ends the debate on the spot.
  const intro = `Rapid fire. Each of you gets one chain of up to ${RAPID_FIRE_COUNT} yes-or-no questions at the other, then springs your conclusion. Answer only yes or no; you get one reply after the spring. If a trap closes, the debate ends here. ${n[opener]} goes first.`;
  emit({ type: "turn_start", seat: "mod", round: 0, rapidFire: true });
  emit({ type: "delta", seat: "mod", text: intro });
  emit({ type: "turn_end", seat: "mod", text: intro, rapidFire: true });
  transcript.push({ seat: "mod", text: intro });

  const exchanges: RapidFireExchange[] = [];
  const rulings: string[] = [];
  let knockout: Debater | null = null;

  for (const asker of [opener, opener === "a" ? "b" : "a"] as const) {
    abortSignal.throwIfAborted();
    const answerer: Debater = asker === "a" ? "b" : "a";
    const qa: QA[] = [];

    // 1. The chain: up to RAPID_FIRE_COUNT questions, each picked live.
    for (let i = 0; i < RAPID_FIRE_COUNT; i++) {
      abortSignal.throwIfAborted();
      emit({ type: "turn_start", seat: asker, round: 0, rapidFire: true, rapidFireAsk: true });
      const next = (await generateJson<typeof RapidFireNextSchema>({
        model: debaterModel,
        onUsage: debaterMeter,
        schema: RapidFireNextSchema,
        instructions: systems[asker],
        messages: [{ role: "user", content: rapidFireNextPrompt(config, asker, qa) }],
        abortSignal,
      })) as { question: string; ready: boolean };
      const question = next.question.trim();
      if (!question || (next.ready && qa.length > 0)) {
        // Close the empty bubble the turn_start opened.
        emit({ type: "turn_end", seat: asker, text: "", rapidFire: true, rapidFireAsk: true });
        break;
      }
      emit({ type: "delta", seat: asker, text: question });
      emit({ type: "turn_end", seat: asker, text: question, rapidFire: true, rapidFireAsk: true });
      transcript.push({ seat: asker, text: `Rapid fire to ${n[answerer]}: ${question}` });

      emit({ type: "turn_start", seat: answerer, round: 0, rapidFire: true });
      const result = (await generateJson<typeof YesNoSchema>({
        model: debaterModel,
        onUsage: debaterMeter,
        schema: YesNoSchema,
        instructions: systems[answerer],
        messages: [{ role: "user", content: rapidFireAnswerPrompt(config, answerer, asker, question, i + 1, RAPID_FIRE_COUNT) }],
        abortSignal,
      })) as { answer: "yes" | "no" };
      const text = result.answer === "yes" ? "Yes" : "No";
      emit({ type: "delta", seat: answerer, text });
      emit({ type: "turn_end", seat: answerer, text, rapidFire: true });
      transcript.push({ seat: answerer, text: `${text} (to: ${question})` });
      qa.push({ question, answer: result.answer });
      exchanges.push({ asker, question, answer: result.answer });
    }
    if (!qa.length) continue;

    // 2. The spring.
    emit({ type: "turn_start", seat: asker, round: 0, rapidFire: true, trap: "spring" });
    const spring =
      (await streamTurn({
        model: debaterModel,
        onUsage: debaterMeter,
        instructions: systems[asker],
        messages: [{ role: "user", content: rapidFireSpringPrompt(config, asker, qa) }],
        maxOutputTokens: DEBATER_MAX_TOKENS,
        abortSignal,
        onDelta: (t) => emit({ type: "delta", seat: asker, text: t }),
      })) || "(no conclusion)";
    emit({ type: "turn_end", seat: asker, text: spring, rapidFire: true, trap: "spring" });
    transcript.push({ seat: asker, text: `Springs the trap: ${spring}` });

    // 3. One reply.
    emit({ type: "turn_start", seat: answerer, round: 0, rapidFire: true, trap: "reply" });
    const reply =
      (await streamTurn({
        model: debaterModel,
        onUsage: debaterMeter,
        instructions: systems[answerer],
        messages: [{ role: "user", content: rapidFireReplyPrompt(config, answerer, qa, spring) }],
        maxOutputTokens: DEBATER_MAX_TOKENS,
        abortSignal,
        onDelta: (t) => emit({ type: "delta", seat: answerer, text: t }),
      })) || "(no reply)";
    emit({ type: "turn_end", seat: answerer, text: reply, rapidFire: true, trap: "reply" });
    transcript.push({ seat: answerer, text: `Replies: ${reply}` });

    // 4. The moderator's ruling. An explicit "I concede" closes it regardless.
    emit({ type: "turn_start", seat: "mod", round: 0, rapidFire: true, trap: "ruling" });
    modHistory.push({ role: "user", content: trapRulingPrompt(config, asker, qa, spring, reply) });
    const ruling = (await generateJson<typeof TrapRulingSchema>({
      model: moderatorModel,
      onUsage: moderatorMeter,
      schema: TrapRulingSchema,
      instructions: modSystem,
      messages: modHistory,
      abortSignal,
    })) as { result: "closed" | "scored" | "escaped"; explanation: string };
    const result = hasConcession(reply) ? "closed" : ruling.result;
    modHistory.push({ role: "assistant", content: JSON.stringify({ ...ruling, result }) });
    const label = result === "closed" ? "Trap closed" : result === "scored" ? "Point scored" : "Escaped";
    const rulingText = ruling.explanation.trim() || label;
    emit({ type: "delta", seat: "mod", text: rulingText });
    emit({ type: "turn_end", seat: "mod", text: rulingText, rapidFire: true, trap: "ruling", trapResult: result });
    transcript.push({ seat: "mod", text: `Ruling on ${n[asker]}'s rapid-fire trap: ${label.toUpperCase()}. ${rulingText}` });
    rulings.push(`${n[asker]}'s trap on ${n[answerer]}: ${result}. ${rulingText}`);
    if (result === "closed") {
      knockout = asker;
      break;
    }
  }

  // Pin the cross-ex into each debater's instructions for the rest of the debate.
  systems.a = withRapidFireCommitments(systems.a, "a", exchanges);
  systems.b = withRapidFireCommitments(systems.b, "b", exchanges);
  if (!knockout) {
    modHistory.push({
      role: "user",
      content: `Rapid fire is done and no trap closed. Rulings:\n${rulings.join("\n")}\nHold both sides to their yes/no answers in the debate.`,
    });
    modHistory.push({ role: "assistant", content: "Noted. Opening the debate." });
  }

  // The long debate only happens if no rapid-fire trap closed.
  if (!knockout) {
  // Opening question, streamed.
  emit({ type: "turn_start", seat: "mod", round: 0 });
  modHistory.push({ role: "user", content: openingPrompt(config, opener) });
  const opening = await streamTurn({
    model: moderatorModel,
        onUsage: moderatorMeter,
    instructions: modSystem,
    messages: modHistory,
    maxOutputTokens: MODERATOR_MAX_TOKENS,
    abortSignal,
    onDelta: (text) => emit({ type: "delta", seat: "mod", text }),
  });
  modHistory.push({ role: "assistant", content: opening });
  emit({ type: "turn_end", seat: "mod", text: opening });
  transcript.push({ seat: "mod", text: opening });

  let speaker: Debater = opener;
  let nextUserMessage = relayMessage(null, opening);

  // Fact-check callouts waiting to be told to the debater who was called out.
  const pendingFactCheck: Record<Debater, string | undefined> = { a: undefined, b: undefined };

  const limit = answerLimit(config);
  for (let round = 1; round <= limit; round++) {
    abortSignal.throwIfAborted();

    // 1–2. Debater answers, streamed.
    history[speaker].push({ role: "user", content: nextUserMessage });
    emit({ type: "turn_start", seat: speaker, round });
    const raw = await streamTurn({
      model: debaterModel,
        onUsage: debaterMeter,
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
      sanitize(answer, moderatorModel, abortSignal, moderatorMeter),
      generateJson<typeof ModeratorDecisionSchema>({
        model: moderatorModel,
        onUsage: moderatorMeter,
        schema: ModeratorDecisionSchema,
        instructions: modSystem,
        messages: modHistory,
        abortSignal,
      }) as Promise<ModeratorDecision>,
    ]);
    modHistory.push({ role: "assistant", content: JSON.stringify(decision) });
    if (decision.leaning) emit({ type: "leaning", ...decision.leaning });

    // Source fact-check: shown as its own moderator message, before the next question.
    const fc = decision.factCheck;
    const callout = fc && fc.status !== "clean" ? fc.callout.trim() : "";
    if (callout) {
      emit({ type: "delta", seat: "mod", text: callout });
      emit({ type: "turn_end", seat: "mod", text: callout, factCheck: fc.status });
      transcript.push({ seat: "mod", text: `Fact check (${fc.status} source) on ${n[speaker]}: ${callout}` });
      pendingFactCheck[speaker] = callout;
      emit({ type: "turn_start", seat: "mod", round });
    }

    // An explicit "I concede" always ends it, whatever the moderator decided.
    const conceded = hasConcession(answer);
    const finished = conceded || decision.action === "end" || round >= limit || !decision.question.trim();
    const modText = !finished
      ? decision.question.trim()
      : conceded
        ? `${n[speaker]} concedes. ${decision.reason}`.trim()
        : round >= limit && config.untilConcession
          ? `We've hit the ${limit}-answer safety limit with no concession. ${decision.reason}`.trim()
          : `That's time. ${decision.reason}`.trim();
    emit({ type: "delta", seat: "mod", text: modText });
    emit({ type: "turn_end", seat: "mod", text: modText });
    transcript.push({ seat: "mod", text: modText });
    if (finished) break;

    // 5. Relay assembled in code: the real argument plus the moderator's question.
    const next: Debater = speaker === "a" ? "b" : "a";
    nextUserMessage = relayMessage(cleaned, decision.question.trim(), {
      onOpponent: callout || undefined,
      onYou: pendingFactCheck[next],
    });
    pendingFactCheck[next] = undefined;
    speaker = next;
  }
  }

  abortSignal.throwIfAborted();
  const label = { mod: `${n.mod} (moderator)`, a: `${n.a} (${config.sideA.label})`, b: `${n.b} (${config.sideB.label})` };
  const text = transcript.map((l) => `${label[l.seat]}: ${l.text}`).join("\n\n");
  emit({ type: "turn_start", seat: "mod", round: -1 });
  // On a "only one can be right" motion, "draw" isn't even an allowed answer.
  const verdict = (await generateJson<typeof VerdictSchema | typeof VerdictNoDrawSchema>({
    model: moderatorModel,
    onUsage: moderatorMeter,
    schema: analysis.kind === "one_right" ? VerdictNoDrawSchema : VerdictSchema,
    instructions: "You are an impartial judge. Your job is to decide which side of the motion is correct, not who debated better.",
    messages: [{ role: "user", content: verdictPrompt(config, text, analysis) }],
    abortSignal,
  })) as Verdict;
  verdict.oneRight = analysis.kind === "one_right";
  emit({ type: "verdict", ...verdict });
  return verdict;
}
