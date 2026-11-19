// Command-line runner: test the debate logic without the UI.
//   npm run debate -- --topic "Should the US adopt a carbon tax?" --a Republican --b Democrat --rounds 4
// Keys come from ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY.
import { parseArgs } from "node:util";
import { runDebate } from "../lib/engine";
import { missingKeys } from "../lib/models";
import { formatCost } from "../lib/export";
import { DebateConfigSchema, names, type DebateEvent } from "../lib/types";

const { values } = parseArgs({
  options: {
    topic: { type: "string", default: "Should the federal minimum wage be raised to $20?" },
    a: { type: "string", default: "Republican" },
    b: { type: "string", default: "Democrat" },
    debater: { type: "string", default: "claude-sonnet-5-5" },
    moderator: { type: "string", default: "claude-haiku-5-5" },
    rounds: { type: "string", default: "4" },
    first: { type: "string" },
    mock: { type: "boolean", default: false },
    "all-the-way": { type: "boolean", default: false },
  },
});

const config = DebateConfigSchema.parse({
  topic: values.topic,
  sideA: { label: values.a },
  sideB: { label: values.b },
  debaterModel: values.debater,
  moderatorModel: values.moderator,
  maxRounds: Number(values.rounds),
  untilConcession: values["all-the-way"],
});
const keys = {
  anthropic: process.env.ANTHROPIC_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  openrouter: process.env.OPENROUTER_API_KEY,
};
const problems = missingKeys([config.debaterModel, config.moderatorModel], keys);
if (problems.length && !values.mock) {
  console.error(problems.join("\n"));
  process.exit(1);
}

const n = names(config);
const color = { mod: "\x1b[33m", a: "\x1b[31m", b: "\x1b[34m" } as const;
const who = { mod: `${n.mod} (moderator)`, a: `${n.a} (${config.sideA.label})`, b: `${n.b} (${config.sideB.label})` };
const reset = "\x1b[0m";

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());

// Both game plans stream at once; buffer them so they print one at a time.
const prepping = new Set<string>();
let spent = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
process.on("exit", () => {
  const total = spent.inputTokens + spent.outputTokens;
  if (total) console.log(`\nSpent: about ${formatCost(spent.costUsd)} · ${total.toLocaleString("en-US")} tokens (${spent.inputTokens.toLocaleString("en-US")} in, ${spent.outputTokens.toLocaleString("en-US")} out)`);
});

function emit(e: DebateEvent) {
  if (e.type === "turn_start" && e.prep) {
    prepping.add(e.seat);
    return;
  }
  if (e.type === "delta" && prepping.has(e.seat)) return;
  if (e.type === "turn_end" && prepping.delete(e.seat)) {
    process.stdout.write(`\n${color[e.seat]}${who[e.seat]} · ${e.seat === "mod" ? "private read on the motion" : "private game plan"}${reset}\n${e.text}\n`);
    return;
  }
  switch (e.type) {
    case "leaning": {
      const lead = e.toward === "even" ? "even" : `${who[e.toward]}, ${e.margin}`;
      console.log(`\x1b[2m  [moderator leaning: ${lead}. ${e.summary}]\x1b[0m`);
      break;
    }
    case "coin_flip":
      console.log(`\nCoin flip: ${who[e.winner]} opens.`);
      break;
    case "turn_start":
      if (e.round >= 0) process.stdout.write(`\n${color[e.seat]}${who[e.seat]}${reset}\n`);
      else process.stdout.write(`\n…judging…\n`);
      break;
    case "delta":
      process.stdout.write(e.text);
      break;
    case "turn_end":
      if (e.factCheck) process.stdout.write(`  \x1b[41m FACT CHECK: ${e.factCheck} \x1b[0m`);
      process.stdout.write("\n");
      break;
    case "usage":
      spent = { inputTokens: e.inputTokens, outputTokens: e.outputTokens, costUsd: e.costUsd };
      break;
    case "verdict": {
      const w = e.winner === "draw" ? "Draw" : `${who[e.winner]} wins`;
      console.log(`\n=== VERDICT: ${w} ===\n${e.reason}`);
      if (e.unanswered.length) console.log(`\nUnanswered:\n- ${e.unanswered.join("\n- ")}`);
      if (e.concessions.length) console.log(`\nConcessions:\n- ${e.concessions.join("\n- ")}`);
      break;
    }
  }
}

console.log(`Motion: ${config.topic}`);
const models = values.mock
  ? await import("../lib/mock").then((m) => ({ debater: m.mockModel(5), moderator: m.mockModel(5) }))
  : undefined;
const first = values.first === "a" || values.first === "b" ? values.first : undefined;
runDebate(config, keys, emit, controller.signal, models, first).catch((err) => {
  if (controller.signal.aborted) console.log("\nStopped.");
  else {
    console.error("\nError:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
});
