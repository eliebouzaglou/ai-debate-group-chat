import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  generateText,
  Output,
  streamText,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
} from "ai";
import { z } from "zod";
import type { ModelInfo } from "@/constants/models";
import {
  estimateCost,
  getModelInfo,
  keyFor,
  missingKeys,
  MODEL_IDS,
  type ApiKeys,
  type ModelId,
} from "./catalog";

export type { ApiKeys, ModelId } from "./catalog";
export { MODEL_IDS, getModelInfo, keyFor, missingKeys, estimateCost } from "./catalog";

export interface LLMFinish {
  text: string;
  finishReason: FinishReason;
  usage: LanguageModelUsage;
  costUsd: number;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  usage: LanguageModelUsage;
}

export interface LLMOptions {
  keys: ApiKeys;
  systemPrompt?: string;
  maxTokens?: number;
  history?: ModelMessage[];
  abortSignal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onFinish?: (finish: LLMFinish) => void;
  onError?: (error: unknown) => void;
  onUsage?: (usage: LLMUsage) => void;
}

export interface OnceOptions {
  instructions?: string;
  messages?: ModelMessage[];
  maxTokens?: number;
}

/**
 * One conversational seat — owns catalog lookup, provider wiring, cost, and history.
 *  ``` typescript
 *   const moderator = new LLM(config.moderatorModel, {
 *    keys, 
 *    systemPrompt: "You are a helpful assistant." 
 *   });
 *   const answer = await moderator.stream("Hello, how are you?");
 *  ```
 */
export class LLM {
  static readonly IDS = MODEL_IDS;
  static info = getModelInfo;
  static keyFor = keyFor;
  static missingKeys = missingKeys;

  private readonly modelId: ModelId;
  protected systemPrompt: string;
  protected maxTokens: number;
  protected history: ModelMessage[];
  protected abortSignal?: AbortSignal;

  protected readonly keys: ApiKeys;
  protected onDelta?: (delta: string) => void;
  protected onFinish?: (finish: LLMFinish) => void;
  protected onError?: (error: unknown) => void;
  protected onUsage?: (usage: LLMUsage) => void;

  constructor(modelId: ModelId, options: LLMOptions) {
    this.modelId = modelId;
    this.keys = options.keys;
    this.systemPrompt = options.systemPrompt ?? "";
    this.maxTokens = options.maxTokens ?? 1000;
    this.history = options.history ? [...options.history] : [];
    this.abortSignal = options.abortSignal;
    this.onDelta = options.onDelta;
    this.onFinish = options.onFinish;
    this.onError = options.onError;
    this.onUsage = options.onUsage;
  }

  /** Resolve a LanguageModel from catalog id + keys. */
  static getModel(id: ModelId, keys: ApiKeys): LanguageModel {
    const via = keyFor(id, keys);
    const m = getModelInfo(id);
    switch (via) {
      case "openrouter":
        return createOpenRouter({ apiKey: keys.openrouter!.trim() }).chat(m.openrouterId);
      case "anthropic":
        return createAnthropic({ apiKey: keys.anthropic!.trim() })(m.nativeId!);
      case "openai": {
        const openai = createOpenAI({ apiKey: keys.openai!.trim() });
        return m.legacyChat ? openai.chat(m.nativeId!) : openai(m.nativeId!);
      }
      default:
        throw new Error(missingKeys([id], keys)[0]);
    }
  }

  // ── seat ───────────────────────────────────────────────────────────────────

  get info(): ModelInfo {
    return getModelInfo(this.modelId);
  }

  /** Stream a turn: append user → stream → append assistant. */
  async stream(prompt: string): Promise<string> {
    return this.runStream(prompt, { append: true });
  }

  /** Non-streaming turn: append user → complete → append assistant. */
  async complete(prompt: string): Promise<string> {
    return this.runComplete(prompt, { append: true });
  }

  /** Structured JSON turn that appends to history. */
  async json<S extends z.ZodType>(
    schema: S,
    prompt: string,
    opts: OnceOptions = {},
  ): Promise<z.infer<S>> {
    return this.runJson(schema, prompt, { append: true, ...opts });
  }

  /** One-shot stream that does not touch this seat's history. */
  streamOnce(prompt: string, opts: OnceOptions = {}): Promise<string> {
    return this.runStream(prompt, { append: false, ...opts });
  }

  /** One-shot complete that does not touch this seat's history. */
  completeOnce(prompt: string, opts: OnceOptions = {}): Promise<string> {
    return this.runComplete(prompt, { append: false, ...opts });
  }

  /** One-shot structured JSON that does not touch this seat's history. */
  jsonOnce<S extends z.ZodType>(schema: S, prompt: string, opts: OnceOptions = {}): Promise<z.infer<S>> {
    return this.runJson(schema, prompt, { append: false, ...opts });
  }

  // ── protected (subclasses only — Debate should not poke these) ─────────────

  protected get messages(): readonly ModelMessage[] {
    return this.history;
  }

  protected setSystem(prompt: string): void {
    this.systemPrompt = prompt;
  }

  protected clearHistory(): void {
    this.history = [];
  }

  protected push(...messages: ModelMessage[]): void {
    this.history.push(...messages);
  }

