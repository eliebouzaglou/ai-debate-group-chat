import {
  ANALYST_PROMPT,
  ASK_MODERATOR_SYSTEM,
  COACH_PREP_PROMPT,
  CRUX_RULING_PROMPT,
  DEBATER_SYSTEM,
  DECISION_PROMPT,
  MODERATOR_SYSTEM,
  OPENING_PROMPT,
  PLAN_CHECK_PROMPT,
  PLAN_REVISE_PROMPT,
  PLAN_SECTION,
  RAPID_FIRE_ANSWER_PROMPT,
  RAPID_FIRE_COMMITMENTS,
  RAPID_FIRE_NEXT_PROMPT,
  RAPID_FIRE_SPRING_PROMPT,
  RELAY_MESSAGE,
  SELF_CHECK_PROMPT,
  VERDICT_PROMPT,
} from "./constants/prompts";
import {
  answerLimit,
  CRUX_COUNT,
  names,
  RAPID_FIRE_COUNT,
  type ContextBrief,
  type CruxState,
  type DebateConfig,
  type Debater,
  type SelfCheck,
  type TopicAnalysis,
  type Verdict,
} from "./types";

function sides(config: DebateConfig, seat: Debater) {
  const me = seat === "a" ? config.sideA.label : config.sideB.label;
  const them = seat === "a" ? config.sideB.label : config.sideA.label;
  const n = names(config);
  return { me, them, myName: n[seat], theirName: n[seat === "a" ? "b" : "a"] };
}

const other = (seat: Debater): Debater => (seat === "a" ? "b" : "a");

// ---------------------------------------------------------------- system prompts

export function debaterSystem(config: DebateConfig, seat: Debater): string {
  const { me, them, myName, theirName } = sides(config, seat);
  return DEBATER_SYSTEM({ myName, theirName, me, them, topic: config.topic });
}

/** Debater instructions with its own battle plan pinned at the end, so it stays in view all debate. */
export function debaterSystemWithPlan(config: DebateConfig, seat: Debater, plan: string): string {
  return debaterSystem(config, seat) + PLAN_SECTION(plan);
}

export function moderatorSystem(config: DebateConfig): string {
  const n = names(config);
  return MODERATOR_SYSTEM({
    mod: n.mod,
    a: n.a,
    b: n.b,
    topic: config.topic,
    sideA: config.sideA.label,
    sideB: config.sideB.label,
  });
}

// ---------------------------------------------------------------- backstage brief

export function analystPrompt(config: DebateConfig): string {
  const n = names(config);
  return ANALYST_PROMPT({
    topic: config.topic,
    a: n.a,
    b: n.b,
    sideA: config.sideA.label,
    sideB: config.sideB.label,
    cruxCount: CRUX_COUNT,
  });
}

/** The part of the backstage brief one side's coach gets: the opponent's commitments and weak spots, not its own. */
export function briefForSide(brief: ContextBrief, seat: Debater): string {
  const opp = other(seat);
  return [
    `- What your opponent is committed to: ${brief.commitments[opp]}`,
    `- Shared ground: ${brief.sharedGround}`,
    `- What would actually settle it:\n${brief.cruxes.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}`,
    `- Where your opponent's position is hardest to hold together: ${brief.weakSpots[opp]}`,
    `- Their advice: ${brief.coachBriefs[seat]}`,
  ].join("\n");
}

/** Shown on the moderator's private prep card. */
export function describeBrief(brief: ContextBrief): string {
  const kind = brief.kind === "one_right" ? "Only one side can be right." : "Both sides can be partly right.";
  return [
    `${kind} ${brief.kindReason.trim()}`,
    ``,
    `Deciding questions:`,
    ...brief.cruxes.map((c, i) => `${i + 1}. ${c}`),
    ``,
    `Referee standard: ${brief.refereeStandard.trim()}`,
  ].join("\n");
}

export function analysisFromBrief(brief: ContextBrief): TopicAnalysis {
  return { kind: brief.kind, reasoning: brief.kindReason, decidingQuestion: brief.cruxes.join(" / ") };
}

/** One-line summary of the moderator's read, used in the verdict prompt. */
export function describeAnalysis(a: TopicAnalysis): string {
  const kind = a.kind === "one_right" ? "Only one side can be right." : "Both sides can be partly right.";
  return `${kind} ${a.reasoning.trim()} Deciding questions: ${a.decidingQuestion.trim()}`;
}

