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
let pendingHeader = "";
let lastBoard = "";
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
    process.stdout.write(`\n${color[e.seat]}${who[e.seat]} · ${e.seat === "mod" ? "backstage brief" : "private game plan (draft)"}${reset}\n${e.text}\n`);
    return;
  }
  switch (e.type) {
    case "plan_update":
      process.stdout.write(`\n${color[e.seat]}${who[e.seat]} · plan after fact-check${e.revised ? " (revised)" : " (no changes)"}${reset}\n${e.revised ? e.text + "\n" : ""}`);
      break;
    case "scoreboard": {
      const shown = e.cruxes.map((c, i) => `${i + 1}:${c.favours === "open" ? "open" : who[c.favours]}`).join("  ");
      if (shown !== lastBoard) console.log(`\x1b[2m  [deciding questions: ${shown}]\x1b[0m`);
      lastBoard = shown;
      break;
    }
    case "leaning": {
      const lead = e.toward === "even" ? "even" : `${who[e.toward]}, ${e.margin}`;
      console.log(`\x1b[2m  [moderator leaning: ${lead}. ${e.summary}]\x1b[0m`);
      break;
    }
    case "coin_flip":
      console.log(`\nCoin flip: ${who[e.winner]} opens.`);
      break;
    case "turn_start":
      // Print the speaker only once they actually say something (a turn can end empty).
      if (e.round >= 0) pendingHeader = `\n${color[e.seat]}${who[e.seat]}${e.trap === "spring" ? " · springs the trap" : e.trap === "check" ? " · private check (own coach)" : e.trap === "reply" ? " · replies" : ""}${reset}\n`;
      else process.stdout.write(`\n…judging…\n`);
      break;
    case "delta":
      if (pendingHeader) process.stdout.write(pendingHeader);
      pendingHeader = "";
      process.stdout.write(e.text);
      break;
    case "turn_end":
      if (pendingHeader) {
        pendingHeader = "";
        if (!e.text) break;
      }
      if (e.trapResult) process.stdout.write(`  \x1b[1m[RULING: ${e.trapResult === "closed" ? "TRAP CLOSED, debate over" : e.trapResult === "scored" ? "point scored" : "escaped"}]\x1b[0m`);
      if (e.factCheck) process.stdout.write(`  \x1b[41m FACT CHECK: ${e.factCheck} \x1b[0m`);
      process.stdout.write("\n");
      break;
    case "usage":
      spent = { inputTokens: e.inputTokens, outputTokens: e.outputTokens, costUsd: e.costUsd };
      break;
    case "verdict": {
      const w = e.winner === "draw" ? "Both equally right" : `${who[e.winner]} ${e.oneRight ? "is right" : "is more right"}`;
      if (e.confidence) console.log(`(confidence: ${e.confidence})`);
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
