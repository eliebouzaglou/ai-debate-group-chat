import { generateText, type LanguageModel, type LanguageModelUsage } from "ai";
import { SANITIZE_PROMPT, TELL_SENTENCES, TELL_PHRASES, STILL_SUSPICIOUS } from "@/constants";
import { createRegexSanitizer } from "@/utils";

const regexSanitize = createRegexSanitizer({
  phrasePatterns: TELL_PHRASES,
  sentencePatterns: TELL_SENTENCES,
  normalizeWhitespace: true,
});

/**
 * Regex + LLM sanitizes AI Outputs
 */
export async function sanitize(text: string, model: LanguageModel, abortSignal?: AbortSignal, onUsage?: (usage: LanguageModelUsage) => void): Promise<string> {
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
    return (r.length > first.length * 0.5) ? regexSanitize(r) : first;
  }
  catch (err) {
    if (abortSignal?.aborted) throw err;
    return first;
  }
}
