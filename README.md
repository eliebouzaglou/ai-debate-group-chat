# AI Debate

Two AIs argue opposite sides of a motion. A third AI moderates: it asks pointed questions, decides when the debate is over, and judges the winner on unanswered points and concessions. The transcript streams live and looks like a group chat.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000, add a key (or sign in with OpenRouter), set the motion and sides, and press **Start debate**.

### Keys

- Keys are stored in your browser's `localStorage` and sent with each debate request. The server never stores or logs them.
- If an OpenRouter key is present it is used for every model. Otherwise each model uses its own provider's key (Anthropic or OpenAI). Models marked "(OpenRouter)" need an OpenRouter key.
- **Sign in with OpenRouter** uses OpenRouter's OAuth PKCE flow entirely in the browser. The key it returns is saved like a pasted one.

### Command-line runner

Test the debate logic without the UI. Keys come from `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.

```bash
npm run debate -- --topic "Should the US adopt a carbon tax?" --a Republican --b Democrat --rounds 6
```

Options: `--debater <model>`, `--moderator <model>`, `--first a|b` (skip the coin flip), `--all-the-way` (run until someone concedes), `--mock` (fake models, no keys, no cost).

### Mock mode

`DEBATE_MOCK=1 npm run dev` swaps in canned fake models on the server, so you can work on the UI without spending tokens. Any non-empty key in the setup form passes the client check. Never set it in production.

## How it works

```
app/
  page.tsx                setup screen
  debate/page.tsx         live chat transcript
  auth/callback/page.tsx  OpenRouter PKCE callback
  api/debate/route.ts     runs the debate, streams NDJSON events
lib/
  types.ts      zod schemas, event types, persona names
  models.ts     model list, key routing, validation (browser-safe)
  providers.ts  builds AI SDK models (server only)
  engine.ts     debate loop
  prompts.ts    moderator, debater, verdict and sanitizer prompts
  sanitize.ts   strips AI tells before relaying
  mock.ts       fake models for tests and mock mode
scripts/
  debate.ts     command-line runner
