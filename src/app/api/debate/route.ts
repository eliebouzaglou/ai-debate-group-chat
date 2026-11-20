import { Debate, missingKeys } from "@/lib/v2-core";
import { DebateRequestSchema, type DebateEvent } from "@/lib/types";
import { safeMessage } from "@/utils";

// Runs on the Node runtime (the default; an explicit `runtime` export is rejected
// when cacheComponents is enabled).
// Long debates take minutes. Serverless hosts cap this; see README for Node hosting.
export const maxDuration = 800;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = DebateRequestSchema.safeParse(body);
  if (!parsed.success) {
    // Never echo the body back: it contains API keys.
    return Response.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }
  const { config, keys } = parsed.data;

  const problems = missingKeys([config.debaterModel, config.moderatorModel], keys);
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
      // Long thinking turns can go quiet for a minute or more; a small ping every 15s keeps
      // proxies and browsers from treating the stream as dead.
      const keepAlive = setInterval(() => emit({ type: "ping" }), 15_000);
      try {
        const debate = new Debate(config, {
          keys,
          onEvent: emit,
          abortSignal: signal,
        });
        await debate.run();
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
    },
  });
}
