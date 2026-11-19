export function safeMessage(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.replace(/(sk-[A-Za-z0-9_-]{8,}|sk-or-[A-Za-z0-9_-]+|sk-ant-[A-Za-z0-9_-]+)/g, "[redacted]").slice(0, 500);
}
