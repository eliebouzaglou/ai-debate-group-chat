import { askModerator } from "@/lib/ask";
import { missingKeys } from "@/lib/models";
import { AskModeratorRequestSchema, type DebateEvent } from "@/lib/types";
import { safeMessage } from "@/utils";
export const maxDuration = 120;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = AskModeratorRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }
  const { config, keys, verdict, transcript, history, question } = parsed.data;

  const mock = process.env.DEBATE_MOCK === "1";
  const model = mock ? await import("@/lib/mock").then((m) => m.mockModel()) : undefined;

  const problems = mock ? [] : missingKeys([config.moderatorModel], keys);
  if (problems.length) return Response.json({ error: problems.join(" ") }, { status: 400 });

  const signal = request.signal;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: DebateEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      const keepAlive = setInterval(() => emit({ type: "ping" }), 15_000);
      try {
        await askModerator({
          config,
          keys,
          verdict,
          transcript,
          history,
          question,
          emit,
          abortSignal: signal,
          model,
        });
        emit({ type: "done" });
      } catch (err) {
        if (!signal.aborted) {
          emit({ type: "error", message: safeMessage(err) });
          emit({ type: "done" });
        }
      } finally {
        clearInterval(keepAlive);
        closed = true;
        try {
          controller.close();
        } catch { }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      ...(mock ? { "X-Debate-Mock": "1" } : {}),
    },
  });
}
