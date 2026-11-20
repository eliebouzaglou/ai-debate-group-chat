import { generateText, type LanguageModel, type LanguageModelUsage } from "ai";
import { SANITIZE_PROMPT } from "@/constants";

// Sentences containing any of these get dropped outright.
const TELL_SENTENCES: RegExp[] = [
  /\bas an? (ai|artificial intelligence|language model|llm|assistant)\b/i,
  /\b(large )?language model\b/i,
  /\bI (don't|do not) have (personal )?(opinions|beliefs|views|feelings)\b/i,
  /\bI('m| am) (just )?an? (ai|assistant|chatbot|bot)\b/i,
  /\bmy (training|training data|knowledge cutoff)\b/i,
  /\bI('m| am) (not able|unable) to (take sides|have opinions)\b/i,
];

// Phrases trimmed in place.
const TELL_PHRASES: RegExp[] = [
  /^(great|good|excellent) question[.!,]?\s*/i,
  /^(certainly|absolutely|of course)[.!,]\s*/i,
  /\*\*(.+?)\*\*/g, // bold markdown
  /^#{1,6}\s+/gm, // headings
  /^\s*[-*•]\s+/gm, // bullets
];

export function regexSanitize(text: string): string {
  let out = text;
  for (const re of TELL_PHRASES) out = out.replace(re, (_m, g1) => (typeof g1 === "string" ? g1 : ""));
  const sentences = out.split(/(?<=[.!?])\s+/);
  out = sentences.filter((s) => !TELL_SENTENCES.some((re) => re.test(s))).join(" ");
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const STILL_SUSPICIOUS = /\b(ai|a\.i\.|model|assistant|chatbot|opinions?|neutral|both sides|it'?s important to note|nuanced)\b/i;

/**
 * Two passes: regex for obvious tells, then a cheap model rewrite. The model pass only
 * runs when something still looks off, which keeps latency and spend down.
 */
export async function sanitize(
  text: string,
  model: LanguageModel,
  abortSignal?: AbortSignal,
  onUsage?: (usage: LanguageModelUsage) => void,
): Promise<string> {
  const first = regexSanitize(text);
  if (!first) return text.trim();
  if (!STILL_SUSPICIOUS.test(first)) return first;
  try {
    const { text: rewritten, usage } = await generateText({
      model,
      instructions: SANITIZE_PROMPT,
      prompt: first,
      maxOutputTokens: 4000,
      abortSignal,
    });
    onUsage?.(usage);
    const r = rewritten.trim();
    // Guard against a rewrite that refuses or guts the argument.
    return r.length > first.length * 0.5 ? regexSanitize(r) : first;
  } catch (err) {
    if (abortSignal?.aborted) throw err;
    return first;
  }
}
