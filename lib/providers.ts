// Server-only: builds AI SDK model instances. Kept apart from models.ts so the
// browser bundle never pulls in the provider SDKs.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { getModelInfo, keyFor, missingKeys, type ApiKeys, type ModelId } from "./models";

export function getModel(id: ModelId, keys: ApiKeys): LanguageModel {
  const via = keyFor(id, keys);
  const m = getModelInfo(id);
  switch (via) {
    case "openrouter":
      return createOpenRouter({ apiKey: keys.openrouter!.trim() }).chat(m.openrouterId);
    case "anthropic":
      return createAnthropic({ apiKey: keys.anthropic!.trim() })(m.nativeId!);
    case "openai":
    {
      const openai = createOpenAI({ apiKey: keys.openai!.trim() });
      return m.legacyChat ? openai.chat(m.nativeId!) : openai(m.nativeId!);
    }
    default:
      throw new Error(missingKeys([id], keys)[0]);
  }
}
