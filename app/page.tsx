"use client";
import dynamic from "next/dynamic";

// The form reads localStorage on first render, so it only renders in the browser.
const SetupForm = dynamic(() => import("../components/SetupForm"), { ssr: false });

export default function Home() {
  return <SetupForm />;
}
