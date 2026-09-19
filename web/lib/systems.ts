// Server-side implementations of the three retrieval systems.
// Each takes the caller's own API key; nothing here reads environment variables.
// Prompts match bench/run.py and src/jev_recall/core.py so results line up with the benchmark.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { z } from "zod";
import { DIM, EMBEDDING_MODEL, VECTORS_B64 } from "@/data/generated/embeddings";
import { MEMORIES, situation } from "./data";
import type { RunResult } from "./types";

export const PRICES = {
  embeddings: { in: 0.13 }, // USD per million tokens
  sonnet: { in: 2.0, out: 10.0 },
  jev: { in: 0.042 }, // output tokens are free
};

export class ProviderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function describe(err: unknown, provider: string): ProviderError {
  const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 502;
  if (status === 401 || status === 403) return new ProviderError(401, `${provider} rejected the API key.`);
  if (status === 429) return new ProviderError(429, `${provider} rate limit hit. Try again in a moment.`);
  return new ProviderError(502, `${provider} request failed (${status}).`);
}

// ---------------- Semantic search: OpenAI embeddings, cosine top-k ----------------

let matrix: Float32Array | null = null;
function memoryMatrix(): Float32Array {
  if (!matrix) {
    const buf = Buffer.from(VECTORS_B64, "base64");
    const raw = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    matrix = new Float32Array(raw.length);
    for (let i = 0; i < MEMORIES.length; i++) {
      let n = 0;
      for (let d = 0; d < DIM; d++) n += raw[i * DIM + d] ** 2;
      n = Math.sqrt(n);
      for (let d = 0; d < DIM; d++) matrix[i * DIM + d] = raw[i * DIM + d] / n;
    }
  }
  return matrix;
}

export async function runEmbeddings(apiKey: string, request: string, k = 5): Promise<RunResult> {
  const client = new OpenAI({ apiKey, maxRetries: 1 });
  const t0 = performance.now();
  let res;
  try {
    res = await client.embeddings.create({ model: EMBEDDING_MODEL, input: [request] });
  } catch (err) {
    throw describe(err, "OpenAI");
  }
  const latencyMs = performance.now() - t0;
  const q = res.data[0].embedding;
  const qn = Math.sqrt(q.reduce((s, x) => s + x * x, 0));
  const M = memoryMatrix();
  const sims = MEMORIES.map((_, i) => {
    let s = 0;
    for (let d = 0; d < DIM; d++) s += M[i * DIM + d] * q[d];
    return { i, s: s / qn };
  });
  sims.sort((a, b) => b.s - a.s);
  const tokens = res.usage.total_tokens;
  return {
    ids: sims.slice(0, k).map(({ i }) => MEMORIES[i].id),
    latencyMs,
    costUsd: (tokens * PRICES.embeddings.in) / 1e6,
    inputTokens: tokens,
    outputTokens: 0,
  };
}

// ---------------- LLM judge: Claude Sonnet 5 reads the whole store ----------------

const LLM_SYSTEM = `You are the memory-retrieval step of a personal assistant. You will see the assistant's full long-term memory store about the user, then a situation the assistant is about to act on.

Return the ids of every memory the assistant should take into account before acting, including memories that matter only by implication: constraints, conflicts, risks, or people involved. Leave out memories that merely share a topic. Return an empty list if nothing matters.

<memory_store>
${MEMORIES.map((m) => `[${m.id}] ${m.text}`).join("\n")}
</memory_store>`;

const Relevant = z.object({ relevant_ids: z.array(z.string()) });
const VALID = new Set(MEMORIES.map((m) => m.id));

export async function runSonnet(apiKey: string, request: string): Promise<RunResult> {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const t0 = performance.now();
  let res;
  try {
    res = await client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 16000,
      system: [{ type: "text", text: LLM_SYSTEM }],
      messages: [{ role: "user", content: situation(request) }],
      output_config: { format: zodOutputFormat(Relevant) },
    });
  } catch (err) {
    throw describe(err, "Anthropic");
  }
  const latencyMs = performance.now() - t0;
  const ids = res.stop_reason === "refusal" || !res.parsed_output
    ? []
    : res.parsed_output.relevant_ids.filter((id) => VALID.has(id));
  const u = res.usage;
  const inputTokens = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  return {
    ids,
    latencyMs,
    costUsd: (inputTokens * PRICES.sonnet.in + u.output_tokens * PRICES.sonnet.out) / 1e6,
    inputTokens,
    outputTokens: u.output_tokens,
  };
}

// ---------------- Jev Recall: pointer mode, one request ----------------

const STATE_NOTE =
  "An assistant is about to act on the situation below. Each question is one memory from the " +
  "assistant's long-term store. Judge whether that memory matters for this situation, including " +
  "memories that matter only by implication (constraints, conflicts, risks, people involved).";
const mid = (i: number) => `M${String(i).padStart(3, "0")}`;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

export async function runJev(apiKey: string, request: string, threshold = 0.5): Promise<RunResult> {
  const body = {
    model: "jev-latest",
    state: {
      task: STATE_NOTE,
      situation: situation(request),
      memories: Object.fromEntries(MEMORIES.map((m, i) => [mid(i), m.text])),
    },
    questions: Object.fromEntries(
      MEMORIES.map((_, i) => [mid(i), { type: "noul", instructions: `Does memory ${mid(i)} matter for the situation?` }]),
    ),
  };
  const t0 = performance.now();
  let data: { answers?: Record<string, { noul?: number }>; usage?: { input_tokens?: number; output_tokens?: number } } = {};
  for (let attempt = 0; ; attempt++) {
    const r = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (r?.ok) {
      data = await r.json();
      break;
    }
    const status = r?.status ?? 502;
    if (!RETRYABLE.has(status) || attempt >= 2) throw describe({ status }, "TypeSafe");
    await new Promise((res) => setTimeout(res, 400 * 2 ** attempt));
  }
  const latencyMs = performance.now() - t0;
  const scores: Record<string, number> = {};
  MEMORIES.forEach((m, i) => {
    const p = data.answers?.[mid(i)]?.noul;
    if (typeof p === "number" && p >= threshold) scores[m.id] = p;
  });
  const ids = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
  const inputTokens = data.usage?.input_tokens ?? 0;
  return {
    ids,
    scores,
    latencyMs,
    costUsd: (inputTokens * PRICES.jev.in) / 1e6,
    inputTokens,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}
