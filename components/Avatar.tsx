import type { Seat } from "@/lib/types";

const COLOR: Record<Seat, string> = {
  a: "var(--seat-a)",
  b: "var(--seat-b)",
  mod: "var(--seat-mod)",
};

export function Avatar({ seat, name, size = 32 }: { seat: Seat; name: string; size?: number }) {
  return (
    <div
      aria-hidden
      className="flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: COLOR[seat], fontSize: size * 0.42 }}
    >
      {seat === "mod" ? (
        // gavel-ish mark for the moderator
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10" />
          <path d="m16 16 6-6" />
          <path d="m8 8 6-6" />
          <path d="m9 7 8 8" />
        </svg>
      ) : (
        name[0]?.toUpperCase()
      )}
    </div>
  );
}

export const seatColor = (seat: Seat) => COLOR[seat];
