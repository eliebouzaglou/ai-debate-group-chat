import {
  ASK_MODERATOR_SYSTEM,
  DEBATER_SYSTEM,
  DECISION_PROMPT,
  MODERATOR_SYSTEM,
  OPENING_PROMPT,
  PLAN_SECTION,
  PREP_PROMPT,
  TOPIC_ANALYSIS_PROMPT,
  RELAY_MESSAGE,
  VERDICT_PROMPT,
} from "./constants/prompts";
import { answerLimit, names, type DebateConfig, type Debater, type TopicAnalysis, type Verdict } from "./types";

function sides(config: DebateConfig, seat: Debater) {
  const me = seat === "a" ? config.sideA.label : config.sideB.label;
  const them = seat === "a" ? config.sideB.label : config.sideA.label;
  const n = names(config);
  return { me, them, myName: n[seat], theirName: n[seat === "a" ? "b" : "a"] };
}

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
    untilConcession: config.untilConcession,
    maxRounds: config.maxRounds,
  });
}

export function prepPrompt(config: DebateConfig, seat: Debater): string {
  const { me, them, theirName } = sides(config, seat);
  return PREP_PROMPT({ me, them, theirName, topic: config.topic });
}

export function topicAnalysisPrompt(config: DebateConfig): string {
  const n = names(config);
  return TOPIC_ANALYSIS_PROMPT({ topic: config.topic, a: n.a, b: n.b, sideA: config.sideA.label, sideB: config.sideB.label });
}

/** One-line summary of the moderator's read, used in the verdict prompt and the chat card. */
export function describeAnalysis(a: TopicAnalysis): string {
  const kind = a.kind === "one_right" ? "Only one side can be right." : "Both sides can be partly right.";
  return `${kind} ${a.reasoning.trim()} Deciding question: ${a.decidingQuestion.trim()}`;
}

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
): string {
  const n = names(config);
  const other: Debater = speaker === "a" ? "b" : "a";
  const label = (s: Debater) => (s === "a" ? config.sideA.label : config.sideB.label);
  const limit = answerLimit(config);
  return DECISION_PROMPT({
    round,
    limit,
    speakerName: n[speaker],
    speakerLabel: label(speaker),
    otherName: n[other],
    otherLabel: label(other),
    answer,
    untilConcession: config.untilConcession,
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

export function verdictPrompt(config: DebateConfig, transcript: string, analysis: TopicAnalysis): string {
  const n = names(config);
  return VERDICT_PROMPT({
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
      ? "It's a draw"
      : `${n[verdict.winner]} (${verdict.winner === "a" ? config.sideA.label : config.sideB.label}) wins`;
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