```

- **Private histories.** The moderator and each debater have their own message history, held in memory for one request. A debater never sees the other's history.
- **Coin flip.** The server flips a fair coin to pick who opens, and the chat plays a coin-flip animation with both names on it.
- **Backstage brief.** Before anyone prepares, the moderator writes a brief for this specific motion: whether only one side can be right, what each side is committed to (texts, data, core claims), the shared ground, three deciding questions, a coaching brief for each side, and the fixed referee standard it will rule by. The brief never reaches the debaters as-is.
- **Prep: coach framing, fact-checked.** Each side's plan is written as if a client asked its coach "I'm about to debate X; help me win", from that side's slice of the brief (the opponent's commitments and weak spots, not its own). It has undeniable sourced facts, a knockout chain of yes/no questions that just ask what a source says, the spring, shut lines for the opponent's escapes, and a move list. The moderator model then fact-checks each plan (wrong citations, questions that aren't really forced, unshut escapes) and the coach revises it once. The final plan is pinned into that debater's instructions. In tests this framing produced stronger, less hedged plans than role-play ("You are a committed X, argue to win").
- **Each answer:** the moderator questions the current speaker, the debater answers (streamed), the answer is sanitized, the moderator reads the raw answer and returns `{ action, question, reason }`, and code builds the opponent's next message: `Your opponent said: «cleaned answer» Moderator: question`. The moderator never rewrites the argument.
- **Ending.** A debate only finishes when one side has no way to answer: an explicit "I concede", or failing three times to answer the same decisive point (treated as conceding it). The moderator keeps cornering whoever dodges instead of ending for repetition. A 30-answer safety limit (`ANSWER_CAP` in `lib/types.ts`) stops two stubborn models from spending forever.
- **Rapid fire: the knockout round.** Right after prep, each side (coin-flip winner first) fires a chain of up to 5 yes/no questions at the other, picking each next question after seeing the last answer. Answers are final: they can be explained but not taken back, and a walk-back counts against you. The asker springs the conclusion, spelling out why each answer forces the next step. Then the defender privately asks its own coach "did they beat me?": binary only — **beaten** (forfeit with "I concede") or **not beaten** (must name the false premise or broken step; no "partly"). The referee scores the exchange against each deciding question. A concession, or the asker holding most deciding questions, closes the trap and ends the debate; otherwise the long debate starts.
- **Scoreboard.** A bar under the chat header shows who holds each deciding question. The referee updates it after every rapid-fire trap and every long-debate answer, only moving a question when an exchange settles it.
- **Staying on plan.** After prep, each debater's plan is pinned at the end of its own instructions (not buried in the history), and every turn ends with a one-line private reminder. Before each answer the debater checks which move it's on and whether a trap took, answers attacks briefly, and steers back to its next move.
- **Moderator leaning.** With every decision the moderator also records who it's leaning toward (even, slight, clear or decisive) and why: false or unsupported claims, unanswered points, dodges, contradictions, landed traps, stronger evidence, persuasiveness. Hover Morgan in the header or on any moderator bubble to see it. The debaters never see it.
- **Fact checks.** With every decision, the moderator checks the sources in the latest answer and rates them `clean`, `unsupported` (no source, or too vague), `wrong` (real source, wrong claim, figure, year or author) or `fake` (no such source). A callout appears as a red "Fact check" bubble before the next question, the opponent gets it with the relayed answer, and the debater who was called out is told on their next turn to correct or withdraw. The moderator has no web access, so it flags from its own knowledge and is told to say "unsupported" rather than "fake" when unsure.
- **Verdict: who is right, not who debated better.** The moderator's purpose is to find out which side is correct; the debate is how it tests the claims. The verdict checks each side's key claims against the model's own knowledge (an unanswered claim isn't automatically true), checks the reasoning, uses fact-checks and concessions as evidence, and ignores style. It returns the correct side, why on the merits, and a confidence level (low, medium or high). The judge also gives a final ruling on each deciding question, and the winner follows that scoreboard in code; only a tie falls back to the judge's own pick, and on motions where only one side can be right "draw" isn't an allowed answer. Asking the moderator about the verdict gets a defence on the merits, and an admission if you show it a real error.
- **Sanitizer.** A regex pass removes obvious tells ("As an AI…", markdown, "great question"). If anything still looks suspicious, a cheap call to the moderator model rewrites it.
- **Streaming.** The route sends a small `ping` every 15 seconds so long silent stretches (thinking, judging) don't look like a dead connection. The client POSTs config and keys and reads newline-delimited JSON with `fetch` (EventSource can't POST). The route passes `request.signal` to every model call, so **Stop** or closing the tab aborts generation and stops token spend.
- **Names.** Each side gets an alliterative persona name from its label (Republican → Rita, Democrat → Dana). The moderator is Morgan.

## Hosting

Debates run for several minutes in one request. The route sets `maxDuration = 800` and runs on the Node runtime.

- **Recommended:** a long-lived Node host (`npm run build && npm start` on Fly, Railway, Render, a VPS, etc.) with no request timeout.
- **Vercel:** works within your plan's function duration limit. Long debates with slow models can hit it; lower the answer limit or use faster models.

## Models

The list lives in `lib/models.ts`. OpenRouter slugs change over time; if one fails, check https://openrouter.ai/models and update `openrouterId`.

## Spend tracking

Every model call (prep, moderator, debaters, sanitizer, verdict) reports its token usage. The route streams running totals, and hovering the green stop button shows tokens and an estimated cost. The final total appears in the footer and the Markdown export. Costs use each model's list price in `price` (US dollars per million input/output tokens, from OpenRouter's catalog in Nov 2026), so treat them as estimates. Tokens from a call cut short by Stop aren't counted.
