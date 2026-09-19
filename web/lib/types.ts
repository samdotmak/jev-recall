export type SystemId = "embeddings" | "sonnet" | "jev";

export type Memory = { id: string; text: string };

export type RunResult = {
  ids: string[]; // memories the system chose, best first
  scores?: Record<string, number>; // Jev: probability per chosen memory
  latencyMs: number; // time spent inside the provider call(s)
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};

export const SYSTEMS: { id: SystemId; name: string; method: string }[] = [
  { id: "embeddings", name: "Semantic search", method: "OpenAI text-embedding-3-large · top 5" },
  { id: "sonnet", name: "LLM judge", method: "Claude Sonnet 5 reads every memory" },
  { id: "jev", name: "Jev Recall", method: "TypeSafe Jev scores every memory" },
];

export const KEY_HEADERS: Record<SystemId, string> = {
  embeddings: "x-openai-key",
  sonnet: "x-anthropic-key",
  jev: "x-typesafe-key",
};
