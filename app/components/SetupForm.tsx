"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MODELS, missingKeys, type ApiKeys, type ModelId } from "@/lib/models";
import { DebateConfigSchema, names, type DebateConfig } from "@/lib/types";
import { loadConfig, loadKeys, saveConfig, saveKeys } from "@/lib/storage";
import { startOpenRouterLogin } from "@/lib/openrouter-auth";
import { Avatar } from "./Avatar";

const DEFAULT_CONFIG: DebateConfig = {
  topic: "Should the federal minimum wage be raised to $20 an hour?",
  sideA: { label: "Republican" },
  sideB: { label: "Democrat" },
  debaterModel: "claude-sonnet-5-5",
  moderatorModel: "claude-haiku-5-5",
  maxRounds: 8,
  firstSpeaker: "a",
};

export default function SetupForm() {
  const router = useRouter();
  const [keys, setKeys] = useState<ApiKeys>(() => loadKeys());
  const [config, setConfig] = useState<DebateConfig>(() => {
    const saved = DebateConfigSchema.safeParse(loadConfig());
    return saved.success ? saved.data : DEFAULT_CONFIG;
  });
  const [error, setError] = useState<string | null>(null);
  const justSignedIn = typeof window !== "undefined" && window.location.search.includes("signedIn=openrouter");

  const n = useMemo(() => names(config), [config]);
  const problems = missingKeys([config.debaterModel, config.moderatorModel], keys);

  const updateKeys = (patch: Partial<ApiKeys>) => {
    const next = { ...keys, ...patch };
    setKeys(next);
    saveKeys(next);
  };
  const set = <K extends keyof DebateConfig>(k: K, v: DebateConfig[K]) => setConfig((c) => ({ ...c, [k]: v }));

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = DebateConfigSchema.safeParse(config);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    saveConfig(parsed.data);
    router.push("/debate");
  };

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex items-center gap-3">
        <div className="flex -space-x-2">
          <Avatar seat="a" name={n.a} size={36} />
          <Avatar seat="mod" name={n.mod} size={36} />
          <Avatar seat="b" name={n.b} size={36} />
        </div>
        <div>
          <h1 className="text-xl font-semibold">AI Debate</h1>
          <p className="text-sm text-[var(--muted)]">Two AIs argue it out. A third one moderates and picks a winner.</p>
        </div>
      </header>

      <form onSubmit={start} className="space-y-5">
        <Section title="API keys" hint="Stored only in this browser and sent with each debate. Never saved on the server.">
          <button
            type="button"
            onClick={() => startOpenRouterLogin()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--input)]"
          >
            {keys.openrouter ? "Connected to OpenRouter · sign in again" : "Sign in with OpenRouter"}
          </button>
          {justSignedIn && keys.openrouter && (
            <p className="text-sm text-[var(--wa-green)]">Signed in. Your OpenRouter key will be used for every model.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <KeyInput label="OpenRouter" value={keys.openrouter} onChange={(v) => updateKeys({ openrouter: v })} placeholder="sk-or-…" />
            <KeyInput label="Anthropic" value={keys.anthropic} onChange={(v) => updateKeys({ anthropic: v })} placeholder="sk-ant-…" />
            <KeyInput label="OpenAI" value={keys.openai} onChange={(v) => updateKeys({ openai: v })} placeholder="sk-…" />
          </div>
          <p className="text-xs text-[var(--muted)]">With an OpenRouter key, every model goes through OpenRouter. Otherwise each model uses its own provider&apos;s key.</p>
        </Section>

        <Section title="Motion">
          <textarea
            className="field min-h-20 resize-y"
            value={config.topic}
            onChange={(e) => set("topic", e.target.value)}
            placeholder="What are they debating?"
          />
        </Section>

        <Section title="Sides">
          <div className="grid gap-3 sm:grid-cols-2">
            <SideInput seat="a" name={n.a} value={config.sideA.label} onChange={(v) => set("sideA", { label: v })} />
            <SideInput seat="b" name={n.b} value={config.sideB.label} onChange={(v) => set("sideB", { label: v })} />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--muted)]">Opens:</span>
            {(["a", "b"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => set("firstSpeaker", s)}
                className={`rounded-full px-3 py-1 ${config.firstSpeaker === s ? "bg-[var(--wa-green)] text-white" : "bg-[var(--input)]"}`}
              >
                {n[s]}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Models">
          <div className="grid gap-3 sm:grid-cols-2">
            <ModelSelect label="Debaters (both sides)" value={config.debaterModel} onChange={(v) => set("debaterModel", v)} />
            <ModelSelect label={`Moderator (${n.mod})`} value={config.moderatorModel} onChange={(v) => set("moderatorModel", v)} />
          </div>
        </Section>

        <Section title={`Length: up to ${config.maxRounds} ${config.maxRounds === 1 ? "answer" : "answers"}`} hint="The moderator can end it early on a concession, repeated dodging, or circular arguments.">
          <input
            type="range"
            min={1}
            max={20}
            value={config.maxRounds}
            onChange={(e) => set("maxRounds", Number(e.target.value))}
            className="w-full accent-[var(--wa-green)]"
          />
        </Section>

        {(error || problems.length > 0) && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error ?? problems.join(" ")}
          </p>
        )}

        <button
          type="submit"
          disabled={problems.length > 0}
          className="w-full rounded-full bg-[var(--wa-green)] py-3 font-medium text-white hover:bg-[var(--wa-green-dark)] disabled:opacity-50"
        >
          Start debate
        </button>
      </form>
    </main>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl bg-[var(--panel)] p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-[var(--muted)]">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function KeyInput({ label, value, onChange, placeholder }: { label: string; value?: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        className="field font-mono text-sm"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function SideInput({ seat, name, value, onChange }: { seat: "a" | "b"; name: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-3 rounded-lg bg-[var(--input)] p-2 pr-3">
      <Avatar seat={seat} name={name} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-[var(--muted)]">{name} argues for</span>
        <input
          className="w-full bg-transparent text-[0.9375rem] font-medium outline-none"
          value={value}
          maxLength={60}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
    </label>
  );
}

function ModelSelect({ label, value, onChange }: { label: string; value: ModelId; onChange: (v: ModelId) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value as ModelId)}>
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}
