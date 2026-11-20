import { formatQA } from "./other";

export const COACH_SYSTEM = `You are a sharp, well-read debate coach. Your client is about to debate, and you help them win: you find the strongest real arguments for their side, built from things their opponent is genuinely committed to. You're straight with them about risks, but you never talk them out of trying to win. You cite only sources you're sure exist and say what you claim.`;

export const COACH_PREP_PROMPT = (n: {
  myName: string;
  me: string;
  theirName: string;
  them: string;
  topic: string;
  brief: string;
  rapidFireCount: number;
}) => `
I'm ${n.myName}, and I'm about to debate ${n.theirName} on "${n.topic}". I'm arguing for ${n.me}; ${n.theirName} argues for ${n.them}.

Background my research partner put together:
${n.brief}

Format: it opens with a rapid-fire round. I ask ${n.theirName} up to ${n.rapidFireCount} yes/no questions in a row; their answers are final and can't be taken back. Then I state my conclusion, and ${n.theirName} gets one reply. If my chain holds, I win on the spot. If not, we go into a longer back-and-forth with a moderator.

I need the strongest plan possible to win. Don't explain why it can't be done; find the chain most likely to corner ${n.theirName}, built from things they're committed to. One line at the end on the biggest risk is fine.

1. UNDENIABLE FACTS (3 to 5): exact claim, exact source (author or organisation, title, year, and the exact section, page or passage), and why ${n.theirName} has to accept it.
2. KNOCKOUT CHAIN (3 to ${n.rapidFireCount} yes/no questions). The best questions simply ask what a source or a fact says, so there's only one honest answer. For each: the wording, the answer ${n.theirName} must give, and why they can't give the other.
3. THE SPRING: exactly what I say after the answers. Spell out why each answer forces the next step, including the step they'll try to deny (timing, scope, which text).
4. THEIR ESCAPES: the two or three ways out ${n.theirName} will reach for, and the exact line that shuts each one.
5. THEIR CHAIN AGAINST ME: what they'll likely fire at me, its weakest step, and my honest answers that keep my position standing.
6. MOVE LIST for the long debate (4 to 6 moves, one per answer): goal, the fact or answer I use, and what I need ${n.theirName} to admit. The last move is where they have to concede or contradict themselves.

Terse notes in plain text, under 600 words.
`.trim();

export const PLAN_REVISE_PROMPT = (notes: string) => `
A fact-checker reviewed the plan:

${notes}

Fix every real problem: correct or drop wrong citations, replace questions that aren't forced, and add lines for unshut escapes. Keep everything that was sound. Output the full revised plan only, same sections, under 600 words.
`.trim();

export const SELF_CHECK_PROMPT = (n: {
  myName: string;
  me: string;
  theirName: string;
  topic: string;
  qa: { question: string; answer: string }[];
  spring: string;
}) => `
I'm ${n.myName}, arguing for ${n.me} on "${n.topic}". ${n.theirName} just ran their rapid-fire questions on me. My answers are on the record and final; I can explain what I meant, but I can't take any of them back:
${formatQA(n.qa)}

Then ${n.theirName} said:
«${n.spring}»

Did they beat me? Be straight with me. Only two answers — no middle ground, no "partly":
- "beaten": their chain forces my position to fail, and I can't show a false premise or a broken step without taking back an answer. I forfeit.
- "not_beaten": there is a real hole in what they said — a false premise, a broken step, or a fact that doesn't hold. I name it and fight.
If I'm unsure, or I only lost a side point but my position still stands, that is "not_beaten" — I must name the hole. If I can't name one, I am beaten and I forfeit.
Tell me which of my answers or claims was a mistake, if any.
Then give me exactly what to say back: 40 to 110 words, plain speech. If beaten: a short, gracious forfeit that includes the words "I concede." If not beaten: name the exact premise that's false or the step that doesn't follow, with a source if I use a fact. No hedging about being "partly" right. I can't reverse an answer, so work within them.
`.trim();
