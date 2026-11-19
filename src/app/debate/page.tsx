"use client";
import dynamic from "next/dynamic";

// Reads the config and keys from localStorage, so it only renders in the browser.
const DebateChat = dynamic(() => import("../../components/DebateChat"), { ssr: false });

export default function DebatePage() {
  return <DebateChat />;
}
