import type { LanguageModel, ModelMessage } from "ai";
import { describeBrief, relayMessage, type QA, type RapidFireExchange } from "../prompts";
import {
  answerLimit,
  hasConcession,
  names,
  RAPID_FIRE_COUNT,
  type CruxState,
  type CruxUpdate,
  type DebateConfig,
  type DebateEvent,
  type Debater as Side,
  type TrapResult,
  type Verdict,
} from "../types";
import { Debater } from "./debater";
import type { ApiKeys, LLMUsage } from "./language-model";
import { Moderator } from "./mod";

export type Emit = (event: DebateEvent) => void;

export interface DebateOptions {
  keys: ApiKeys;
  onEvent: Emit;
  abortSignal: AbortSignal;
  /** Inject models directly (tests, mock mode). */
  models?: { debater: LanguageModel; moderator: LanguageModel };
  /** Force who opens (CLI/tests). Otherwise a fair coin flip. */
  firstSpeaker?: Side;
}

interface Line {
  seat: "mod" | Side;
  text: string;
}

/** Apply a model's scoreboard update. Missing or malformed entries leave that row unchanged. */
export function applyCruxUpdates(board: CruxState[], updates: CruxUpdate[] | undefined): CruxState[] {
  return board.map((row, i) => {
    const u = updates?.[i];
    if (!u || !["a", "b", "open"].includes(u.favours)) return row;
    return { ...row, favours: u.favours, note: u.favours === "open" ? "" : (u.note ?? "").trim() || row.note };
  });
}

export function tally(board: CruxState[]) {
  return {
    a: board.filter((c) => c.favours === "a").length,
    b: board.filter((c) => c.favours === "b").length,
  };
}

/** A side that holds more than half the deciding questions has won the debate. */
export function majorityHolder(board: CruxState[]): Side | null {
  const t = tally(board);
  if (t.a > board.length / 2) return "a";
  if (t.b > board.length / 2) return "b";
  return null;
}

const other = (s: Side): Side => (s === "a" ? "b" : "a");

/**
 * One full match: owns moderator + both debaters, scoreboard, transcript, usage.
 *
 *   const debate = new Debate(config, { keys, onEvent: emit, abortSignal });
 *   const verdict = await debate.run();
 *   await debate.ask("Why did B win crux 2?");
 */
export class Debate {
  readonly config: DebateConfig;
  readonly mod: Moderator;
  readonly a: Debater;
  readonly b: Debater;

  scoreboard: CruxState[] = [];
  verdict: Verdict | null = null;
  opener: Side | null = null;

  private readonly emit: Emit;
  private readonly abortSignal: AbortSignal;
  private readonly firstSpeaker?: Side;
  private readonly totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  private readonly transcript: Line[] = [];

  constructor(config: DebateConfig, options: DebateOptions) {
    this.config = config;
    this.emit = options.onEvent;
    this.abortSignal = options.abortSignal;
    this.firstSpeaker = options.firstSpeaker;

    const seatOpts = (seat: "mod" | Side, model?: LanguageModel) => ({
      keys: options.keys,
      abortSignal: options.abortSignal,
      model,
      onDelta: (text: string) => this.emit({ type: "delta", seat, text }),
      onUsage: (u: LLMUsage) => this.meter(u),
    });

    this.mod = new Moderator(config, seatOpts("mod", options.models?.moderator));
    this.a = new Debater(config, "a", seatOpts("a", options.models?.debater));
    this.b = new Debater(config, "b", seatOpts("b", options.models?.debater));
  }

  side(seat: Side): Debater {
    return seat === "a" ? this.a : this.b;
  }

