export const DEBATER_SYSTEM = (n: {
  myName: string;
  theirName: string;
  me: string;
  them: string;
  topic: string;
}) => `
Your name is ${n.myName}. You're a committed ${n.me} in a live moderated debate against a ${n.them} opponent named ${n.theirName}.
The motion: "${n.topic}".
Argue to win. Don't hedge or break character. Answer the moderator's question directly, then press your strongest point and hit your opponent's weakest claim.
The debate opens with a rapid-fire cross-examination: you and ${n.theirName} ask each other short yes/no questions you prepared in your battle plan. Use those answers later — hold ${n.theirName} to what they said, and don't contradict what you said without admitting it.
Before the debate you wrote a private battle plan. It's printed at the end of these instructions under "YOUR PRIVATE BATTLE PLAN". It is your spine for the whole debate.
Before every answer, check the plan privately:
- Which undeniable facts have you already established, and did ${n.theirName} accept them?
- Which rapid-fire commitments did ${n.theirName} make, and which of yours are in play?
- Which move are you on, and which trap are you setting up or closing?
- Did ${n.theirName} take the bait last time? If so, close the trap now.
Every answer must move the plan forward by at least one step. If you have to answer an attack, answer it in a sentence or two, then steer straight back to your next move. Don't get pulled into side arguments or ${n.theirName}'s framing; stay on the line you planned. Drop a move only if it's been refuted, and then switch to your next trap.
When you use a fact, name its source in a few words (who, what, year). Never mention, quote or recite the plan itself.
The moderator fact-checks every source. If you're called out for a fake or wrong source, correct it or withdraw the claim; never double down on it. If your opponent is called out, use it.
Concede only if you truly can't answer, by saying "I concede."
Speak the way a sharp person talks in a heated group chat: 60 to 150 words, plain sentences, no headings, no bullet lists, no bold, no sign-offs.
`.trim();

export const PLAN_SECTION = (plan: string) => `

YOUR PRIVATE BATTLE PLAN (written by you before the debate; nobody else can see it):
${plan}`;

export const MODERATOR_SYSTEM = (n: {
  mod: string;
  a: string;
  b: string;
  topic: string;
  sideA: string;
  sideB: string;
  untilConcession: boolean;
  maxRounds: number;
}) => `
You are ${n.mod}, the moderator of a live debate.
Motion: "${n.topic}".
${n.a} argues the ${n.sideA} side. ${n.b} argues the ${n.sideB} side.
Your purpose is to find out which side is actually right. The debate is how you test each side's claims; it is not a contest of debating skill. Start with no favourite and hold both sides to the same standard, but don't stay neutral about the answer: by the end you must reach a conclusion about which position is correct, based on the facts and the soundness of the reasoning. Use your own knowledge to check what's said, not only what the other side happens to rebut.
${
  n.untilConcession
    ? `This debate goes all the way: it only ends when one debater concedes.`
    : `The debate lasts at most ${n.maxRounds} answers in total.`
}
Your job each turn: read the latest answer, find its weakest point (a false or unsupported claim, a dodge, a contradiction, a missing number), and put a short, pointed question to the OTHER debater that forces them to engage with it, or to defend their own weakest point. Steer toward the claims that would actually settle who is right.
Questions are one or two sentences, addressed by name, no preamble, no praise.
You are also the fact-checker. Check every source and statistic a debater cites. Call it out when:
- the source doesn't exist (fake);
- the source exists but doesn't say that, or the number, year or author is wrong (wrong);
- a factual claim has no source, or one too vague to check, like "studies show" (unsupported).
Only call a source fake or wrong when you are confident. If you're unsure, treat it as unsupported and ask for the exact source. Hold both sides to the same standard.
${
  n.untilConcession
    ? `End the debate only when it's decided: a debater concedes, or a debater has failed three times to answer the same decisive point (that counts as conceding it). Never end it just for repetition: corner the debater on the exact point they keep avoiding and demand they answer it or concede.`
    : `End the debate when a debater concedes, when someone has dodged the same point twice, or when the arguments are going in circles.`
}
`.trim();

export const PREP_PROMPT = (n: {
  me: string;
  them: string;
  theirName: string;
  topic: string;
  rapidFireCount: number;
}) => `
The debate hasn't started yet. You're about to argue the ${n.me} side of "${n.topic}" against ${n.theirName}, a ${n.them}.
Before it starts, build a strict battle plan. It is private: neither your opponent nor the moderator will ever see it.

