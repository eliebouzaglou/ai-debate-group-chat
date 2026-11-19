"use client";
// OpenRouter OAuth PKCE, entirely in the browser: https://openrouter.ai/docs/use-cases/oauth-pkce
import { PKCE_VERIFIER, sessionGet, sessionSet } from "./storage";

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function startOpenRouterLogin() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  sessionSet(PKCE_VERIFIER, verifier);
  const callback = `${window.location.origin}/auth/callback`;
  const url = new URL("https://openrouter.ai/auth");
  url.searchParams.set("callback_url", callback);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  window.location.href = url.toString();
}

export async function finishOpenRouterLogin(code: string): Promise<string> {
  const verifier = sessionGet(PKCE_VERIFIER);
  if (!verifier) throw new Error("Login session expired. Please try again.");
  const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  sessionSet(PKCE_VERIFIER, null);
  if (!res.ok) throw new Error(`OpenRouter returned ${res.status}.`);
  const data = (await res.json()) as { key?: string };
  if (!data.key) throw new Error("OpenRouter did not return a key.");
  return data.key;
}
