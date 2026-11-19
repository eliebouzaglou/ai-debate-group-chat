export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return "<$0.001";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString("en-US");
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "debate";
}
