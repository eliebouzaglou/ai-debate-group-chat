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
let checks = 0;

function systemText(prompt: unknown): string {
  const msgs = prompt as { role: string; content: unknown }[];
  const sys = msgs.find((m) => m.role === "system");
  return typeof sys?.content === "string" ? sys.content : "";
}

function fill(template: string, system: string): string {
  const topic = system.match(/motion: "([^"]+)"/i)?.[1] ?? system.match(/debate \w+ on "([^"]+)"/)?.[1] ?? "the motion";
  const side = system.match(/you argue for (.+?)\. Your opponent/)?.[1] ?? system.match(/I'm arguing for (.+?);/)?.[1] ?? "my";
  return template.replaceAll("{topic}", topic).replaceAll("{side}", side);
}

function lastUserText(prompt: unknown): string {
  const msgs = prompt as { role: string; content: { type: string; text?: string }[] | string }[];
  const last = [...msgs].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return typeof last.content === "string" ? last.content : last.content.map((c) => c.text ?? "").join("");
}

function jsonFor(text: string, system = "") {
  if (text.includes("Write the backstage brief")) {
    return {
      kind: "one_right",
      kindReason: "[mock] The two positions contradict each other, so they can't both be correct.",
      commitments: { a: "[mock] Side a accepts the official statistics.", b: "[mock] Side b accepts the same statistics and one landmark study." },
      sharedGround: "[mock] Both accept the official statistics.",
      cruxes: [
        "[mock] Does the strongest evidence support the change?",
        "[mock] Who carries the burden of proof?",
        "[mock] Do the predicted harms actually show up in the data?",
      ],
      weakSpots: { a: "[mock] Relies on a single study.", b: "[mock] Can't explain the 2020 data." },
      coachBriefs: { a: "[mock] Your opponent accepts the official statistics; build traps from them.", b: "[mock] Your opponent relies on one study; press its limits." },
      refereeStandard: "[mock] Award each deciding question to the side whose claims match evidence both accept.",
    };
  }
  if (text.includes("Did they beat me?")) {
    return {
      verdict: "partly",
      mistake: "[mock] My second answer conceded more than I needed to.",
      reply: "[mock] Your second step assumes the status quo is neutral. It isn't, so the burden doesn't fall where you put it.",
    };
  }
  if (/Rapid-fire cross-examination\. You're questioning/.test(text)) {
    const asked = (text.match(/^\d+\. /gm) ?? []).length;
    const chain = [
      "[mock] Does hard evidence outweigh good intentions on this motion?",
      "[mock] Should the burden of proof sit with whoever wants to change the status quo?",
      "[mock] If the best available data conflicts with your preferred story, do you still hold the position?",
    ];
    return asked < chain.length ? { question: chain[asked], ready: false } : { question: "", ready: true };
  }
  if (/^Rule on /.test(text)) {
    // Copy the scoreboard from the prompt, then give the asker one deciding question:
    // side a takes question 1, side b takes question 2, so mock debates go to the long round.
    const asker = text.match(/\(side "(a|b)"/)?.[1] as "a" | "b" | undefined;
    const rows = [...text.matchAll(/^(\d+)\. .*? — (open|favours .*?\(side "(a|b)"\))/gm)].map((m) => ({
      favours: m[3] ?? "open",
      note: m[3] ? "[mock] earlier ruling" : "",
    }));
    const idx = asker === "b" ? 1 : 0;
    if (rows[idx]) rows[idx] = { favours: asker ?? "open", note: "[mock] their own answers conceded it" };
    return { cruxes: rows, explanation: "[mock] A fair hit: the answers settle one deciding question, but not the debate." };
  }
  if (/Answer with exactly yes or no/i.test(text)) {
    // Split answers so both sides don't always agree in mock mode.
    const name = system.match(/Your name is (\w+)/)?.[1] ?? "";
    const odd = (name.charCodeAt(0) || 0) % 2 === 1;
    const leanYes = /evidence|burden|data|proof|status quo/i.test(text);
    return { answer: leanYes === odd ? "yes" : "no" };
  }
  if (text.includes("Transcript:")) {
    return {
      winner: "b",
      confidence: "medium",
      reason: "[mock] Canned verdict: no real model judged this debate.",
      unanswered: ["[mock] Example unanswered point."],
      concessions: [],
      cruxes: [],
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
            { kind: "sounder_reasoning", side: "b", note: "[mock] Pressed for numbers" },
          ],
        }
      : { toward: "even", margin: "slight", summary: "[mock] No clear edge yet.", reasons: [] },
    factCheck: vague
      ? { status: "unsupported", callout: "[mock] Name one of those studies: author, title and year. \"Every serious study\" is not a source." }
      : { status: "clean", callout: "" },
    cruxes: [],
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
      const out = wantsJson
        ? JSON.stringify(jsonFor(text, systemText(options.prompt)))
        : text.startsWith("Review this debate prep plan")
          ? checks++ % 2 === 0
            ? "1. [mock] The 2020 figure is misdated; it's from 2019.\n2. [mock] Question 3 isn't forced: they can say no."
            : "No changes needed."
          : text.includes("A fact-checker reviewed the plan")
            ? "[mock] Revised plan after the fact-check.\n1. Facts: the 2019 figure (corrected).\n2. Rapid-fire questions: (1) Does evidence outweigh intent? (2) Does the status quo need proving?\n3. Spring: you admitted both, and the 2019 data shows the change fails."
            : text.replace(/And as an AI[^.]*\./, "").trim();
      return { content: [{ type: "text", text: out }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    },
    doStream: async (options) => {
      const text = lastUserText(options.prompt);
      const sys = systemText(options.prompt);
      const reply = /viewer is asking you about this decision|Your verdict:/i.test(sys)
        ? `[mock] Fair question. I called it that way because one side left more points unanswered and leaned on weaker sources. Look back at the turns where a claim went unanswered — that's what tipped it.`
        : /Now spring the trap/.test(text)
        ? "[mock] You admitted evidence beats intentions and that the burden sits on change. [mock source, 2020] shows the change fails on evidence. So your case falls. Concede, or show me which step is wrong."
        : /about to debate/.test(text) && text.startsWith("I'm ")
        ? fill(
            "[mock] Game plan for the {side} side of \"{topic}\".\n1. Facts: lead with the strongest number.\n2. Rapid-fire questions: (1) Does evidence outweigh intent? — want yes. (2) Does the status quo need proving? — want yes. (3) If data conflicts with your story, do you keep it? — want no.\n3. Trap: get them to agree results matter more than intentions, then show results favour {side}.\n4. Expected attack: \"that's anecdotal\". Counter: cite the broad data and ask for theirs.\n5. Move list: establish the rapid-fire yes, spring the trap, close.",
            text,
          )
        : /Open the debate|Rapid fire is over/i.test(text)
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
