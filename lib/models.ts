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
  /** Send direct-OpenAI calls to the older Chat Completions endpoint (pre-Responses models). */
  legacyChat?: boolean;
  /** Good default for the moderator / sanitizer (cheap and fast). */
  cheap?: boolean;
}

// OpenRouter slugs drift over time. If one stops working, check https://openrouter.ai/models.
export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic", nativeId: "claude-opus-5-5", openrouterId: "anthropic/claude-opus-5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic", nativeId: "claude-sonnet-5-5", openrouterId: "anthropic/claude-sonnet-5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "anthropic", nativeId: "claude-haiku-5-5", openrouterId: "anthropic/claude-haiku-5.5", cheap: true },
  { id: "gpt-6.2-astra", label: "GPT-6.2 Astra", provider: "openai", nativeId: "gpt-6.2-astra", openrouterId: "openai/gpt-6.2-astra" },
  { id: "gpt-6.2-sol", label: "GPT-6.2 Sol", provider: "openai", nativeId: "gpt-6.2-sol", openrouterId: "openai/gpt-6.2-sol" },
  { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", provider: "openai", nativeId: "gpt-6.1-terra", openrouterId: "openai/gpt-6.1-terra" },
  { id: "gpt-6-luna", label: "GPT-6 Luna", provider: "openai", nativeId: "gpt-6-luna", openrouterId: "openai/gpt-6-luna", cheap: true },
  { id: "gpt-5.5", label: "GPT-5.5", provider: "openai", nativeId: "gpt-5.5", openrouterId: "openai/gpt-5.5" },
  { id: "gpt-5", label: "GPT-5", provider: "openai", nativeId: "gpt-5", openrouterId: "openai/gpt-5" },
  { id: "gpt-5-mini", label: "GPT-5 mini", provider: "openai", nativeId: "gpt-5-mini", openrouterId: "openai/gpt-5-mini", cheap: true },
  { id: "gpt-5-nano", label: "GPT-5 nano", provider: "openai", nativeId: "gpt-5-nano", openrouterId: "openai/gpt-5-nano", cheap: true },
  { id: "o3", label: "o3", provider: "openai", nativeId: "o3", openrouterId: "openai/o3" },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai", nativeId: "gpt-4.1", openrouterId: "openai/gpt-4.1" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai", nativeId: "gpt-4.1-mini", openrouterId: "openai/gpt-4.1-mini", cheap: true },
  { id: "gpt-4.1-nano", label: "GPT-4.1 nano", provider: "openai", nativeId: "gpt-4.1-nano", openrouterId: "openai/gpt-4.1-nano", cheap: true },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", nativeId: "gpt-4o", openrouterId: "openai/gpt-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "openai", nativeId: "gpt-4o-mini", openrouterId: "openai/gpt-4o-mini", cheap: true },
  { id: "gpt-oss-120b", label: "gpt-oss-120b (OpenRouter)", provider: "openrouter", openrouterId: "openai/gpt-oss-120b" },
  { id: "gpt-oss-20b", label: "gpt-oss-20b (OpenRouter)", provider: "openrouter", openrouterId: "openai/gpt-oss-20b", cheap: true },
  { id: "gpt-4", label: "GPT-4 (2023, pricey)", provider: "openai", nativeId: "gpt-4", openrouterId: "openai/gpt-4", legacyChat: true },
  { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo", provider: "openai", nativeId: "gpt-3.5-turbo", openrouterId: "openai/gpt-3.5-turbo-16k", legacyChat: true, cheap: true },
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
