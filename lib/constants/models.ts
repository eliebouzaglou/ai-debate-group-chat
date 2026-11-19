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
    /** List price in US dollars per million tokens: [input, output]. From OpenRouter's catalog, Nov 2026. */
    price: readonly [number, number];
    /** Good default for the moderator / sanitizer (cheap and fast). */
    cheap?: boolean;
}

// OpenRouter slugs and prices drift over time. If one stops working, check https://openrouter.ai/models.
export const MODELS = [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic", nativeId: "claude-opus-5-5", openrouterId: "anthropic/claude-opus-5.5", price: [4, 20] },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic", nativeId: "claude-sonnet-5-5", openrouterId: "anthropic/claude-sonnet-5.5", price: [2, 10] },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "anthropic", nativeId: "claude-haiku-5-5", openrouterId: "anthropic/claude-haiku-5.5", price: [0.1, 0.5], cheap: true },
    { id: "gpt-6.2-astra", label: "GPT-6.2 Astra", provider: "openai", nativeId: "gpt-6.2-astra", openrouterId: "openai/gpt-6.2-astra", price: [8, 40] },
    { id: "gpt-6.2-sol", label: "GPT-6.2 Sol", provider: "openai", nativeId: "gpt-6.2-sol", openrouterId: "openai/gpt-6.2-sol", price: [2, 10] },
    { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", provider: "openai", nativeId: "gpt-6.1-terra", openrouterId: "openai/gpt-6.1-terra", price: [1, 5] },
    { id: "gpt-6-luna", label: "GPT-6 Luna", provider: "openai", nativeId: "gpt-6-luna", openrouterId: "openai/gpt-6-luna", price: [0.1, 0.5], cheap: true },
    { id: "gpt-5.5", label: "GPT-5.5", provider: "openai", nativeId: "gpt-5.5", openrouterId: "openai/gpt-5.5", price: [5, 30] },
    { id: "gpt-5", label: "GPT-5", provider: "openai", nativeId: "gpt-5", openrouterId: "openai/gpt-5", price: [1.25, 10] },
    { id: "gpt-5-mini", label: "GPT-5 mini", provider: "openai", nativeId: "gpt-5-mini", openrouterId: "openai/gpt-5-mini", price: [0.25, 2], cheap: true },
    { id: "gpt-5-nano", label: "GPT-5 nano", provider: "openai", nativeId: "gpt-5-nano", openrouterId: "openai/gpt-5-nano", price: [0.05, 0.4], cheap: true },
    { id: "o3", label: "o3", provider: "openai", nativeId: "o3", openrouterId: "openai/o3", price: [2, 8] },
    { id: "gpt-4.1", label: "GPT-4.1", provider: "openai", nativeId: "gpt-4.1", openrouterId: "openai/gpt-4.1", price: [2, 8] },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai", nativeId: "gpt-4.1-mini", openrouterId: "openai/gpt-4.1-mini", price: [0.4, 1.6], cheap: true },
    { id: "gpt-4.1-nano", label: "GPT-4.1 nano", provider: "openai", nativeId: "gpt-4.1-nano", openrouterId: "openai/gpt-4.1-nano", price: [0.1, 0.4], cheap: true },
    { id: "gpt-4o", label: "GPT-4o", provider: "openai", nativeId: "gpt-4o", openrouterId: "openai/gpt-4o", price: [2.5, 10] },
    { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "openai", nativeId: "gpt-4o-mini", openrouterId: "openai/gpt-4o-mini", price: [0.15, 0.6], cheap: true },
    { id: "gpt-oss-120b", label: "gpt-oss-120b (OpenRouter)", provider: "openrouter", openrouterId: "openai/gpt-oss-120b", price: [0.15, 0.6] },
    { id: "gpt-oss-20b", label: "gpt-oss-20b (OpenRouter)", provider: "openrouter", openrouterId: "openai/gpt-oss-20b", price: [0.018, 0.09], cheap: true },
    { id: "gpt-4", label: "GPT-4 (2023, pricey)", provider: "openai", nativeId: "gpt-4", openrouterId: "openai/gpt-4", price: [30, 60], legacyChat: true },
    { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo", provider: "openai", nativeId: "gpt-3.5-turbo", openrouterId: "openai/gpt-3.5-turbo-16k", price: [3, 4], legacyChat: true, cheap: true },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (OpenRouter)", provider: "openrouter", openrouterId: "google/gemini-2.5-pro", price: [1.25, 10] },
    { id: "grok-4.7", label: "Grok 4.7 (OpenRouter)", provider: "openrouter", openrouterId: "x-ai/grok-4.7", price: [2, 6] },
    { id: "deepseek-chat", label: "DeepSeek V3 (OpenRouter)", provider: "openrouter", openrouterId: "deepseek/deepseek-chat", price: [0.257, 1.029] },
] as const satisfies readonly ModelInfo[];