  /** Full debate: brief → prep → rapid fire → long debate → verdict. */
  async run(): Promise<Verdict> {
    const n = names(this.config);
    const opener: Side =
      this.firstSpeaker ?? (crypto.getRandomValues(new Uint8Array(1))[0]! & 1 ? "b" : "a");
    this.opener = opener;
    this.emit({ type: "coin_flip", winner: opener });

    // ── 1. Brief ─────────────────────────────────────────────────────────────
    this.emit({ type: "turn_start", seat: "mod", round: 0, prep: true });
    const brief = await this.mod.writeBrief();
    this.emit({ type: "turn_end", seat: "mod", text: describeBrief(brief) });

    this.scoreboard = this.mod.initialScoreboard();
    this.emit({ type: "scoreboard", cruxes: this.scoreboard });

    // ── 2. Coach prep ────────────────────────────────────────────────────────
    await Promise.all(
      (["a", "b"] as const).map(async (seat) => {
        const debater = this.side(seat);
        this.emit({ type: "turn_start", seat, round: 0, prep: true });
        const { draft, plan, revised } = await debater.prepare(brief, (d) =>
          this.mod.checkPlan(seat, d),
        );
        this.emit({ type: "turn_end", seat, text: draft });
        this.emit({ type: "plan_update", seat, text: plan, revised });
      }),
    );
    this.abortSignal.throwIfAborted();

    // ── 3. Rapid fire ────────────────────────────────────────────────────────
    const intro = `Rapid fire. Each of you gets one chain of up to ${RAPID_FIRE_COUNT} yes-or-no questions at the other, then springs your conclusion. Answers are final: no taking them back. You get one reply after the spring. I score every exchange against the deciding questions; win most of them and the debate ends here. ${n[opener]} goes first.`;
    this.emit({ type: "turn_start", seat: "mod", round: 0, rapidFire: true });
    this.emit({ type: "delta", seat: "mod", text: intro });
    this.emit({ type: "turn_end", seat: "mod", text: intro, rapidFire: true });
    this.transcript.push({ seat: "mod", text: intro });

    const exchanges: RapidFireExchange[] = [];
    const rulings: string[] = [];
    let knockout: Side | null = null;

    for (const asker of [opener, other(opener)] as const) {
      this.abortSignal.throwIfAborted();
      const answerer = other(asker);
      const ask = this.side(asker);
      const ans = this.side(answerer);
      const qa: QA[] = [];

      for (let i = 0; i < RAPID_FIRE_COUNT; i++) {
        this.abortSignal.throwIfAborted();
        this.emit({ type: "turn_start", seat: asker, round: 0, rapidFire: true, rapidFireAsk: true });
        const next = await ask.nextRapidFireQuestion(qa);
        const question = next.question.trim();
        if (!question || (next.ready && qa.length > 0)) {
          this.emit({ type: "turn_end", seat: asker, text: "", rapidFire: true, rapidFireAsk: true });
          break;
        }
        this.emit({ type: "delta", seat: asker, text: question });
        this.emit({ type: "turn_end", seat: asker, text: question, rapidFire: true, rapidFireAsk: true });
        this.transcript.push({ seat: asker, text: `Rapid fire to ${n[answerer]}: ${question}` });

        this.emit({ type: "turn_start", seat: answerer, round: 0, rapidFire: true });
        const answer = await ans.answerRapidFire(asker, question, i + 1);
        const text = answer === "yes" ? "Yes" : "No";
        this.emit({ type: "delta", seat: answerer, text });
        this.emit({ type: "turn_end", seat: answerer, text, rapidFire: true });
        this.transcript.push({ seat: answerer, text: `${text} (to: ${question})` });
        qa.push({ question, answer });
        exchanges.push({ asker, question, answer });
      }
      if (!qa.length) continue;

      this.emit({ type: "turn_start", seat: asker, round: 0, rapidFire: true, trap: "spring" });
      const spring = await ask.spring(qa);
      this.emit({ type: "turn_end", seat: asker, text: spring, rapidFire: true, trap: "spring" });
      this.transcript.push({ seat: asker, text: `Springs the trap: ${spring}` });

      this.emit({ type: "turn_start", seat: answerer, round: 0, rapidFire: true, trap: "check" });
      const { check, checkText, reply, conceded } = await ans.resolveTrap(qa, spring);
      this.emit({ type: "delta", seat: answerer, text: checkText });
      this.emit({
        type: "turn_end",
        seat: answerer,
        text: checkText,
        rapidFire: true,
        trap: "check",
        checkVerdict: check.verdict,
      });
      this.transcript.push({
        seat: answerer,
        text: `Private check (from ${n[answerer]}'s own coach): ${checkText}`,
      });

      this.emit({ type: "turn_start", seat: answerer, round: 0, rapidFire: true, trap: "reply" });
      this.emit({ type: "delta", seat: answerer, text: reply });
      this.emit({ type: "turn_end", seat: answerer, text: reply, rapidFire: true, trap: "reply" });
      this.transcript.push({ seat: answerer, text: `Replies: ${reply}` });

      this.emit({ type: "turn_start", seat: "mod", round: 0, rapidFire: true, trap: "ruling" });
      const ruling = await this.mod.ruleTrap(asker, qa, spring, reply, check, this.scoreboard);
      const before = tally(this.scoreboard)[asker];
      this.scoreboard = applyCruxUpdates(this.scoreboard, ruling.cruxes);
      this.emit({ type: "scoreboard", cruxes: this.scoreboard });

      const holder = majorityHolder(this.scoreboard);
      const result: TrapResult =
        conceded || holder === asker
          ? "closed"
          : tally(this.scoreboard)[asker] > before
            ? "scored"
            : "escaped";
      const label = result === "closed" ? "Trap closed" : result === "scored" ? "Point scored" : "Escaped";
      const rulingText = (conceded ? `${n[answerer]} concedes. ` : "") + (ruling.explanation.trim() || label);
      this.emit({ type: "delta", seat: "mod", text: rulingText });
      this.emit({
        type: "turn_end",
        seat: "mod",
        text: rulingText,
        rapidFire: true,
        trap: "ruling",
        trapResult: result,
      });
      this.transcript.push({
        seat: "mod",
        text: `Ruling on ${n[asker]}'s rapid-fire trap: ${label.toUpperCase()}. ${rulingText}`,
      });
      rulings.push(`${n[asker]}'s trap on ${n[answerer]}: ${result}. ${rulingText}`);
      if (result === "closed") {
        knockout = asker;
        break;
      }
    }

    this.a.pinRapidFire(exchanges);
    this.b.pinRapidFire(exchanges);

    // ── 4. Long debate ───────────────────────────────────────────────────────
    if (!knockout) {
      this.emit({ type: "turn_start", seat: "mod", round: 0 });
      const opening = await this.mod.open(opener, rulings);
      this.emit({ type: "turn_end", seat: "mod", text: opening });
      this.transcript.push({ seat: "mod", text: opening });

      let speaker: Side = opener;
      let nextUserMessage = relayMessage(null, opening);
      const pendingFactCheck: Record<Side, string | undefined> = { a: undefined, b: undefined };
      const limit = answerLimit();

      for (let round = 1; round <= limit; round++) {
        this.abortSignal.throwIfAborted();
        const debater = this.side(speaker);

        this.emit({ type: "turn_start", seat: speaker, round });
        const answer = await debater.answer(nextUserMessage);
        this.emit({ type: "turn_end", seat: speaker, text: answer });
        this.transcript.push({ seat: speaker, text: answer });

        this.emit({ type: "turn_start", seat: "mod", round });
        const [cleaned, decision] = await Promise.all([
          this.mod.sanitize(answer),
          this.mod.decide(speaker, answer, round, this.scoreboard),
        ]);
        if (decision.leaning) this.emit({ type: "leaning", ...decision.leaning });
        const updated = applyCruxUpdates(this.scoreboard, decision.cruxes);
        if (JSON.stringify(updated) !== JSON.stringify(this.scoreboard)) {
          this.scoreboard = updated;
          this.emit({ type: "scoreboard", cruxes: this.scoreboard });
        }

        const fc = decision.factCheck;
        const callout = fc && fc.status !== "clean" ? fc.callout.trim() : "";
        if (callout) {
          this.emit({ type: "delta", seat: "mod", text: callout });
          this.emit({ type: "turn_end", seat: "mod", text: callout, factCheck: fc.status });
          this.transcript.push({
            seat: "mod",
            text: `Fact check (${fc.status} source) on ${n[speaker]}: ${callout}`,
          });
          pendingFactCheck[speaker] = callout;
          this.emit({ type: "turn_start", seat: "mod", round });
        }

        const concededNow = hasConcession(answer);
        const finished =
          concededNow || decision.action === "end" || round >= limit || !decision.question.trim();
        const modText = !finished
          ? decision.question.trim()
          : concededNow
            ? `${n[speaker]} concedes. ${decision.reason}`.trim()
            : round >= limit
              ? `We've hit the ${limit}-answer safety limit with no concession. ${decision.reason}`.trim()
              : `${decision.reason}`.trim();
        this.emit({ type: "delta", seat: "mod", text: modText });
        this.emit({ type: "turn_end", seat: "mod", text: modText });
        this.transcript.push({ seat: "mod", text: modText });
        if (finished) break;

        const next = other(speaker);
        nextUserMessage = relayMessage(cleaned, decision.question.trim(), {
          onOpponent: callout || undefined,
          onYou: pendingFactCheck[next],
        });
        pendingFactCheck[next] = undefined;
        speaker = next;
      }
    }

    // ── 5. Verdict ───────────────────────────────────────────────────────────
    this.abortSignal.throwIfAborted();
    const analysis = this.mod.analysis!;
    const label = {
      mod: `${n.mod} (moderator)`,
      a: `${n.a} (${this.config.sideA.label})`,
      b: `${n.b} (${this.config.sideB.label})`,
    };
    const text = this.transcript.map((l) => `${label[l.seat]}: ${l.text}`).join("\n\n");

    this.emit({ type: "turn_start", seat: "mod", round: -1 });
    const verdict = await this.mod.verdict(text, this.scoreboard);

    const oneRight = analysis.kind === "one_right";
    const finalBoard = knockout ? this.scoreboard : applyCruxUpdates(this.scoreboard, verdict.cruxes);
    const t = tally(finalBoard);
    if (knockout) verdict.winner = knockout;
    else if (t.a !== t.b) verdict.winner = t.a > t.b ? "a" : "b";
    else if (oneRight && verdict.winner === "draw") verdict.winner = opener === "a" ? "b" : "a";
    verdict.cruxes = finalBoard.map(({ favours, note }) => ({ favours, note }));
    verdict.oneRight = oneRight;

    this.scoreboard = finalBoard;
    this.verdict = verdict;
    this.emit({ type: "scoreboard", cruxes: finalBoard });
    this.emit({ type: "verdict", ...verdict });
    return verdict;
  }

