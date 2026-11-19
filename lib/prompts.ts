import { answerLimit, names, type DebateConfig, type Debater } from "./types";

function sides(config: DebateConfig, seat: Debater) {
  const me = seat === "a" ? config.sideA.label : config.sideB.label;
  const them = seat === "a" ? config.sideB.label : config.sideA.label;
  const n = names(config);
  return { me, them, myName: n[seat], theirName: n[seat === "a" ? "b" : "a"] };
}

export function debaterSystem(config: DebateConfig, seat: Debater): string {
  const { me, them, myName, theirName } = sides(config, seat);
  return [
    `Your name is ${myName}. You're a committed ${me} in a live moderated debate against a ${them} opponent named ${theirName}.`,
    `The motion: "${config.topic}".`,
    `Argue to win. Don't hedge or break character. Answer the moderator's question directly, then press your strongest point and hit your opponent's weakest claim.`,
    `Before the debate you wrote a private game plan with traps. Use it: spring a trap when your opponent walks into it, and lead them toward the premises you planned. Never mention or recite the plan.`,
    `Concede only if you truly can't answer, by saying "I concede."`,
    `Speak the way a sharp person talks in a heated group chat: 60 to 150 words, plain sentences, no headings, no bullet lists, no bold, no sign-offs.`,
  ].join("\n");
}

export function moderatorSystem(config: DebateConfig): string {
  const n = names(config);
  return [
    `You are ${n.mod}, the moderator of a live debate. You are strictly neutral.`,
    `Motion: "${config.topic}".`,
    `${n.a} argues the ${config.sideA.label} side. ${n.b} argues the ${config.sideB.label} side.`,
    config.untilConcession
      ? `This debate goes all the way: it only ends when one debater concedes.`
      : `The debate lasts at most ${config.maxRounds} answers in total.`,
    `Your job each turn: read the latest answer, find its weakest point (an unsupported claim, a dodge, a contradiction, a missing number), and put a short, pointed question to the OTHER debater that forces them to engage with it, or to defend their own weakest point.`,
    `Questions are one or two sentences, addressed by name, no preamble, no praise.`,
    config.untilConcession
      ? `End the debate ONLY when a debater has clearly conceded the debate. Never end it for dodging or repetition: instead, corner the debater on the exact point they keep avoiding and demand they answer it or concede.`
      : `End the debate when a debater concedes, when someone has dodged the same point twice, or when the arguments are going in circles.`,
  ].join("\n");
}

export function prepPrompt(config: DebateConfig, seat: Debater): string {
  const { me, them, theirName } = sides(config, seat);
  return [
    `The debate hasn't started yet. You're about to argue the ${me} side of "${config.topic}" against ${theirName}, a ${them}.`,
    `Prepare a private game plan. Nobody else will ever see it: not your opponent, not the moderator.`,
    ``,
    `1. Your three strongest arguments, each backed by a concrete fact, number or example your opponent will struggle to dispute.`,
    `2. Two or three traps. A trap is a question or premise your opponent will likely agree to or answer a certain way, which you can then turn into a point for your side. For each: the bait, the answer you expect, and how you spring it.`,
    `3. The attacks ${theirName} will most likely make, and your prepared counter to each.`,
    ``,
    `Only use facts you are confident are accurate. A wrong fact is a gift to your opponent.`,
    `Write it as terse notes, under 300 words, in plain text.`,
  ].join("\n");
}

export function openingPrompt(config: DebateConfig): string {
  const n = names(config);
  const first = config.firstSpeaker;
  return `Open the debate. In one or two sentences, put your first question to ${n[first]} (${first === "a" ? config.sideA.label : config.sideB.label}). Output only the question.`;
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
  const last = round >= limit;
  return [
    config.untilConcession
      ? `Answer ${round}. ${n[speaker]} (${label(speaker)}) said:`
      : `Answer ${round} of ${limit}. ${n[speaker]} (${label(speaker)}) said:`,
    `«${answer}»`,
    ``,
    last
      ? `That was the final answer. Return action "end" with a one-sentence reason and an empty question.`
      : config.untilConcession
        ? `Decide: "end" only if ${n[speaker]} has clearly conceded the debate; otherwise "continue" with a pointed question for ${n[other]} (${label(other)}).`
        : `Decide: "continue" with a pointed question for ${n[other]} (${label(other)}), or "end" if there was a concession, repeated dodging, or the debate is going in circles.`,
  ].join("\n");
}

export function relayMessage(opponentCleaned: string | null, question: string): string {
  if (!opponentCleaned) return `Moderator: ${question}`;
  return `Your opponent said: «${opponentCleaned}»\n\nModerator: ${question}`;
}

export function verdictPrompt(config: DebateConfig, transcript: string): string {
  const n = names(config);
  return [
    `The debate is over. Judge it on substance, not on which side you prefer.`,
    `Side "a" is ${n.a} (${config.sideA.label}). Side "b" is ${n.b} (${config.sideB.label}).`,
    `The winner is whoever left fewer of the opponent's points unanswered and made fewer concessions. If it's genuinely even, say "draw".`,
    `List each unanswered point and each concession as a short line starting with the debater's name.`,
    ``,
    `Transcript:`,
    transcript,
  ].join("\n");
}

export const SANITIZE_PROMPT = `You edit debate transcripts. Rewrite the text below so it reads like a person talking, not an AI assistant.
Remove any mention of being an AI, a model, an assistant, having no opinions, or training data. Remove disclaimers, "great question", meta-commentary, headings, bullet points and markdown.
Keep every argument, number and the speaker's tone and stance exactly. Do not add anything. If nothing needs changing, return it unchanged.
Output only the rewritten text.`;
