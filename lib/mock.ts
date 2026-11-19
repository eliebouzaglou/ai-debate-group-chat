// Dev-only fake models so the engine, route and UI can be exercised without API keys.
// Enabled with DEBATE_MOCK=1 (server) or `npm run debate -- --mock`.
import { simulateReadableStream, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

// Canned argument templates. {topic} and {side} are filled from the real prompts,
// so mock debates follow whatever motion you set.
const LINES = [
  "[mock] As a {side}, my answer on \"{topic}\" is simple: the costs land on ordinary people first, and nobody on the other side has priced them.",
  "[mock] That's a dodge. Speaking for the {side} side of \"{topic}\": the evidence runs the other way, and my opponent hasn't named a single number.",
  "[mock] Numbers? Fine. Every serious study of \"{topic}\" I know backs the {side} position. My opponent is arguing from anecdote.",
  "[mock] Anecdote is what you call evidence you don't like. The {side} case on \"{topic}\" stands. And as an AI language model I think both sides have merit.",
  "[mock] I won't concede on \"{topic}\". The {side} position is still standing and you know it.",
  "[mock] Fine. I can't answer that one. I concede.",
];

let turn = 0;

function systemText(prompt: unknown): string {
  const msgs = prompt as { role: string; content: unknown }[];
  const sys = msgs.find((m) => m.role === "system");
  return typeof sys?.content === "string" ? sys.content : "";
}

function fill(template: string, system: string): string {
  const topic = system.match(/motion: "([^"]+)"/i)?.[1] ?? "the motion";
  const side = system.match(/committed (.+?) in a live/)?.[1] ?? "my";
  return template.replaceAll("{topic}", topic).replaceAll("{side}", side);
}

function lastUserText(prompt: unknown): string {
  const msgs = prompt as { role: string; content: { type: string; text?: string }[] | string }[];
  const last = [...msgs].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return typeof last.content === "string" ? last.content : last.content.map((c) => c.text ?? "").join("");
}

function jsonFor(text: string) {
  if (text.includes("size up the motion")) {
    return {
      kind: "one_right",
      reasoning: "[mock] The two positions contradict each other, so they can't both be correct.",
      decidingQuestion: "[mock] What does the evidence actually show?",
    };
  }
  if (text.includes("Transcript:")) {
    return {
      winner: "b",
      reason: "[mock] Canned verdict: no real model judged this debate.",
      unanswered: ["[mock] Example unanswered point."],
      concessions: [],
    };
  }
  const final = text.includes("final answer") || /I concede\./.test(text);
  // Flag the canned "every serious study" line so fact-checks can be tested.
  const vague = /Every serious study/.test(text);
  return {
    leaning: vague
      ? {
          toward: "b",
          margin: "clear",
          summary: "[mock] Leaning No: Yes leaned on an unnamed study.",
          reasons: [
            { kind: "unsupported_claim", side: "a", note: "[mock] \"Every serious study\" with no source" },
            { kind: "more_persuasive", side: "b", note: "[mock] Pressed for numbers" },
          ],
        }
      : { toward: "even", margin: "slight", summary: "[mock] No clear edge yet.", reasons: [] },
    factCheck: vague
      ? { status: "unsupported", callout: "[mock] Name one of those studies: author, title and year. \"Every serious study\" is not a source." }
      : { status: "clean", callout: "" },
    action: final ? "end" : "continue",
    question: final ? "" : `[mock] Give me one number that backs that up, and tell me why your opponent's last example doesn't apply.`,
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
      const sys = systemText(options.prompt);
      const reply = /viewer is asking you about this decision|Your verdict:/i.test(sys)
        ? `[mock] Fair question. I called it that way because one side left more points unanswered and leaned on weaker sources. Look back at the turns where a claim went unanswered — that's what tipped it.`
        : text.startsWith("The debate hasn't started")
        ? fill(
            "[mock] Game plan for the {side} side of \"{topic}\".\n1. Lead with cost: hit them with the strongest number first.\n2. Trap: get them to agree that results matter more than intentions, then show the results favour {side}.\n3. Expected attack: \"that's anecdotal\". Counter: cite the broad data and ask for theirs.",
            sys,
          )
        : text.startsWith("Open the debate")
        ? `[mock] ${text.match(/question to (\w+)/)?.[1] ?? "First speaker"}, make your opening case: why is your side right on ${fill("\"{topic}\"", sys)}?`
        : fill(LINES[turn++ % LINES.length], sys);
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
