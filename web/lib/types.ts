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
  { id: "embeddings", name: "Semantic search", method: "OpenAI text-embedding-3-large" },
  { id: "sonnet", name: "Claude Sonnet 5", method: "LLM reads all 238 memories" },
  { id: "jev", name: "Jev Recall", method: "Scores all 238 memories" },
];

export const KEY_HEADERS: Record<SystemId, string> = {
  embeddings: "x-openai-key",
  sonnet: "x-anthropic-key",
  jev: "x-typesafe-key",
};