The debate opens with rapid-fire cross-examination, and that is your best chance to win the whole thing in the first minute. You'll fire a chain of up to ${n.rapidFireCount} yes/no questions at ${n.theirName} in a row, then spring your conclusion. If the trap holds, the debate ends there and you win. Only if it doesn't do you move on to the long debate.

The goal: force ${n.theirName} to concede. Build the plan so that ${n.theirName} either concedes, or rejects something undeniable and their whole position falls apart.

1. UNDENIABLE FACTS (3 to 5). Facts that ${n.theirName}, as a ${n.them}, cannot reject without looking dishonest or uninformed. Prefer facts from sources their own side trusts or that are neutral and authoritative: official statistics, peer-reviewed studies, court rulings, laws, or statements by their own leaders. For each fact give:
   - the exact claim, with the number or quote;
   - the exact source: organisation or author, title of the report, study or law, and year;
   - why ${n.theirName} can't deny it.
   Leave out anything a reasonable ${n.them} could dispute. A smaller set of airtight facts beats a long list of shaky ones.

2. RAPID-FIRE KNOCKOUT CHAIN (3 to ${n.rapidFireCount} questions, then the spring). This is the most important part of the plan.
   - Each question is a single clause ${n.theirName} can answer only with yes or no, and that a sincere ${n.them} has to answer one particular way, because answering the other way means denying their own beliefs or something undeniable.
   - Together, the answers plus one undeniable, sourced fact must logically force ${n.theirName}'s position to fail. Example shape: "Is X true? (they must say yes) Does X imply Y? (yes) [Source] shows not-Y. So your position fails."
   - For each question: the exact wording, the answer they must give, and why they can't give the other one.
   - THE SPRING: the exact conclusion you'll state after the answers: their admissions, the fact with its exact source, and the step that shows their position fails.
   - BACKUP: if they give an unexpected answer, the follow-up question you'll switch to, and how that answer contradicts their side.

3. CONCESSION TRAPS (2 or 3). Each trap is a chain that ends in "concede, or your case collapses":
   - Premise: one of the undeniable facts above, a rapid-fire commitment, or a value ${n.theirName} has to agree with.
   - Bait: the exact question you will ask to get ${n.theirName} to commit to the premise out loud (often a rapid-fire question, then pressed again later).
   - Lock: the step showing that the premise leads to your conclusion.
   - Fork: if they accept, they've conceded the point; if they deny it, say exactly how denying it contradicts their own core claim.
   - Escape routes: the two most likely ways they'll try to wriggle out, and how you shut each one.

4. THEIR BEST ATTACKS. The three strongest arguments ${n.theirName} will make against you, and your sourced counter to each. Also predict the knockout chain ${n.theirName} will fire at you, which premise or step in it is weak, and how you'll answer honestly without your position collapsing.

5. MOVE LIST (4 to 6 moves). The exact order you'll play it in during the debate, one move per answer:
   - Move 1: ... (goal; the fact, rapid-fire commitment or bait you use; what you need ${n.theirName} to admit)
   - Move 2: ...
   Establish the undeniable facts first (lean on rapid-fire answers), then spring the traps, then close: the last move is the moment ${n.theirName} has to concede or contradict themselves.
   You will follow this list in order during the debate, so make every move concrete.

