// Import from the constants module directly, not the "@/lib" barrel: the barrel re-exports
// modules that import this file, which creates a cycle (MODEL_IDS used before it exists).
import { MODELS, type ModelInfo, type Provider } from "./constants/models";

export type ModelId = (typeof MODELS)[number]["id"];
export const MODEL_IDS = MODELS.map((m) => m.id) as [ModelId, ...ModelId[]];

export function getModelInfo(id: ModelId): ModelInfo {
  const m = MODELS.find((m) => m.id === id);
  if (!m) throw new Error(`Unknown model: ${id}`);
  return m;
}

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
  openrouter?: string;
}

/** Which key a model will use, or null if none is available. OpenRouter wins when present. */
export function keyFor(id: ModelId, keys: ApiKeys): Provider | null {
  if (keys.openrouter?.trim()) return "openrouter";
  const p = getModelInfo(id).provider;
  if (p === "anthropic" && keys.anthropic?.trim()) return "anthropic";
  if (p === "openai" && keys.openai?.trim()) return "openai";
  return null;
}

/** Human-readable problems, empty when every chosen model has a key. */
export function missingKeys(ids: ModelId[], keys: ApiKeys): string[] {
  const problems: string[] = [];
  for (const id of new Set(ids)) {
    if (keyFor(id, keys)) continue;
    const m = getModelInfo(id);
    problems.push(
      m.provider === "openrouter"
        ? `${m.label} needs an OpenRouter key.`
        : `${m.label} needs an ${m.provider === "anthropic" ? "Anthropic" : "OpenAI"} or OpenRouter key.`,
    );
  }
  return problems;
}

/** Rough cost in US dollars for a number of input and output tokens on a model. */
export function estimateCost(id: ModelId, inputTokens: number, outputTokens: number): number {
  const [inPrice, outPrice] = getModelInfo(id).price;
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}
