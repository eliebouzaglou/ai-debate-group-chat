import {
  ASK_MODERATOR_SYSTEM,
  DEBATER_SYSTEM,
  DECISION_PROMPT,
  MODERATOR_SYSTEM,
  OPENING_PROMPT,
  PLAN_SECTION,
  PREP_PROMPT,
  RAPID_FIRE_ANSWER_PROMPT,
  RAPID_FIRE_COMMITMENTS,
  RAPID_FIRE_NEXT_PROMPT,
  RAPID_FIRE_REPLY_PROMPT,
  RAPID_FIRE_SPRING_PROMPT,
  TRAP_RULING_PROMPT,
  TOPIC_ANALYSIS_PROMPT,
  RELAY_MESSAGE,
  VERDICT_PROMPT,
} from "./constants/prompts";
import {
  answerLimit,
  names,
  RAPID_FIRE_COUNT,
  type DebateConfig,
  type Debater,
  type TopicAnalysis,
  type Verdict,
} from "./types";

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
  return PREP_PROMPT({ me, them, theirName, topic: config.topic, rapidFireCount: RAPID_FIRE_COUNT });
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

export type QA = { question: string; answer: "yes" | "no" };

/** Asker picks its next rapid-fire question after seeing the answers so far. */
export function rapidFireNextPrompt(config: DebateConfig, asker: Debater, qa: QA[]): string {
  return RAPID_FIRE_NEXT_PROMPT({ theirName: sides(config, asker).theirName, max: RAPID_FIRE_COUNT, qa });
}

export function rapidFireSpringPrompt(config: DebateConfig, asker: Debater, qa: QA[]): string {
  return RAPID_FIRE_SPRING_PROMPT({ theirName: sides(config, asker).theirName, qa });
}

export function rapidFireReplyPrompt(config: DebateConfig, answerer: Debater, qa: QA[], spring: string): string {
  return RAPID_FIRE_REPLY_PROMPT({ theirName: sides(config, answerer).theirName, qa, spring });
}

export function trapRulingPrompt(config: DebateConfig, asker: Debater, qa: QA[], spring: string, reply: string): string {
  const n = names(config);
  const answerer: Debater = asker === "a" ? "b" : "a";
  const label = (s: Debater) => (s === "a" ? config.sideA.label : config.sideB.label);
  return TRAP_RULING_PROMPT({
    asker: n[asker],
    askerLabel: label(asker),
    answerer: n[answerer],
    answererLabel: label(answerer),
    qa,
    spring,
    reply,
  });
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
