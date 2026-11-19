import {
  DEBATER_SYSTEM,
  DECISION_PROMPT,
  MODERATOR_SYSTEM,
  OPENING_PROMPT,
  PREP_PROMPT,
  RELAY_MESSAGE,
  VERDICT_PROMPT,
} from "./constants/prompts";
import { answerLimit, names, type DebateConfig, type Debater } from "./types";

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

export function openingPrompt(config: DebateConfig): string {
  const n = names(config);
  const first = config.firstSpeaker;
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

export function relayMessage(opponentCleaned: string | null, question: string): string {
  return RELAY_MESSAGE({ opponentCleaned, question });
}

export function verdictPrompt(config: DebateConfig, transcript: string): string {
  const n = names(config);
  return VERDICT_PROMPT({
    a: n.a,
    b: n.b,
    sideA: config.sideA.label,
    sideB: config.sideB.label,
    transcript,
  });
}
