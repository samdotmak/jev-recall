export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.00001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(3)}`;
}

export const METHOD_COLOR = {
  embeddings: "var(--embeddings)",
  sonnet: "var(--sonnet)",
  jev: "var(--jev)",
} as const;
