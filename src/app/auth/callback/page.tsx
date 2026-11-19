"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { finishOpenRouterLogin } from "@/lib/openrouter-auth";
import { loadKeys, saveKeys } from "@/lib/storage";

export default function OpenRouterCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // the code is single-use; guard against StrictMode double effects
    ran.current = true;
    const code = new URLSearchParams(window.location.search).get("code");
    Promise.resolve()
      .then(() => {
        if (!code) throw new Error("No code in the callback URL.");
        return finishOpenRouterLogin(code);
      })
      .then((key) => {
        saveKeys({ ...loadKeys(), openrouter: key });
        router.replace("/?signedIn=openrouter");
      })
      .catch((e: Error) => setError(e.message));
  }, [router]);

  return (
    <main className="flex flex-1 items-center justify-center p-6 text-center">
      {error ? (
        <div className="space-y-3">
          <p className="font-medium">OpenRouter sign-in failed</p>
          <p className="text-sm text-[var(--muted)]">{error}</p>
          <Link href="/" className="inline-block rounded-full bg-[var(--wa-green)] px-4 py-2 text-sm font-medium text-white">
            Back to setup
          </Link>
        </div>
      ) : (
        <p className="text-[var(--muted)]">Signing you in with OpenRouter…</p>
      )}
    </main>
  );
}
