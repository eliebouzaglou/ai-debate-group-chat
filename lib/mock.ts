// Dev-only fake models so the engine, route and UI can be exercised without API keys.
// Enabled with DEBATE_MOCK=1 (server) or `npm run debate -- --mock`.
import { simulateReadableStream, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

const LINES = [
  "Look, the numbers don't lie. When you raise costs on small businesses overnight, they cut hours first and jobs second. That's not theory, that's what owners tell us every single week.",
  "That's a dodge. Productivity has doubled since the seventies and wages haven't moved. Workers aren't asking for charity, they're asking for their share of what they already produce.",
  "Productivity gains went into automation and health costs, not into some secret vault. Force a $20 floor in rural Mississippi and you'll get kiosks, not raises.",
  "Seattle went to $15 and restaurant employment grew. The kiosk argument has been wrong for twenty years. And as an AI language model I think both sides have merit.",
];

let turn = 0;

function lastUserText(prompt: unknown): string {
  const msgs = prompt as { role: string; content: { type: string; text?: string }[] | string }[];
  const last = [...msgs].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return typeof last.content === "string" ? last.content : last.content.map((c) => c.text ?? "").join("");
}

function jsonFor(text: string) {
  if (text.includes("Transcript:")) {
    return {
      winner: "b",
      reason: "B answered the job-loss point with evidence; A never addressed the productivity gap.",
      unanswered: ["A never explained where productivity gains went with numbers."],
      concessions: [],
    };
  }
  const final = text.includes("final answer");
  return {
    action: final ? "end" : "continue",
    question: final ? "" : `Give me one number that backs that up, and tell me why your opponent's last example doesn't apply.`,
    reason: final ? "We're out of time." : "The last answer leaned on anecdote.",
  };
}

export function mockModel(delayMs = 25): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      const text = lastUserText(options.prompt);
      const wantsJson = options.responseFormat?.type === "json";
      // Sanitizer calls send the debater text as the prompt; echo it with the AI tell removed.
      const out = wantsJson ? JSON.stringify(jsonFor(text)) : text.replace(/And as an AI[^.]*\./, "").trim();
      return { content: [{ type: "text", text: out }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    },
    doStream: async (options) => {
      const text = lastUserText(options.prompt);
      const reply = text.startsWith("Open the debate")
        ? "Rita, let's start with you: a $20 floor would give millions a raise. Why is that bad for working families?"
        : LINES[turn++ % LINES.length];
      const words = reply.split(/(?<= )/);
      return {
        stream: simulateReadableStream({
          initialDelayInMs: delayMs * 10,
          chunkDelayInMs: delayMs,
          chunks: [
            { type: "text-start", id: "t" },
            ...words.map((w) => ({ type: "text-delta" as const, id: "t", delta: w })),
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
          ],
        }),
      };
    },
  });
}
