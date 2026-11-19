"use client";
import type { ApiKeys } from "./models";
import type { DebateConfig } from "./types";

const KEYS = "ai-debate:keys";
const CONFIG = "ai-debate:config";
export const PKCE_VERIFIER = "ai-debate:pkce-verifier";

function read<T>(store: Storage | undefined, key: string): T | null {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(store: Storage | undefined, key: string, value: unknown) {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {}
}

const local = () => (typeof window === "undefined" ? undefined : window.localStorage);
const session = () => (typeof window === "undefined" ? undefined : window.sessionStorage);

export const loadKeys = (): ApiKeys => read<ApiKeys>(local(), KEYS) ?? {};
export const saveKeys = (keys: ApiKeys) => write(local(), KEYS, keys);

// The last config lives in localStorage so the setup form remembers it.
export const loadConfig = () => read<DebateConfig>(local(), CONFIG);
export const saveConfig = (c: DebateConfig) => write(local(), CONFIG, c);

export function sessionGet(key: string) {
  try {
    return session()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
export function sessionSet(key: string, value: string | null) {
  try {
    if (value === null) session()?.removeItem(key);
    else session()?.setItem(key, value);
  } catch {}
}
