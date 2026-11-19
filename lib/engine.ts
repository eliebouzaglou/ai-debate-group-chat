import { generateText, Output, streamText, type LanguageModel, type LanguageModelUsage, type ModelMessage } from "ai";
import { z } from "zod";
import { COACH_SYSTEM, PLAN_CHECK_SYSTEM } from "./constants/prompts";
import { estimateCost, type ApiKeys, type ModelId } from "./models";
import { getModel } from "./providers";
import {
  analysisFromBrief,
  analystPrompt,
  coachPrepPrompt,
  cruxRulingPrompt,
  debaterSystem,
  debaterSystemWithPlan,
  decisionPrompt,
  describeBrief,
  moderatorSystem,
  openingPrompt,
  planCheckPrompt,
  planIsClean,
  planRevisePrompt,
  rapidFireAnswerPrompt,
  rapidFireNextPrompt,
  rapidFireSpringPrompt,
  relayMessage,
  selfCheckPrompt,
  verdictPrompt,
  withRapidFireCommitments,
  type QA,
  type RapidFireExchange,
} from "./prompts";
import { sanitize } from "./sanitize";
import {
  answerLimit,
  ContextBriefSchema,
  CRUX_COUNT,
  CruxRulingSchema,
  hasConcession,
  ModeratorDecisionSchema,
  names,
  RAPID_FIRE_COUNT,
  RapidFireNextSchema,
  SelfCheckSchema,
  VerdictNoDrawSchema,
  VerdictSchema,
  YesNoSchema,
  type ContextBrief,
  type CruxRuling,
  type CruxState,
  type CruxUpdate,
  type DebateConfig,
  type DebateEvent,
  type Debater,
  type ModeratorDecision,
  type SelfCheck,
  type TrapResult,
  type Verdict,
} from "./types";

export type Emit = (event: DebateEvent) => void;
type OnUsage = (usage: LanguageModelUsage) => void;

const DEBATER_MAX_TOKENS = 8000; // includes thinking on reasoning models
const MODERATOR_MAX_TOKENS = 4000;
const BRIEF_MAX_TOKENS = 8000;

