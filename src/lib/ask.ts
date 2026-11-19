import { streamText, type LanguageModel, type LanguageModelUsage, type ModelMessage } from "ai";
import { estimateCost, type ApiKeys, type ModelId } from "./models";
import { askModeratorSystem } from "./prompts";
import { getModel } from "./providers";
import type { DebateConfig, DebateEvent, Verdict } from "./types";

export type AskEmit = (event: DebateEvent) => void;

/** Stream one moderator reply to a viewer's question about the verdict. */
export async function askModerator(
  opts: {
    config: DebateConfig;
    keys: ApiKeys;
    verdict: Verdict;
    transcript: string;
    /** Prior viewer↔moderator turns in this Q&A, oldest first. */
    history: ModelMessage[];
    question: string;
    emit: AskEmit;
    abortSignal: AbortSignal;
    model?: LanguageModel;
  },
): Promise<void> {
  const { config, keys, verdict, transcript, history, question, emit, abortSignal } = opts;
  const model = opts.model ?? getModel(config.moderatorModel, keys);
  const modelId: ModelId = config.moderatorModel;

  const onUsage = (u: LanguageModelUsage) => {
    const input = u.inputTokens ?? 0;
    const output = u.outputTokens ?? 0;
    emit({
      type: "usage",
      inputTokens: input,
      outputTokens: output,
      costUsd: estimateCost(modelId, input, output),
    });
  };

  const messages: ModelMessage[] = [...history, { role: "user", content: question }];
  emit({ type: "turn_start", seat: "mod", round: -1 });

  const result = streamText({
    model,
    instructions: askModeratorSystem(config, verdict, transcript),
    messages,
    maxOutputTokens: 1200,
    abortSignal,
    onError: ({ error }) => {
      streamError = error;
    },
  });
  let streamError: unknown;
  let full = "";
  for await (const chunk of result.textStream) {
    full += chunk;
    emit({ type: "delta", seat: "mod", text: chunk });
  }
  if (streamError) throw streamError instanceof Error ? streamError : new Error(String(streamError));
  onUsage(await result.usage);
  emit({ type: "turn_end", seat: "mod", text: full.trim() || "(no answer)" });
}