  protected resolveModel(): LanguageModel {
    return LLM.getModel(this.modelId, this.keys);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async runStream(
    prompt: string,
    opts: OnceOptions & { append: boolean },
  ): Promise<string> {
    const instructions = opts.instructions ?? this.systemPrompt;
    const maxTokens = opts.maxTokens ?? this.maxTokens;
    const messages: ModelMessage[] = opts.messages
      ? [...opts.messages, { role: "user", content: prompt }]
      : opts.append
        ? (this.history.push({ role: "user", content: prompt }), this.history)
        : [{ role: "user", content: prompt }];

    try {
      let streamError: unknown;
      const result = streamText({
        model: this.resolveModel(),
        instructions: instructions || undefined,
        messages,
        maxOutputTokens: maxTokens,
        abortSignal: this.abortSignal,
        onError: ({ error }) => {
          streamError = error;
        },
      });

      let full = "";
      for await (const chunk of result.textStream) {
        full += chunk;
        this.onDelta?.(chunk);
      }
      if (streamError) {
        throw streamError instanceof Error ? streamError : new Error(String(streamError));
      }

      const text = full.trim();
      const usage = await result.usage;
      const finishReason = await result.finishReason;
      this.reportUsage(usage);

      if (opts.append) this.history.push({ role: "assistant", content: text });
      this.onFinish?.({
        text,
        finishReason,
        usage,
        costUsd: this.costOf(usage),
      });
      return text;
    } catch (error) {
      if (opts.append) this.history.pop();
      this.onError?.(error);
      throw error;
    }
  }

  private async runComplete(
    prompt: string,
    opts: OnceOptions & { append: boolean },
  ): Promise<string> {
    const instructions = opts.instructions ?? this.systemPrompt;
    const maxTokens = opts.maxTokens ?? this.maxTokens;
    const messages: ModelMessage[] = opts.messages
      ? [...opts.messages, { role: "user", content: prompt }]
      : opts.append
        ? (this.history.push({ role: "user", content: prompt }), this.history)
        : [{ role: "user", content: prompt }];

    try {
      const { text: raw, usage, finishReason } = await generateText({
        model: this.resolveModel(),
        instructions: instructions || undefined,
        messages,
        maxOutputTokens: maxTokens,
        abortSignal: this.abortSignal,
      });
      const text = raw.trim();
      this.reportUsage(usage);
      if (opts.append) this.history.push({ role: "assistant", content: text });
      this.onFinish?.({
        text,
        finishReason,
        usage,
        costUsd: this.costOf(usage),
      });
      return text;
    } catch (error) {
      if (opts.append) this.history.pop();
      this.onError?.(error);
      throw error;
    }
  }

  private async runJson<S extends z.ZodType>(
    schema: S,
    prompt: string,
    opts: OnceOptions & { append: boolean },
  ): Promise<z.infer<S>> {
    const instructions = opts.instructions ?? this.systemPrompt;
    const maxTokens = opts.maxTokens ?? this.maxTokens;
    const messages: ModelMessage[] = opts.messages
      ? [...opts.messages, { role: "user", content: prompt }]
      : opts.append
        ? (this.history.push({ role: "user", content: prompt }), this.history)
        : [{ role: "user", content: prompt }];

    try {
      try {
        const { output, usage, finishReason } = await generateText({
          model: this.resolveModel(),
          instructions: instructions || undefined,
          messages,
          output: Output.object({ schema }),
          maxOutputTokens: maxTokens,
          abortSignal: this.abortSignal,
        });
        this.reportUsage(usage);
        const text = JSON.stringify(output);
        if (opts.append) this.history.push({ role: "assistant", content: text });
        this.onFinish?.({
          text,
          finishReason,
          usage,
          costUsd: this.costOf(usage),
        });
        return output as z.infer<S>;
      } catch (err) {
        if (this.abortSignal?.aborted) throw err;
        // A failed parse was still billed; count it if the SDK reports usage on the error.
        const failedUsage = (err as { usage?: LanguageModelUsage }).usage;
        if (failedUsage) this.reportUsage(failedUsage);

        const { text, usage, finishReason } = await generateText({
          model: this.resolveModel(),
          instructions: `${instructions}\n\nReply with a single JSON object only, matching this JSON schema:\n${JSON.stringify(
            z.toJSONSchema(schema),
          )}`,
          messages,
          maxOutputTokens: maxTokens,
          abortSignal: this.abortSignal,
        });
        this.reportUsage(usage);
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("The model did not return JSON.");
        const parsed = schema.parse(JSON.parse(match[0])) as z.infer<S>;
        if (opts.append) this.history.push({ role: "assistant", content: JSON.stringify(parsed) });
        this.onFinish?.({
          text: JSON.stringify(parsed),
          finishReason,
          usage,
          costUsd: this.costOf(usage),
        });
        return parsed;
      }
    } catch (error) {
      if (opts.append) this.history.pop();
      this.onError?.(error);
      throw error;
    }
  }

  private costOf(usage: LanguageModelUsage): number {
    return estimateCost(this.modelId, usage.inputTokens ?? 0, usage.outputTokens ?? 0);
  }

  /** Meter a raw SDK usage blob (cost is computed here from this seat's model). */
  protected reportUsage(usage: LanguageModelUsage): void {
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    this.onUsage?.({
      inputTokens,
      outputTokens,
      costUsd: estimateCost(this.modelId, inputTokens, outputTokens),
      usage,
    });
  }
}
