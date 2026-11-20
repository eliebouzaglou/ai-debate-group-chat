# AI Debate

Two AIs argue opposite sides of a motion. A third AI moderates: it writes a backstage brief, fact-checks each side’s plan, runs a rapid-fire knockout round, asks pointed questions in the long debate, and judges the winner on the deciding questions, unanswered points, and concessions. The transcript streams live and looks like a group chat.

Debates run entirely in the browser. Your API keys never leave the client except to call the model providers you choose.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000, add a key (or sign in with OpenRouter), set the motion and sides, and press **Start debate**.

### Keys

- Keys are stored in this browser’s `localStorage` and used from the client for every model call. The Next.js app never sees or stores them.
- If an OpenRouter key is present it is used for every model. Otherwise each model uses its own provider’s key (Anthropic or OpenAI). Models marked “(OpenRouter)” need an OpenRouter key.
- **Sign in with OpenRouter** uses OpenRouter’s OAuth PKCE flow in the browser. The key it returns is saved like a pasted one.

### Command-line runner

Same debate engine, no UI. Keys come from `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY`.

```bash
npm run cli -- --topic "Should the US adopt a carbon tax?" --a Republican --b Democrat
```

Options: `--debater <model>`, `--moderator <model>`, `--first a|b` (skip the coin flip).

## How it works

```
src/
  app/
    page.tsx                 setup screen
    debate/page.tsx          live chat (loads DebateChat)
    auth/callback/page.tsx   OpenRouter PKCE callback
  components/                SetupForm, DebateChat, Avatar
  lib/
    core/                    Debate, Debater, Coach, Moderator, LLM, catalog
    prompts/                 prompt templates
    features/                markdown export, OpenRouter auth
    sanitize.ts              strips AI tells before relaying
    storage.ts               localStorage for keys + config
  config/                    ANSWER_CAP, CRUX_COUNT, RAPID_FIRE_COUNT
  constants/models.ts        model list and prices
  types/                     zod schemas and event types
  utils/                     persona names, cost formatting, concession check
scripts/
  cli.ts                     command-line runner (`npm run cli`)
```

Flow of one match (`Debate.run()` in `src/lib/core/debate.ts`):

1. **Coin flip** — fair random opener; the chat plays a coin-flip animation.
2. **Backstage brief** — the moderator writes whether only one side can be right, each side’s commitments, shared ground, three deciding questions, a coaching brief per side, and the referee standard. Debaters never see the full brief as-is.
3. **Coach prep** — each side’s plan is written as if a client asked its coach “help me win,” then fact-checked by the moderator model and revised once. The final plan is pinned into that debater’s instructions.
4. **Rapid fire** — each side fires up to 5 yes/no questions, springs a conclusion, and the defender’s coach privately says beaten or not. The referee scores the exchange against the deciding questions; a closed trap can end the debate here.
5. **Long debate** — moderator questions, debater answers (streamed), answer sanitized, moderator decides `{ action, question, reason }` plus fact-checks and leaning. Opponent only gets the cleaned answer plus the next question. Ends on concession, unanswered decisive point, or the 30-answer safety cap.
6. **Verdict** — who is right on the merits (scoreboard wins; style ignored). Afterward you can ask the moderator about the ruling in the same live session.

Other details:

- **Private histories.** Moderator and each debater keep their own message history for one run. A debater never sees the other’s history.
- **Scoreboard.** A bar under the chat header shows who holds each deciding question; it updates after traps and long-debate answers.
- **Moderator leaning.** Hover Morgan for who it’s leaning toward and why. Debaters never see it.
- **Fact checks.** Sources in the latest answer are rated `clean`, `unsupported`, `wrong`, or `fake`. Callouts appear in chat and are relayed to the other side.
- **Sanitizer.** Regex pass for AI tells; if anything still looks off, a cheap call to the moderator model rewrites it.
- **Names.** Alliterative persona names from each side’s label (Republican → Rita). The moderator is Morgan.
- **Stop / spend.** Stop aborts in-flight generation. Hover the stop control for running token and cost estimates; totals also land in the footer and Markdown export.

## Models

The list lives in `src/constants/models.ts`. OpenRouter slugs change over time; if one fails, check https://openrouter.ai/models and update `openrouterId`.

## Hosting

The UI is a normal Next.js app (`npm run build && npm start`). Model calls go from the browser to the providers, so there is no long server-side debate request to time out. Any static-friendly or Node host for Next works.
