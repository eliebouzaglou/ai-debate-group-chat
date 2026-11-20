import type { Debater, FactCheckStatus, Seat } from "./common";
import type { CruxState } from "./crux";
import type { Leaning } from "./moderator";
import type { SelfCheck, TrapResult, TrapStage } from "./trap";
import type { Verdict } from "./verdict";

export type DebateEvent =
  | {
    type: "turn_start";
    seat: Seat;
    round: number;
    /** Private pre-debate game plan. */
    prep?: boolean;
    /** Opening yes/no cross-ex. */
    rapidFire?: boolean;
    /** This turn is the question (not the yes/no answer). */
    rapidFireAsk?: boolean;
    /** Rapid-fire trap stage: the asker's conclusion, the defender's private check, its reply, or the ruling. */
    trap?: TrapStage;
  }
  | { type: "delta"; seat: Seat; text: string }
  | {
    type: "turn_end";
    seat: Seat;
    text: string;
    /** Set when this moderator message is a source fact-check. */
    factCheck?: FactCheckStatus;
    rapidFire?: boolean;
    rapidFireAsk?: boolean;
    trap?: TrapStage;
    trapResult?: TrapResult;
    /** The defender's private verdict on whether it was beaten. */
    checkVerdict?: SelfCheck["verdict"];
  }
  | { type: "scoreboard"; cruxes: CruxState[] }
  | { type: "plan_update"; seat: Debater; text: string; revised: boolean } // plan after the fact-check
  | ({ type: "verdict" } & Verdict)
  | { type: "coin_flip"; winner: Debater }
  | ({ type: "leaning" } & Leaning)
  | { type: "usage"; inputTokens: number; outputTokens: number; costUsd: number } // running totals
  | { type: "error"; message: string };
