# Jev Recall

**Retrieve by relevance, not resemblance.**

Give it a situation and a list of memories. It returns only the memories that matter,
judged by TypeSafe's Jev model, one calibrated yes/no per memory, all in one request.

```python
from jev_recall import Recall

recall = Recall()  # reads TYPESAFE_API_KEY
result = recall.filter(
    "Book a table for Dad's 70th birthday dinner on Saturday, Oct 3. 6 of us.",
    memories,             # list[str] or list[Memory] or list[{"id", "text"}]
    threshold=0.5,        # calibrated probability; no top-k guessing
)
result.texts        # the relevant memories, best first (can be empty)
result.all_scores   # every memory with its probability
result.cost_usd, result.latency_s
```

Memories go into the request's state once, tagged with short ids, and each gets a tiny
yes/no question that points at its id (`mode="pointer"`, the default). Stores too big for
one request are split and sent concurrently. `afilter` is the async version.

Other modes: `"inline"` puts each memory's text in its own question, and `"shortlist"` ranks
every memory with one multiple-choice question and then verifies the top 15.

## Demo site

`web/` is a Next.js demo that races OpenAI embeddings, Claude Sonnet 5 and Jev Recall on
personal-assistant requests. It replays recorded runs by default, and visitors can run it
live with their own API keys. See [web/README.md](web/README.md).

## Benchmark

`bench/` holds one assistant's memory store (238 memories) and 18 requests where the
memory that matters doesn't look like the request: a quiet-period rule when drafting a
LinkedIn post, a stolen card when paying a bill, a pregnancy when booking a dive trip.

```bash
cp .env.example .env   # add TYPESAFE_API_KEY and ANTHROPIC_API_KEY
uv run --group bench python bench/run.py --systems bm25,dense,dense+rerank,openai
uv run --group bench python bench/run.py --systems jev-inline,jev-pointer,jev-shortlist
uv run --group bench python bench/run.py --systems llm:claude-haiku-4-5,llm:claude-sonnet-5,llm:claude-opus-5
```

Results land in `bench/results/`. Run on 2026-09-19 with `jev-1.13.0`:

| System | Requests passed | Key memories found | Cost per request | Latency |
|---|---|---|---|---|
| Keyword search (BM25), top 5 | 1/18 | 2/20 | local | <0.01s |
| bge-large embeddings, top 5 | 3/18 | 4/20 | local | 0.06s |
| bge-large + bge-reranker, top 5 | 1/18 | 1/20 | local | 1.2s |
| OpenAI text-embedding-3-large, top 5 | 3/18 | 4/20 | <$0.00001 | 0.4s |
| **Jev Recall, pointer mode** | **17/18** | **19/20** | **$0.00044** | **0.35s** |
| Claude Haiku 4.5 | 14/18 | 15/20 | $0.0055 | 1.4s |
| Claude Sonnet 5 | 17/18 | 19/20 | $0.020 | 7.6s |
| Claude Opus 5 | 18/18 | 20/20 | $0.049 | 7.6s |

Claude costs are without prompt caching. With the memory store cached, Sonnet 5 costs
$0.0085 and Opus 5 costs $0.019 per request.

## License

MIT. The memories in `bench/data` describe a fictional person.
