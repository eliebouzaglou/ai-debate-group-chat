export {
  Debate,
  applyCruxUpdates,
  tally,
  majorityHolder,
  type DebateOptions,
  type Emit,
} from "./debate";

export {
  Debater,
  type DebaterOptions,
  type RapidFireExchange,
} from "./debater";

export {
  Coach,
  type CoachOptions,
  type PrepResult,
  type TrapResolution,
  type QA,
} from "./coach";

export { Moderator, type ModeratorOptions } from "./mod";

export {
  LLM,
  type LLMFinish,
  type LLMOptions,
  type LLMUsage,
  type OnceOptions,
} from "./language-model";

export {
  MODEL_IDS,
  getModelInfo,
  keyFor,
  missingKeys,
  estimateCost,
  type ApiKeys,
  type ModelId,
} from "./catalog";
