# Jev Recall demo

A single-page demo: an assistant knows 238 things about your life, and three systems pick which
ones it should read before acting. Semantic search (OpenAI embeddings), an LLM judge
(Claude Sonnet 5) and Jev Recall run side by side.

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

- `/` plays recorded live runs of four presets. Press **1–4** to switch, **Space** to run.
- `/?present=1` hides the controls and autoplays once, for screen recordings.
- **Run live with your keys** takes your own TypeSafe, Anthropic and OpenAI keys. They stay in
  your browser's local storage and are sent per request to `app/api/run`, which forwards them to
  the provider and never stores or logs them. The deployment has no keys of its own.

## Data

- `scripts/export-data.ts` copies the memories from `../bench/data` and packs the precomputed
  OpenAI memory embeddings into `data/generated/`.
- `scripts/record.ts` re-records `data/replays.json` using keys from `../.env`.
- `data/presets.ts` holds the four requests and their key memories.