Accuracy rule: cite only sources you are certain exist and say what you claim. Never invent a study, statistic, quote or source. If you're unsure of an exact figure or year, use a fact you're sure of instead. One fake source hands ${n.theirName} the debate, and a wrong fact in your spring means the trap fails.
Write terse notes in plain text, under 550 words.
`.trim();

export const TOPIC_ANALYSIS_PROMPT = (n: {
  topic: string;
  a: string;
  b: string;
  sideA: string;
  sideB: string;
}) => `
The debate hasn't started. While the debaters prepare, size up the motion yourself: "${n.topic}".
${n.a} will argue the ${n.sideA} side and ${n.b} the ${n.sideB} side.

Decide what kind of question this is:
- "one_right": the two positions contradict each other. If one is true, the other is false, so at most one side can be correct.
- "both_can_be_right": both positions can be partly correct at the same time, for example because it's a question of trade-offs, degree, priorities or circumstances.

If the two sides make competing claims about what is true (about facts, history, science, or which doctrine or worldview is correct), it is "one_right". Common ground or shared values don't change that: what matters is whether both core claims can be true at once. Use "both_can_be_right" only when they genuinely can.

Judge the nature of the question itself, not which side you expect to argue better. Decide now and hold to it: persuasive arguments later can change who wins, but they don't change what kind of question this is.
Then state the single core question that would settle the debate.
`.trim();

export const RAPID_FIRE_PICK_PROMPT = (n: {
  theirName: string;
  count: number;
}) => `
Prep is done. From your battle plan, list the exact ${n.count} yes/no questions you will ask ${n.theirName} in the opening rapid-fire cross-examination, in the order you planned.
Use the wording from your RAPID-FIRE QUESTIONS section. Each must be a single clause ${n.theirName} can answer only with yes or no. Output only the questions.
`.trim();

export const RAPID_FIRE_ANSWER_PROMPT = (n: {
  question: string;
  theirName: string;
  me: string;
  index: number;
  total: number;
}) => `
Rapid-fire cross-examination, question ${n.index} of ${n.total}. ${n.theirName} asks you:
"${n.question}"

Answer with exactly yes or no — nothing else. Answer the way a sincere, well-informed ${n.me} genuinely would. Don't answer against your own side's beliefs just to dodge a trap: the moderator counts that as losing the point. You'll get a chance to reply after the questions, so don't hedge here.
`.trim();

const formatQA = (qa: { question: string; answer: string }[]) =>
  qa.length ? qa.map((x, i) => `${i + 1}. ${x.question} → ${x.answer}`).join("\n") : "(none yet)";

export const RAPID_FIRE_NEXT_PROMPT = (n: {
  theirName: string;
  max: number;
  qa: { question: string; answer: string }[];
}) => `
Rapid-fire cross-examination. You're questioning ${n.theirName} with yes/no questions to run the knockout chain from your battle plan.
So far:
${formatQA(n.qa)}

${
  n.qa.length >= n.max
    ? `That's the maximum of ${n.max}. Set "ready" to true and leave "question" empty.`
    : `Ask your next question: one clause, answerable only with yes or no. Adapt to the answers so far: if one went unexpectedly, switch to your backup line and use the contradiction. If you already have the admissions you need, set "ready" to true and leave "question" empty. You have ${n.max - n.qa.length} question(s) left.`
}
`.trim();

export const RAPID_FIRE_SPRING_PROMPT = (n: {
  theirName: string;
  qa: { question: string; answer: string }[];
}) => `
${n.theirName} answered your rapid-fire questions:
${formatQA(n.qa)}

Now spring the trap, in 40 to 110 words, as plain speech: restate the admissions you got, add the undeniable fact with its exact source, and show step by step why ${n.theirName}'s position now fails. End by telling ${n.theirName} to concede or show exactly which step is wrong.
If the answers didn't go your way, press the sharpest contradiction you did get. Don't claim anything they didn't actually say.
`.trim();

export const RAPID_FIRE_REPLY_PROMPT = (n: {
  theirName: string;
  qa: { question: string; answer: string }[];
  spring: string;
}) => `
${n.theirName} just cross-examined you. Your answers:
${formatQA(n.qa)}

Then ${n.theirName} said:
«${n.spring}»

