import { runDebate } from "@/lib/engine";
import { missingKeys } from "@/lib/models";
import { DebateRequestSchema, type DebateEvent } from "@/lib/types";

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

  // DEBATE_MOCK=1 swaps in fake models for local UI work. Never set it in production.
  const mock = process.env.DEBATE_MOCK === "1";
  const models = mock
    ? await import("@/lib/mock").then((m) => ({ debater: m.mockModel(), moderator: m.mockModel() }))
    : undefined;

  const problems = mock ? [] : missingKeys([config.debaterModel, config.moderatorModel], keys);
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
      try {
        await runDebate(config, keys, emit, signal, models);
        emit({ type: "done" });
      } catch (err) {
        if (!signal.aborted) {
          emit({ type: "error", message: safeMessage(err) });
          emit({ type: "done" });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {}
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

/** Provider errors can echo request headers; strip anything key-shaped. */
function safeMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/(sk-[A-Za-z0-9_-]{8,}|sk-or-[A-Za-z0-9_-]+|sk-ant-[A-Za-z0-9_-]+)/g, "[redacted]").slice(0, 500);
}
