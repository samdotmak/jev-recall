# Jev Recall

**Retrieve by relevance, not resemblance.** 

Jev Recall gives you LLM re-ranker quality retreival at semantic search prices and speed 

Given a user query and a pile of memories, jev recalls returns the most relevant memories, judged by
[TypeSafe's Jev](https://typesafe.ai) model, one calibrated yes/no per memory, in a single request.

![Jev Recall: three methods search the same 238 memories. Semantic search misses a guest's nut allergy; Claude Sonnet 5 and Jev Recall both find it, Jev in 0.34s for $0.00044.](docs/demo.gif)

**[Try the live demo →](https://jev-recall.vercel.app)** · replays real runs, or runs live with your own API keys.

## Why?

With LLMs, writing memories is easy. Knowing which ones to *retrieve* is the hard part.

Today you get two options that don't work because:

- **Keyword search** works only if you already know what you're looking for.
- **Semantic search** works only if the memory that matters happens to look like the request.

That second assumption breaks constantly, because the memories that change an answer are usually
the ones phrased nothing like the question. "Order the almond tart for Saturday's dinner party"
looks nothing like "Leo has a severe tree-nut allergy," so embeddings return other pastry memories
and the assistant orders the tart.

An LLM used as a re-ranker does catch those. It reads everything and reasons about what matters.
But then you pay LLM prices and LLM latency on every single turn, so nobody runs it on every turn.

Jev is a classifier that makes that same include-or-not decision at LLM quality, for a fraction of
the cost and time. That makes it cheap enough to judge *every* memory on *every* turn.

## How it works

Every memory goes into one request's shared `state`, tagged with a short id. Each memory gets a tiny
yes/no question pointing at its id, and Jev returns a calibrated probability for each one. Because the
probabilities are calibrated, you keep everything above a threshold instead of guessing at a top-k,
and nothing is returned when nothing applies.

```python
from jev_recall import Recall

recall = Recall()  # reads TYPESAFE_API_KEY
result = recall.filter(
    "Order the almond frangipane tart from Tartine for Saturday's dinner party.",
    memories,          # list[str] | list[Memory] | list[{"id", "text"}]
    threshold=0.5,
)
result.texts        # the memories that matter, best first (can be empty)
result.all_scores   # every memory with its probability
result.cost_usd, result.latency_s
```

Large stores are split across requests and sent concurrently. `afilter` is the async version.
Two other modes are available: `inline` puts each memory's text in its own question, and `shortlist`
ranks everything with one multiple-choice question and then verifies the top candidates.

## Benchmark

`bench/` holds one assistant's memory store of 238 fictional memories and 18 requests where the
memory that matters doesn't look like the request: a stolen card when paying a bill, a pregnancy
when booking a dive trip, a guest's nut allergy when ordering dessert.

```bash
uv run --group bench python bench/run.py --systems bm25,dense,dense+rerank,openai
uv run --group bench python bench/run.py --systems jev-inline,jev-pointer,jev-shortlist
uv run --group bench python bench/run.py --systems llm:claude-haiku-4-5,llm:claude-sonnet-5,llm:claude-opus-5
```

Run on 2026-09-19 with `jev-1.13.0`. "Key memories" counts the 20 memories across those requests that
an assistant had to know about before acting.

| System | Requests passed | Key memories found | Cost per request | Latency |
|---|---|---|---|---|
| Keyword search (BM25), top 5 | 1/18 | 2/20 | local | <0.01s |
| bge-large embeddings, top 5 | 3/18 | 4/20 | local | 0.06s |
| bge-large + bge-reranker, top 5 | 1/18 | 1/20 | local | 1.2s |
| OpenAI text-embedding-3-large, top 5 | 3/18 | 4/20 | $0.000002 | 0.4s |
| **Jev Recall (pointer mode)** | **17/18** | **19/20** | **$0.00044** | **0.35s** |
| Claude Haiku 4.5 | 14/18 | 15/20 | $0.0055 | 1.4s |
| Claude Sonnet 5 | 17/18 | 19/20 | $0.020 | 7.6s |
| Claude Opus 5 | 18/18 | 20/20 | $0.049 | 7.6s |

Jev matches Sonnet 5 and is within one memory of Opus 5, at roughly 1/46 of Sonnet's cost and 20x its
speed. Scores move by less than 0.01 between runs, and the result holds at any threshold from 0.3 to 0.5.

Two caveats worth stating plainly. Claude's costs above are without prompt caching; with the memory
store cached, Sonnet 5 costs $0.0085 and Opus 5 costs $0.019 per request, so the cost gap narrows to
about 19x and 43x. And Jev's one miss is a memory that needs outside knowledge to connect ("Sam is on
an H-1B visa" rules out paid freelance work). Sonnet missed that one too.

## The demo

`web/` is the Next.js site behind [jev-recall.vercel.app](https://jev-recall.vercel.app). Three methods
race across one shared grid of all 238 memories: OpenAI embeddings, Claude Sonnet 5 and Jev Recall.
Each scanner settles on what its method picked, and a method that misses the memory that mattered says so.

```bash
cd web
pnpm install
pnpm dev
```

It replays recorded real runs by default. **Run live with your keys** accepts your own TypeSafe,
Anthropic and OpenAI keys; they stay in your browser's local storage and are passed straight through
to the provider by the site's API route, which stores and logs nothing. The deployment holds no keys
of its own. `/?present=1` autoplays once with the controls hidden, for screen recordings.

## Repo layout

| Path | What's in it |
|---|---|
| `src/jev_recall/` | the library: request building, sharding, retries, scoring |
| `tests/` | unit tests against a mocked Jev API (`uv run pytest`) |
| `bench/data/` | the 238 fictional memories and the 18 labeled requests |
| `bench/run.py` | the benchmark harness and every baseline |
| `web/` | the demo site |

## Setup

```bash
uv sync                       # library + dev deps
uv sync --group bench         # baselines: fastembed, rank-bm25, anthropic, openai
cp .env.example .env          # TYPESAFE_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY
```

A TypeSafe key is all the library itself needs. The other two are only for benchmark baselines and for
recording the demo's replays.

## License

MIT. The memories in `bench/data` describe a fictional person; any resemblance to real people is coincidental.