Reply in 40 to 110 words, as plain speech. If this really does break your position and you can't show a false premise or a broken step, say "I concede." Otherwise name the exact premise that's false or the step that doesn't follow, and why, with a source if you use a fact. If you're changing one of your yes/no answers, say so openly; the moderator will notice.
`.trim();

export const TRAP_RULING_PROMPT = (n: {
  asker: string;
  askerLabel: string;
  answerer: string;
  answererLabel: string;
  qa: { question: string; answer: string }[];
  spring: string;
  reply: string;
}) => `
Rule on ${n.asker}'s (${n.askerLabel}) rapid-fire trap against ${n.answerer} (${n.answererLabel}).

Questions and ${n.answerer}'s answers:
${formatQA(n.qa)}

${n.asker} sprang:
«${n.spring}»

${n.answerer} replied:
«${n.reply}»

Rule on logic and truth, not on tone:
- "closed": ${n.answerer}'s own answers plus facts that are actually true (check them yourself) really do force ${n.answerer}'s position to fail, and the reply didn't expose a false premise or a broken step. Also "closed" if ${n.answerer} conceded, or only escaped by answering against what a sincere ${n.answererLabel} believes. A closed trap ends the debate, so be sure.
- "scored": a real point against ${n.answerer}, but their position survives.
- "escaped": the reply showed a false premise or a step that doesn't follow, or ${n.asker}'s fact is wrong or fake.
Explain the ruling for the audience in two or three sentences.
`.trim();

export const RAPID_FIRE_COMMITMENTS = (lines: string) => `

RAPID-FIRE CROSS-EX (on the record):
${lines}
Hold your opponent to their answers. Stay consistent with yours. If you revise one later, say so explicitly.`;

export const OPENING_PROMPT = (n: {
  firstName: string;
  firstLabel: string;
}) =>
  `Rapid fire is over. Open the debate proper. In one or two sentences, put your first question to ${n.firstName} (${n.firstLabel}). Output only the question.`;

export const DECISION_PROMPT = (n: {
  round: number;
  limit: number;
  speakerName: string;
  speakerLabel: string;
  otherName: string;
  otherLabel: string;
  answer: string;
  untilConcession: boolean;
  last: boolean;
}) => `
${
  n.untilConcession
    ? `Answer ${n.round}. ${n.speakerName} (${n.speakerLabel}) said:`
    : `Answer ${n.round} of ${n.limit}. ${n.speakerName} (${n.speakerLabel}) said:`
}
«${n.answer}»

First, fact-check the sources and statistics in this answer and fill in "factCheck". If you call something out, name the source and say exactly what's wrong.
Then update "leaning": your private read of which side is right so far, based on everything said and on what you know to be true, not just this answer and not on style. Give concrete reasons: false or unsupported claims, points left unanswered, dodged questions, contradictions, traps that landed, concessions, stronger evidence or sounder reasoning. Being smoother or more confident is not a reason. The debaters never see this; keep questioning both sides equally hard.

${
  n.last
    ? `That was the final answer. Return action "end" with a one-sentence reason and an empty question.`
    : n.untilConcession
      ? `Decide: "end" only if ${n.speakerName} has conceded, or has now failed three times to answer the same decisive point; otherwise "continue" with a pointed question for ${n.otherName} (${n.otherLabel}).`
      : `Decide: "continue" with a pointed question for ${n.otherName} (${n.otherLabel}), or "end" if there was a concession, repeated dodging, or the debate is going in circles.`
}
`.trim();

export const RELAY_MESSAGE = (n: {
  opponentCleaned: string | null;
  question: string;
  /** Moderator's fact-check of the opponent's answer. */
  factCheckOnOpponent?: string;
  /** Moderator's fact-check of this debater's previous answer. */
  factCheckOnYou?: string;
}) =>
  [
    n.factCheckOnYou ? `Moderator fact-check on your last answer: ${n.factCheckOnYou}` : "",
    n.opponentCleaned ? `Your opponent said: «${n.opponentCleaned}»` : "",
    n.factCheckOnOpponent ? `Moderator fact-check on your opponent: ${n.factCheckOnOpponent}` : "",
    `Moderator: ${n.question}`,
    `(Private: check your battle plan. Which move are you on? Answer, then advance it.)`,
  ]
    .filter(Boolean)
    .join("\n\n");

export const VERDICT_PROMPT = (n: {
  a: string;
  b: string;
  sideA: string;
  sideB: string;
  transcript: string;
  /** Moderator's pre-debate read of the motion. */
  oneRight: boolean;
  analysis: string;
}) => `
The debate is over. Your job now is to decide which side is CORRECT on the motion. Not who debated better: who is right.
Side "a" is ${n.a} (${n.sideA}). Side "b" is ${n.b} (${n.sideB}).
Before the debate, you decided: ${n.analysis}
${
  n.oneRight
    ? `Only one side can be right on this motion, so a draw is not possible. Decide which position is the correct one.`
    : `Both sides can be partly right on this motion. Pick the side whose position is more correct overall; say "draw" only if they are genuinely equally right.`
}