/** Structured call with a plain-text JSON fallback for providers that lack structured output. */
async function generateJson<S extends z.ZodType>(opts: {
  model: LanguageModel;
  schema: S;
  instructions: string;
  messages: ModelMessage[];
  abortSignal: AbortSignal;
  onUsage: OnUsage;
  maxOutputTokens?: number;
}): Promise<z.infer<S>> {
  const maxOutputTokens = opts.maxOutputTokens ?? MODERATOR_MAX_TOKENS;
  try {
    const { output, usage } = await generateText({
      model: opts.model,
      instructions: opts.instructions,
      messages: opts.messages,
      output: Output.object({ schema: opts.schema }),
      maxOutputTokens,
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
      maxOutputTokens,
      abortSignal: opts.abortSignal,
    });
    opts.onUsage(usage);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The model did not return JSON.");
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

/** Plain, non-streamed text call (backstage work the viewer doesn't watch being typed). */
async function completeText(opts: {
  model: LanguageModel;
  instructions: string;
  messages: ModelMessage[];
  maxOutputTokens: number;
  abortSignal: AbortSignal;
  onUsage: OnUsage;
}): Promise<string> {
  const { text, usage } = await generateText({
    model: opts.model,
    instructions: opts.instructions,
    messages: opts.messages,
    maxOutputTokens: opts.maxOutputTokens,
    abortSignal: opts.abortSignal,
  });
  opts.onUsage(usage);
  return text.trim();
}

// ---------------------------------------------------------------- scoreboard helpers

/** Apply a model's scoreboard update. Missing or malformed entries leave that row unchanged. */
export function applyCruxUpdates(board: CruxState[], updates: CruxUpdate[] | undefined): CruxState[] {
  return board.map((row, i) => {
    const u = updates?.[i];
    if (!u || !["a", "b", "open"].includes(u.favours)) return row;
    return { ...row, favours: u.favours, note: u.favours === "open" ? "" : (u.note ?? "").trim() || row.note };
  });
}

export function tally(board: CruxState[]) {
  return {
    a: board.filter((c) => c.favours === "a").length,
    b: board.filter((c) => c.favours === "b").length,
  };
}

/** A side that holds more than half the deciding questions has won the debate. */
export function majorityHolder(board: CruxState[]): Debater | null {
  const t = tally(board);
  if (t.a > board.length / 2) return "a";
  if (t.b > board.length / 2) return "b";
  return null;
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
  const other = (s: Debater): Debater => (s === "a" ? "b" : "a");

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

  // Private histories. Each debater only ever sees its own; the moderator's holds its brief and rulings.
  const modHistory: ModelMessage[] = [];
  const history: Record<Debater, ModelMessage[]> = { a: [], b: [] };
  const systems: Record<Debater, string> = { a: debaterSystem(config, "a"), b: debaterSystem(config, "b") };
  const plans: Record<Debater, string> = { a: "", b: "" };
  const modSystem = moderatorSystem(config);
  const transcript: Line[] = [];

  // Coin flip for who opens.
  const opener: Debater = firstSpeaker ?? (crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? "b" : "a");
  emit({ type: "coin_flip", winner: opener });

  // ------------------------------------------------------------ 1. Backstage brief
  // The moderator works out, for this specific motion, what each side is committed to, the
  // deciding questions, a brief for each side's coach, and the fixed standard it will rule by.
  emit({ type: "turn_start", seat: "mod", round: 0, prep: true });
  modHistory.push({ role: "user", content: analystPrompt(config) });
  const rawBrief = (await generateJson<typeof ContextBriefSchema>({
    model: moderatorModel,
    onUsage: moderatorMeter,
    schema: ContextBriefSchema,
    instructions: modSystem,
    messages: modHistory,
    abortSignal,
    maxOutputTokens: BRIEF_MAX_TOKENS,
  })) as ContextBrief;
  const cruxes = rawBrief.cruxes.map((c) => c.trim()).filter(Boolean).slice(0, CRUX_COUNT);
  const brief: ContextBrief = { ...rawBrief, cruxes: cruxes.length ? cruxes : [rawBrief.kindReason || config.topic] };
  modHistory.push({ role: "assistant", content: JSON.stringify(brief) });
  const analysis = analysisFromBrief(brief);
  const briefText = describeBrief(brief);
  emit({ type: "delta", seat: "mod", text: briefText });
  emit({ type: "turn_end", seat: "mod", text: briefText });

  let scoreboard: CruxState[] = brief.cruxes.map((question) => ({ question, favours: "open", note: "" }));
  emit({ type: "scoreboard", cruxes: scoreboard });

  // ------------------------------------------------------------ 2. Coach prep, fact-check, revision
  // Each side's plan is written in coach framing ("I'm about to debate X; help me win"), from that
  // side's slice of the brief. A fact-checker reviews it and the coach fixes it once.
  await Promise.all(
    (["a", "b"] as const).map(async (seat) => {
      emit({ type: "turn_start", seat, round: 0, prep: true });
      const prepMessages: ModelMessage[] = [{ role: "user", content: coachPrepPrompt(config, seat, brief) }];
      const draft =
        (await streamTurn({
          model: debaterModel,
          onUsage: debaterMeter,
          instructions: COACH_SYSTEM,
          messages: prepMessages,
          maxOutputTokens: DEBATER_MAX_TOKENS,
          abortSignal,
          onDelta: (text) => emit({ type: "delta", seat, text }),
        })) || "(no plan)";
      emit({ type: "turn_end", seat, text: draft });

      const notes = await completeText({
        model: moderatorModel,
        onUsage: moderatorMeter,
        instructions: PLAN_CHECK_SYSTEM,
        messages: [{ role: "user", content: planCheckPrompt(config, seat, draft) }],
        maxOutputTokens: MODERATOR_MAX_TOKENS,
        abortSignal,
      });
      let plan = draft;
      if (notes && !planIsClean(notes)) {
        const revised = await completeText({
          model: debaterModel,
          onUsage: debaterMeter,
          instructions: COACH_SYSTEM,
          messages: [...prepMessages, { role: "assistant", content: draft }, { role: "user", content: planRevisePrompt(notes) }],
          maxOutputTokens: DEBATER_MAX_TOKENS,
          abortSignal,
        });
        if (revised) plan = revised;
      }
      emit({ type: "plan_update", seat, text: plan, revised: plan !== draft });
      // Pin the final plan into this debater's instructions for the whole debate.
      plans[seat] = plan;
      systems[seat] = debaterSystemWithPlan(config, seat, plan);
    }),
  );
  abortSignal.throwIfAborted();

  // ------------------------------------------------------------ 3. Rapid fire (the knockout round)
  const intro = `Rapid fire. Each of you gets one chain of up to ${RAPID_FIRE_COUNT} yes-or-no questions at the other, then springs your conclusion. Answers are final: no taking them back. You get one reply after the spring. I score every exchange against the deciding questions; win most of them and the debate ends here. ${n[opener]} goes first.`;
  emit({ type: "turn_start", seat: "mod", round: 0, rapidFire: true });
  emit({ type: "delta", seat: "mod", text: intro });
  emit({ type: "turn_end", seat: "mod", text: intro, rapidFire: true });
  transcript.push({ seat: "mod", text: intro });

  const exchanges: RapidFireExchange[] = [];
  const rulings: string[] = [];
  let knockout: Debater | null = null;

  for (const asker of [opener, other(opener)] as const) {
    abortSignal.throwIfAborted();
    const answerer = other(asker);
    const qa: QA[] = [];

    // 3a. The chain: up to RAPID_FIRE_COUNT questions, each picked live.
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

    // 3b. The spring.
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

    // 3c. The defender asks its own coach, privately: did they beat me? what do I say?
    emit({ type: "turn_start", seat: answerer, round: 0, rapidFire: true, trap: "check" });
    const check = (await generateJson<typeof SelfCheckSchema>({
      model: debaterModel,
      onUsage: debaterMeter,
      schema: SelfCheckSchema,
      instructions: `${COACH_SYSTEM}\n\nFor reference, the battle plan you wrote with your client before the debate:\n${plans[answerer]}`,
      messages: [{ role: "user", content: selfCheckPrompt(config, answerer, qa, spring) }],
      abortSignal,
      maxOutputTokens: DEBATER_MAX_TOKENS,
    })) as SelfCheck;
    const checkLabel = check.verdict === "beaten" ? "Beaten" : "Not beaten";
    const checkText = check.mistake.trim() ? `${checkLabel}. ${check.mistake.trim()}` : checkLabel;
    emit({ type: "delta", seat: answerer, text: checkText });
    emit({ type: "turn_end", seat: answerer, text: checkText, rapidFire: true, trap: "check", checkVerdict: check.verdict });
    transcript.push({ seat: answerer, text: `Private check (from ${n[answerer]}'s own coach): ${checkText}` });

    // 3d. The public reply. A "beaten" self-check always concedes.
    const conceded = check.verdict === "beaten" || hasConcession(check.reply);
    const reply = conceded && !hasConcession(check.reply) ? `${check.reply.trim()} I concede.`.trim() : check.reply.trim() || "(no reply)";
    emit({ type: "turn_start", seat: answerer, round: 0, rapidFire: true, trap: "reply" });
    emit({ type: "delta", seat: answerer, text: reply });
    emit({ type: "turn_end", seat: answerer, text: reply, rapidFire: true, trap: "reply" });
    transcript.push({ seat: answerer, text: `Replies: ${reply}` });

    // 3e. The referee scores the exchange against each deciding question.
    emit({ type: "turn_start", seat: "mod", round: 0, rapidFire: true, trap: "ruling" });
    modHistory.push({
      role: "user",
      content: cruxRulingPrompt(config, asker, qa, spring, reply, check, scoreboard, brief.refereeStandard),
    });
    const ruling = (await generateJson<typeof CruxRulingSchema>({
      model: moderatorModel,
      onUsage: moderatorMeter,
      schema: CruxRulingSchema,
      instructions: modSystem,
      messages: modHistory,
      abortSignal,
    })) as CruxRuling;
    modHistory.push({ role: "assistant", content: JSON.stringify(ruling) });
    const before = tally(scoreboard)[asker];
    scoreboard = applyCruxUpdates(scoreboard, ruling.cruxes);
    emit({ type: "scoreboard", cruxes: scoreboard });

    // Decided in code, so the same scoreboard always gives the same outcome.
    const holder = majorityHolder(scoreboard);
    const result: TrapResult = conceded || holder === asker ? "closed" : tally(scoreboard)[asker] > before ? "scored" : "escaped";
    const label = result === "closed" ? "Trap closed" : result === "scored" ? "Point scored" : "Escaped";
    const rulingText = (conceded ? `${n[answerer]} concedes. ` : "") + (ruling.explanation.trim() || label);
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

  // ------------------------------------------------------------ 4. The long debate, only if nobody won rapid fire
  if (!knockout) {
    modHistory.push({
      role: "user",
      content: `Rapid fire is done and nobody won it outright. Rulings:\n${rulings.join("\n")}\nHold both sides to their yes/no answers in the debate.`,
    });
    modHistory.push({ role: "assistant", content: "Noted. Opening the debate." });

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

      // Clean copy for the opponent and the moderator's decision, in parallel. The moderator reads the raw answer.
      modHistory.push({ role: "user", content: decisionPrompt(config, speaker, answer, round, scoreboard) });
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
      const updated = applyCruxUpdates(scoreboard, decision.cruxes);
      if (JSON.stringify(updated) !== JSON.stringify(scoreboard)) {
        scoreboard = updated;
        emit({ type: "scoreboard", cruxes: scoreboard });
      }

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
      const concededNow = hasConcession(answer);
      const finished = concededNow || decision.action === "end" || round >= limit || !decision.question.trim();
      const modText = !finished
        ? decision.question.trim()
        : concededNow
          ? `${n[speaker]} concedes. ${decision.reason}`.trim()
          : round >= limit && config.untilConcession
            ? `We've hit the ${limit}-answer safety limit with no concession. ${decision.reason}`.trim()
            : `That's time. ${decision.reason}`.trim();
      emit({ type: "delta", seat: "mod", text: modText });
      emit({ type: "turn_end", seat: "mod", text: modText });
      transcript.push({ seat: "mod", text: modText });
      if (finished) break;

      // Relay assembled in code: the real argument plus the moderator's question.
      const next = other(speaker);
      nextUserMessage = relayMessage(cleaned, decision.question.trim(), {
        onOpponent: callout || undefined,
        onYou: pendingFactCheck[next],
      });
      pendingFactCheck[next] = undefined;
      speaker = next;
    }
  }

  // ------------------------------------------------------------ 5. Verdict, following the scoreboard
  abortSignal.throwIfAborted();
  const label = { mod: `${n.mod} (moderator)`, a: `${n.a} (${config.sideA.label})`, b: `${n.b} (${config.sideB.label})` };
  const text = transcript.map((l) => `${label[l.seat]}: ${l.text}`).join("\n\n");
  emit({ type: "turn_start", seat: "mod", round: -1 });
  const oneRight = analysis.kind === "one_right";
  const verdict = (await generateJson<typeof VerdictSchema | typeof VerdictNoDrawSchema>({
    model: moderatorModel,
    onUsage: moderatorMeter,
    // On a "only one can be right" motion, "draw" isn't even an allowed answer.
    schema: oneRight ? VerdictNoDrawSchema : VerdictSchema,
    instructions: "You are an impartial judge. Your job is to decide which side of the motion is correct, not who debated better.",
    messages: [{ role: "user", content: verdictPrompt(config, text, analysis, scoreboard, brief.refereeStandard) }],
    abortSignal,
  })) as Verdict;

  // The winner follows the final scoreboard. Only a tie falls back to the judge's call.
  const finalBoard = knockout ? scoreboard : applyCruxUpdates(scoreboard, verdict.cruxes);
  const t = tally(finalBoard);
  if (knockout) verdict.winner = knockout;
  else if (t.a !== t.b) verdict.winner = t.a > t.b ? "a" : "b";
  else if (oneRight && verdict.winner === "draw") verdict.winner = opener === "a" ? "b" : "a"; // never happens with the no-draw schema; defensive
  verdict.cruxes = finalBoard.map(({ favours, note }) => ({ favours, note }));
  verdict.oneRight = oneRight;
  emit({ type: "scoreboard", cruxes: finalBoard });
  emit({ type: "verdict", ...verdict });
  return verdict;
}
