import { MODERATOR_NAME } from "@/config";
import type { DebateConfig, Debater } from "@/types";

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

export function names(config: DebateConfig) {
  return {
    a: personaName(config.sideA.label, "a", config.sideB.label),
    b: personaName(config.sideB.label, "b", config.sideA.label),
    mod: MODERATOR_NAME,
  };
}