export function formatScoreboard(config: DebateConfig, cruxes: CruxState[]): string {
  const n = names(config);
  return cruxes
    .map((c, i) => {
      const who = c.favours === "open" ? "open" : `favours ${n[c.favours]} (side "${c.favours}")`;
      return `${i + 1}. ${c.question} — ${who}${c.note ? `: ${c.note}` : ""}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------- coach prep

export function coachPrepPrompt(config: DebateConfig, seat: Debater, brief: ContextBrief): string {
  const { me, them, myName, theirName } = sides(config, seat);
  return COACH_PREP_PROMPT({
    myName,
    me,
    theirName,
    them,
    topic: config.topic,
    brief: briefForSide(brief, seat),
    rapidFireCount: RAPID_FIRE_COUNT,
  });
}

export function planCheckPrompt(config: DebateConfig, seat: Debater, plan: string): string {
  const { me, them, myName, theirName } = sides(config, seat);
  return PLAN_CHECK_PROMPT({ myName, me, theirName, them, topic: config.topic, plan });
}

export const planRevisePrompt = (notes: string) => PLAN_REVISE_PROMPT(notes);

/** True when the fact-checker found nothing to fix. */
export const planIsClean = (notes: string) => /^\s*no changes needed\.?\s*$/i.test(notes);

// ---------------------------------------------------------------- rapid fire

export type QA = { question: string; answer: "yes" | "no" };

/** Asker picks its next rapid-fire question after seeing the answers so far. */
export function rapidFireNextPrompt(config: DebateConfig, asker: Debater, qa: QA[]): string {
  return RAPID_FIRE_NEXT_PROMPT({ theirName: sides(config, asker).theirName, max: RAPID_FIRE_COUNT, qa });
}

export function rapidFireAnswerPrompt(
  config: DebateConfig,
  seat: Debater,
  asker: Debater,
  question: string,
  index: number,
  total: number,
): string {
  const { me } = sides(config, seat);
  const n = names(config);
  return RAPID_FIRE_ANSWER_PROMPT({ question, theirName: n[asker], me, index, total });
}

export function rapidFireSpringPrompt(config: DebateConfig, asker: Debater, qa: QA[]): string {
  return RAPID_FIRE_SPRING_PROMPT({ theirName: sides(config, asker).theirName, qa });
}

/** The defender asks its own coach: did they beat me, and what do I say? */
export function selfCheckPrompt(config: DebateConfig, defender: Debater, qa: QA[], spring: string): string {
  const { me, myName, theirName } = sides(config, defender);
  return SELF_CHECK_PROMPT({ myName, me, theirName, topic: config.topic, qa, spring });
}

export function cruxRulingPrompt(
  config: DebateConfig,
  asker: Debater,
  qa: QA[],
  spring: string,
  reply: string,
  check: SelfCheck,
  scoreboard: CruxState[],
  standard: string,
): string {
  const n = names(config);
  const answerer = other(asker);
  const label = (s: Debater) => (s === "a" ? config.sideA.label : config.sideB.label);
  return CRUX_RULING_PROMPT({
    asker: n[asker],
    askerSide: asker,
    askerLabel: label(asker),
    answerer: n[answerer],
    answererLabel: label(answerer),
    scoreboard: formatScoreboard(config, scoreboard),
    standard,
    qa,
    spring,
    reply,
    check: { verdict: check.verdict, mistake: check.mistake },
  });
}

export type RapidFireExchange = {
  asker: Debater;
  question: string;
  answer: "yes" | "no";
};

/** Pin rapid-fire cross-ex into a debater's instructions for the rest of the debate. */
export function withRapidFireCommitments(system: string, seat: Debater, exchanges: RapidFireExchange[]): string {
  const asked = exchanges.filter((e) => e.asker === seat);
  const answered = exchanges.filter((e) => e.asker !== seat);
  const blocks = [
    asked.length
      ? `You asked:\n${asked.map((e, i) => `${i + 1}. ${e.question} → they said ${e.answer}.`).join("\n")}`
      : "",
    answered.length
      ? `They asked you:\n${answered.map((e, i) => `${i + 1}. ${e.question} → you said ${e.answer}.`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return system + RAPID_FIRE_COMMITMENTS(blocks);
}

// ---------------------------------------------------------------- long debate

export function openingPrompt(config: DebateConfig, first: Debater): string {
  const n = names(config);
  return OPENING_PROMPT({
    firstName: n[first],
    firstLabel: first === "a" ? config.sideA.label : config.sideB.label,
  });
}

export function decisionPrompt(
  config: DebateConfig,
  speaker: Debater,
  answer: string,
  round: number,
  scoreboard: CruxState[],
): string {
  const n = names(config);
  const o = other(speaker);
  const label = (s: Debater) => (s === "a" ? config.sideA.label : config.sideB.label);
  const limit = answerLimit();
  return DECISION_PROMPT({
    scoreboard: formatScoreboard(config, scoreboard),
    round,
    speakerName: n[speaker],
    speakerLabel: label(speaker),
    otherName: n[o],
    otherLabel: label(o),
    answer,
    last: round >= limit,
  });
}

export function relayMessage(
  opponentCleaned: string | null,
  question: string,
  factChecks: { onOpponent?: string; onYou?: string } = {},
): string {
  return RELAY_MESSAGE({
    opponentCleaned,
    question,
    factCheckOnOpponent: factChecks.onOpponent,
    factCheckOnYou: factChecks.onYou,
  });
}

export function verdictPrompt(
  config: DebateConfig,
  transcript: string,
  analysis: TopicAnalysis,
  scoreboard: CruxState[],
  standard: string,
): string {
  const n = names(config);
  return VERDICT_PROMPT({
    scoreboard: formatScoreboard(config, scoreboard),
    standard,
    oneRight: analysis.kind === "one_right",
    analysis: describeAnalysis(analysis),
    a: n.a,
    b: n.b,
    sideA: config.sideA.label,
    sideB: config.sideB.label,
    transcript,
  });
}

/** Post-debate Q&A: the moderator explains their verdict to a viewer. */
export function askModeratorSystem(config: DebateConfig, verdict: Verdict, transcript: string): string {
  const n = names(config);
  const winnerLabel =
    verdict.winner === "draw"
      ? "Both sides equally right"
      : `${n[verdict.winner]} (${verdict.winner === "a" ? config.sideA.label : config.sideB.label}) is right`;
  return ASK_MODERATOR_SYSTEM({
    mod: n.mod,
    a: n.a,
    b: n.b,
    sideA: config.sideA.label,
    sideB: config.sideB.label,
    topic: config.topic,
    winnerLabel,
    reason: verdict.reason,
    unanswered: verdict.unanswered,
    concessions: verdict.concessions,
    transcript,
  });
}