  /**
   * Post-debate viewer Q&A with the moderator.
   *
   * Normal path (same live instance after run()): just `await debate.ask(question)`.
   * The moderator's LLM history already holds prior Q&A turns — do not pass history.
   *
   * ⚠️ DANGER — `opts.history` / `opts.transcript` / `opts.verdict`:
   * The ONLY valid reason to pass these is a stateless HTTP remount: the server threw
   * away this Debate after /api/debate, and /api/ask is a brand-new process that must
   * rebuild moderator context from what the client stored. Any other use fights the
   * internal history and will corrupt the seat. Do not pass history "just in case."
   */
  async ask(
    question: string,
    opts?: {
      /** Stateless /api/ask remount only — see DANGER note above. */
      transcript?: string;
      /**
       * ⚠️ DANGER: do not pass unless this Debate was just constructed for a stateless
       * /api/ask remount and the client is handing back the Q&A thread the server forgot.
       * Same live instance after run()? Omit this. History is already managed internally.
       */
      history?: ModelMessage[];
      /** Stateless /api/ask remount only — same DANGER as history. */
      verdict?: Verdict;
    },
  ): Promise<string> {
    const verdict = opts?.verdict ?? this.verdict;
    if (!verdict) throw new Error("Debate.ask() needs a verdict — call run() first or pass opts.verdict.");

    this.verdict = verdict;
    this.mod.ensureAsk(verdict, opts?.transcript ?? this.transcriptText());
    // Stateless remount only — see DANGER on opts.history. Never use to "sync" a live seat.
    if (opts?.history) this.mod.setHistory(opts.history);

    this.emit({ type: "turn_start", seat: "mod", round: -1 });
    const text = await this.mod.ask(question);
    this.emit({ type: "turn_end", seat: "mod", text });
    return text;
  }

  /** Plain transcript string (same shape the verdict / ask prompts use). */
  transcriptText(): string {
    const n = names(this.config);
    const label = {
      mod: `${n.mod} (moderator)`,
      a: `${n.a} (${this.config.sideA.label})`,
      b: `${n.b} (${this.config.sideB.label})`,
    };
    return this.transcript.map((l) => `${label[l.seat]}: ${l.text}`).join("\n\n");
  }

  private meter(u: LLMUsage): void {
    this.totals.inputTokens += u.inputTokens;
    this.totals.outputTokens += u.outputTokens;
    this.totals.costUsd += u.costUsd;
    this.emit({ type: "usage", ...this.totals });
  }
}
