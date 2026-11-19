import { z } from "zod";
import { MODEL_IDS } from "./models";

export const ModelIdSchema = z.enum(MODEL_IDS);

export const SideSchema = z.object({ label: z.string().trim().min(1).max(60) });

export const DebateConfigSchema = z.object({
  topic: z.string().trim().min(3).max(500),
  sideA: SideSchema,
  sideB: SideSchema,
  debaterModel: ModelIdSchema,
  moderatorModel: ModelIdSchema,
  maxRounds: z.number().int().min(1).max(20),
  firstSpeaker: z.enum(["a", "b"]),
});
export type DebateConfig = z.infer<typeof DebateConfigSchema>;

export const ApiKeysSchema = z.object({
  anthropic: z.string().optional(),
  openai: z.string().optional(),
  openrouter: z.string().optional(),
});

export const DebateRequestSchema = z.object({
  config: DebateConfigSchema,
  keys: ApiKeysSchema,
});

export type Seat = "mod" | "a" | "b";
export type Debater = "a" | "b";

export const ModeratorDecisionSchema = z.object({
  action: z.enum(["continue", "end"]),
  question: z.string().describe("Next question for the other debater. Empty if ending."),
  reason: z.string().describe("One sentence on why the debate continues or ends."),
});
export type ModeratorDecision = z.infer<typeof ModeratorDecisionSchema>;

export const VerdictSchema = z.object({
  winner: z.enum(["a", "b", "draw"]),
  reason: z.string(),
  unanswered: z.array(z.string()).describe("Points one side raised that the other never answered, prefixed with who failed to answer."),
  concessions: z.array(z.string()).describe("Explicit or implicit concessions, prefixed with who conceded."),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export type DebateEvent =
  | { type: "turn_start"; seat: Seat; round: number }
  | { type: "delta"; seat: Seat; text: string }
  | { type: "turn_end"; seat: Seat; text: string }
  | ({ type: "verdict" } & Verdict)
  | { type: "error"; message: string }
  | { type: "done" };

/** Alliterative persona name for a side, e.g. "Republican" -> "Rita". */
const NAMES: Record<string, string[]> = {
  a: ["Alex", "Ada"], b: ["Bea", "Boris"], c: ["Cora", "Cal"], d: ["Dana", "Dex"], e: ["Eli", "Esme"],
  f: ["Finn", "Faye"], g: ["Gus", "Greta"], h: ["Hank", "Hazel"], i: ["Ivy", "Ike"], j: ["Jade", "Jules"],
  k: ["Kai", "Kira"], l: ["Leo", "Lena"], m: ["Max", "Mila"], n: ["Nora", "Ned"], o: ["Otto", "Opal"],
  p: ["Pia", "Pete"], q: ["Quinn", "Queenie"], r: ["Rita", "Rex"], s: ["Sam", "Sofia"], t: ["Theo", "Tess"],
  u: ["Uma", "Ugo"], v: ["Vera", "Vic"], w: ["Wes", "Willa"], x: ["Xena", "Xavi"], y: ["Yara", "Yusuf"],
  z: ["Zoe", "Zane"],
};

export function personaName(label: string, seat: Debater, otherLabel?: string): string {
  const letter = label.trim()[0]?.toLowerCase() ?? "x";
  const pool = NAMES[letter] ?? ["Robin", "Morgan"];
  // If both sides start with the same letter, give them different names.
  const clash = otherLabel && otherLabel.trim()[0]?.toLowerCase() === letter;
  return pool[clash && seat === "b" ? 1 : 0];
}

export const MODERATOR_NAME = "Morgan";

export function names(config: DebateConfig) {
  return {
    a: personaName(config.sideA.label, "a", config.sideB.label),
    b: personaName(config.sideB.label, "b", config.sideA.label),
    mod: MODERATOR_NAME,
  };
}