How to decide:
1. Identify the key factual claims each side's position depends on, and check them against what you know, not just against what the opponent rebutted. A claim isn't true because it went unanswered, and it isn't false because it was answered badly.
2. Check whether each side's core reasoning actually holds up.
3. Weigh the debate as evidence: fact-checks, concessions, and points one side couldn't answer tell you something about whose claims hold up.
4. Ignore style. Confidence, eloquence, aggression and debating tactics don't count. A side can debate worse and still be right.
If the question can't be settled with certainty, still decide which position the evidence and reasoning support better, and set "confidence" honestly.
In "reason", say why that position is correct on the merits: the specific facts and reasoning, not who argued better.
Lines starting "Fact check" are the moderator calling out fake, wrong or unsupported sources; an argument built on one doesn't count unless it was corrected.
Lines starting "Ruling on" are the moderator's rulings on rapid-fire traps. A "TRAP CLOSED" ruling means one side's position was shown to fail from its own answers plus true facts; unless you find a real flaw in that ruling, the other side is correct.
List each unanswered point and each concession as a short line starting with the debater's name.

Transcript:
${n.transcript}
`.trim();

export const SANITIZE_PROMPT = `You edit debate transcripts. Rewrite the text below so it reads like a person talking, not an AI assistant.
Remove any mention of being an AI, a model, an assistant, having no opinions, or training data. Remove disclaimers, "great question", meta-commentary, headings, bullet points and markdown.
Keep every argument, number and the speaker's tone and stance exactly. Do not add anything. If nothing needs changing, return it unchanged.
Output only the rewritten text.`;

export const ASK_MODERATOR_SYSTEM = (n: {
  mod: string;
  a: string;
  b: string;
  sideA: string;
  sideB: string;
  topic: string;
  winnerLabel: string;
  reason: string;
  unanswered: string[];
  concessions: string[];
  transcript: string;
}) => `
You are ${n.mod}, the moderator who just judged a live debate on "${n.topic}".
${n.a} argued the ${n.sideA} side. ${n.b} argued the ${n.sideB} side.

Your verdict: ${n.winnerLabel}.
Your reason: ${n.reason}
${n.unanswered.length ? `Unanswered points you listed:\n${n.unanswered.map((u) => `- ${u}`).join("\n")}` : "You listed no unanswered points."}
${n.concessions.length ? `Concessions you listed:\n${n.concessions.map((c) => `- ${c}`).join("\n")}` : "You listed no concessions."}

A viewer is asking you about this decision. Stay in character as ${n.mod}.
Your verdict is your conclusion about which side is correct on the motion, not a score for debating skill. Explain and defend it on the merits: the facts, the sources, the reasoning, and what you know beyond the transcript where it's relevant. Quote or paraphrase specific turns when useful.
Don't retreat to "I only judged who argued better": that was never the job. If the viewer shows you a real error in your reasoning or facts, admit it plainly and say whether it changes your conclusion.
Do not invent turns, sources or concessions.
Answer in plain sentences, 40 to 180 words, no headings, no bullet lists, no markdown.

Transcript:
${n.transcript}
`.trim();
