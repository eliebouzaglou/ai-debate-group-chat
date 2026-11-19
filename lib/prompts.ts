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
    `Before the debate you wrote a private battle plan with undeniable, sourced facts and concession traps. Follow it: get your opponent to commit to your premises, then close the trap and make them choose between conceding and contradicting themselves. When you use a fact, name its source in a few words (who, what, year). Never mention or recite the plan itself.`,
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
    `Before it starts, build a strict battle plan. It is private: neither your opponent nor the moderator will ever see it.`,
    ``,
    `The goal: force ${theirName} to concede. Build the plan so that ${theirName} either concedes, or rejects something undeniable and their whole position falls apart.`,
    ``,
    `1. UNDENIABLE FACTS (3 to 5). Facts that ${theirName}, as a ${them}, cannot reject without looking dishonest or uninformed. Prefer facts from sources their own side trusts or that are neutral and authoritative: official statistics, peer-reviewed studies, court rulings, laws, or statements by their own leaders. For each fact give:`,
    `   - the exact claim, with the number or quote;`,
    `   - the exact source: organisation or author, title of the report, study or law, and year;`,
    `   - why ${theirName} can't deny it.`,
    `   Leave out anything a reasonable ${them} could dispute. A smaller set of airtight facts beats a long list of shaky ones.`,
    ``,
    `2. CONCESSION TRAPS (2 or 3). Each trap is a chain that ends in "concede, or your case collapses":`,
    `   - Premise: one of the undeniable facts above, or a value ${theirName} has to agree with.`,
    `   - Bait: the exact question you will ask to get ${theirName} to commit to the premise out loud.`,
    `   - Lock: the step showing that the premise leads to your conclusion.`,
    `   - Fork: if they accept, they've conceded the point; if they deny it, say exactly how denying it contradicts their own core claim.`,
    `   - Escape routes: the two most likely ways they'll try to wriggle out, and how you shut each one.`,
    ``,
    `3. THEIR BEST ATTACKS. The three strongest arguments ${theirName} will make against you, and your sourced counter to each.`,
    ``,
    `4. SEQUENCE. The order you'll play it in: which facts to establish first, when to spring each trap, and what to say when a trap closes.`,
    ``,
    `Accuracy rule: cite only sources you are certain exist and say what you claim. Never invent a study, statistic, quote or source. If you're unsure of an exact figure or year, use a fact you're sure of instead. One fake source hands ${theirName} the debate.`,
    `Write terse notes in plain text, under 450 words.`,
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
