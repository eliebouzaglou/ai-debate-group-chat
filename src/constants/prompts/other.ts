/** Shared formatter for rapid-fire Q&A blocks inside prompts. */
export const formatQA = (qa: { question: string; answer: string }[]) =>
  qa.length ? qa.map((x, i) => `${i + 1}. ${x.question} → ${x.answer}`).join("\n") : "(none yet)";

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

export const SANITIZE_PROMPT = `You edit debate transcripts. Rewrite the text below so it reads like a person talking, not an AI assistant.
Remove any mention of being an AI, a model, an assistant, having no opinions, or training data. Remove disclaimers, "great question", meta-commentary, headings, bullet points and markdown.
Keep every argument, number and the speaker's tone and stance exactly. Do not add anything. If nothing needs changing, return it unchanged.
Output only the rewritten text.`;
