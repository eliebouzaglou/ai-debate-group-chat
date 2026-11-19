export type Provider = "anthropic" | "openai" | "openrouter";

export interface ModelInfo {
  id: string;
  label: string;
  /** Native provider. "openrouter" means the model is only reachable through OpenRouter. */
  provider: Provider;
  /** Model id sent to the native provider. */
  nativeId?: string;
  /** Slug sent to OpenRouter. */
  openrouterId: string;
  /** Good default for the moderator / sanitizer (cheap and fast). */
  cheap?: boolean;
}

// OpenRouter slugs drift over time. If one stops working, check https://openrouter.ai/models.
export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic", nativeId: "claude-opus-5-5", openrouterId: "anthropic/claude-opus-5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic", nativeId: "claude-sonnet-5-5", openrouterId: "anthropic/claude-sonnet-5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "anthropic", nativeId: "claude-haiku-5-5", openrouterId: "anthropic/claude-haiku-5.5", cheap: true },
  { id: "gpt-5", label: "GPT-5", provider: "openai", nativeId: "gpt-5", openrouterId: "openai/gpt-5" },
  { id: "gpt-5-mini", label: "GPT-5 mini", provider: "openai", nativeId: "gpt-5-mini", openrouterId: "openai/gpt-5-mini", cheap: true },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (OpenRouter)", provider: "openrouter", openrouterId: "google/gemini-2.5-pro" },
  { id: "grok-4", label: "Grok 4 (OpenRouter)", provider: "openrouter", openrouterId: "x-ai/grok-4" },
  { id: "deepseek-chat", label: "DeepSeek V3 (OpenRouter)", provider: "openrouter", openrouterId: "deepseek/deepseek-chat" },
] as const satisfies readonly ModelInfo[];

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
