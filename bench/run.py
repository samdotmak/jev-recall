"""Benchmark: which memories does each retrieval system surface for a request?

Systems
  bm25            keyword search, top-k
  dense           bge-large-en-v1.5 embeddings, top-k                       (typical RAG)
  dense+rerank    dense top-30 -> bge-reranker-base cross-encoder, top-k   (strong RAG)
  jev             jev_recall.Recall, calibrated threshold (no k)
  llm:<model>     Claude reads the whole store, returns relevant ids

Usage
  uv run --group bench python bench/run.py --systems bm25,dense,dense+rerank
  uv run --group bench python bench/run.py --systems jev,llm:claude-opus-5 --only belize_dive
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "src"))

_env = HERE.parent / ".env"  # KEY=value lines; real env vars win
if _env.exists():
    for _l in _env.read_text().splitlines():
        if "=" in _l and not _l.lstrip().startswith("#"):
            _k, _v = _l.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

# USD per million tokens (Anthropic first-party list prices; Jev input only, output free)
PRICES = {
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-sonnet-5": (2.00, 10.00),
    "claude-opus-5": (5.00, 25.00),
    "claude-fable-5-1": (10.00, 50.00),
}


def load_data():
    mems = []
    for line in (HERE / "data/memories.txt").read_text().splitlines():
        if "|" in line and not line.startswith("#"):
            mid, text = line.split("|", 1)
            mems.append({"id": mid.strip(), "text": text.strip()})
    spec = json.loads((HERE / "data/scenarios.json").read_text())
    return mems, spec["today"], spec["scenarios"]


def situation(today: str, request: str) -> str:
    return f"Today is {today}.\nUser's request to the assistant: {request}"


# ---------------- systems ----------------

class BM25:
    name = "bm25"

    def __init__(self, mems, k):
        from rank_bm25 import BM25Okapi
        import re
        self.tok = lambda s: re.findall(r"[a-z0-9]+", s.lower())
        self.mems, self.k = mems, k
        self.index = BM25Okapi([self.tok(m["text"]) for m in mems])

    def run(self, today, request):
        t0 = time.perf_counter()
        scores = self.index.get_scores(self.tok(request))
        order = sorted(range(len(self.mems)), key=lambda i: -scores[i])[: self.k]
        return [self.mems[i]["id"] for i in order], {"latency_s": time.perf_counter() - t0, "cost_usd": 0.0}


class Dense:
    name = "dense"

    def __init__(self, mems, k, rerank=False, pool=30):
        import numpy as np
        from fastembed import TextEmbedding
        self.np, self.mems, self.k, self.pool = np, mems, k, pool
        self.emb = TextEmbedding("BAAI/bge-large-en-v1.5")
        self.M = np.array(list(self.emb.passage_embed([m["text"] for m in mems])))
        self.M /= np.linalg.norm(self.M, axis=1, keepdims=True)
        self.rr = None
        if rerank:
            from fastembed.rerank.cross_encoder import TextCrossEncoder
            self.rr = TextCrossEncoder("BAAI/bge-reranker-base")
            self.name = "dense+rerank"

    def run(self, today, request):
        np = self.np
        t0 = time.perf_counter()
        q = np.array(list(self.emb.query_embed([request])))[0]
        q /= np.linalg.norm(q)
        sims = self.M @ q
        order = list(np.argsort(-sims))
        if self.rr is None:
            top = order[: self.k]
        else:
            cand = order[: self.pool]
            rs = list(self.rr.rerank(request, [self.mems[i]["text"] for i in cand]))
            top = [cand[j] for j in sorted(range(len(cand)), key=lambda j: -rs[j])][: self.k]
        return [self.mems[i]["id"] for i in top], {"latency_s": time.perf_counter() - t0, "cost_usd": 0.0}


JEV_VARIANTS = {
    "jev-inline": {"mode": "inline"},        # memory text inside each question
    "jev-pointer": {"mode": "pointer"},      # memories in state once; each question names an id
    "jev-shortlist": {"mode": "shortlist"},  # one Choice ranks all ids, then top 15 verified inline
}


class OpenAIEmbed:
    """text-embedding-3-large, cosine top-k. Memory vectors are cached in bench/data/."""
    name = "openai"
    MODEL, PRICE = "text-embedding-3-large", 0.13  # USD per million tokens

    def __init__(self, mems, k):
        import numpy as np
        from openai import OpenAI
        self.np, self.mems, self.k, self.client = np, mems, k, OpenAI()
        cache = HERE / "data/openai_embeddings.json"
        texts = [m["text"] for m in mems]
        data = json.loads(cache.read_text()) if cache.exists() else {}
        if data.get("model") != self.MODEL or data.get("texts") != texts:
            r = self.client.embeddings.create(model=self.MODEL, input=texts)
            data = {"model": self.MODEL, "texts": texts, "vectors": [d.embedding for d in r.data]}
            cache.write_text(json.dumps(data))
        self.M = np.array(data["vectors"])
        self.M /= np.linalg.norm(self.M, axis=1, keepdims=True)

    def run(self, today, request):
        np = self.np
        t0 = time.perf_counter()
        r = self.client.embeddings.create(model=self.MODEL, input=[request])
        q = np.array(r.data[0].embedding)
        q /= np.linalg.norm(q)
        top = np.argsort(-(self.M @ q))[: self.k]
        return [self.mems[i]["id"] for i in top], {"latency_s": time.perf_counter() - t0,
                                                   "cost_usd": r.usage.total_tokens * self.PRICE / 1e6}


class Jev:
    def __init__(self, mems, threshold, variant="jev-pointer"):
        from jev_recall import Memory, Recall
        self.recall = Recall(threshold=threshold, **JEV_VARIANTS[variant])
        self.mems = [Memory(text=m["text"], id=m["id"]) for m in mems]
        self.name = variant

    def run(self, today, request):
        r = self.recall.filter(situation(today, request), self.mems)
        scores = {h.memory.id: round(h.score, 3) for h in r.all_scores}
        return r.ids, {"latency_s": r.latency_s, "cost_usd": r.cost_usd, "input_tokens": r.input_tokens,
                       "requests": r.requests, "scores": scores}


LLM_SYSTEM = """You are the memory-retrieval step of a personal assistant. You will see the assistant's full long-term memory store about the user, then a situation the assistant is about to act on.

Return the ids of every memory the assistant should take into account before acting, including memories that matter only by implication: constraints, conflicts, risks, or people involved. Leave out memories that merely share a topic. Return an empty list if nothing matters.

<memory_store>
{store}
</memory_store>"""


class LLM:
    def __init__(self, mems, model, effort=None):
        import anthropic
        from pydantic import BaseModel

        class Out(BaseModel):
            relevant_ids: list[str]

        self.Out, self.model, self.effort = Out, model, effort
        self.client = anthropic.Anthropic()
        self.valid = {m["id"] for m in mems}
        store = "\n".join(f"[{m['id']}] {m['text']}" for m in mems)
        self.system = [{"type": "text", "text": LLM_SYSTEM.format(store=store), "cache_control": {"type": "ephemeral"}}]
        self.name = f"llm:{model}" + (f"@{effort}" if effort else "")

    def run(self, today, request):
        kw = {"output_config": {"effort": self.effort}} if self.effort else {}
        t0 = time.perf_counter()
        resp = self.client.messages.parse(
            model=self.model, max_tokens=16000, system=self.system,
            messages=[{"role": "user", "content": situation(today, request)}],
            output_format=self.Out, **kw,
        )
        lat = time.perf_counter() - t0
        u = resp.usage
        pin, pout = PRICES[self.model]
        cw = u.cache_creation_input_tokens or 0
        cr = u.cache_read_input_tokens or 0
        actual = (u.input_tokens * pin + cw * pin * 1.25 + cr * pin * 0.1 + u.output_tokens * pout) / 1e6
        cold = ((u.input_tokens + cw + cr) * pin + u.output_tokens * pout) / 1e6
        if resp.stop_reason == "refusal" or resp.parsed_output is None:
            ids = []
        else:
            ids = [i for i in resp.parsed_output.relevant_ids if i in self.valid]
        return ids, {"latency_s": lat, "cost_usd": cold, "cost_cached_usd": actual,
                     "input_tokens": u.input_tokens + cw + cr, "output_tokens": u.output_tokens,
                     "stop_reason": resp.stop_reason}


# ---------------- scoring ----------------

def grade(sc, got):
    req, ok = set(sc["required"]), set(sc["required"]) | set(sc["acceptable"])
    found = [i for i in sc["required"] if i in got]
    noise = [i for i in got if i not in ok]
    passed = len(found) == len(req) if req else not noise
    return {"found": found, "missed": [i for i in sc["required"] if i not in got], "noise": noise,
            "returned": len(got), "pass": passed}


def build(name, mems, args):
    if name == "bm25":
        return BM25(mems, args.k)
    if name == "dense":
        return Dense(mems, args.k)
    if name == "dense+rerank":
        return Dense(mems, args.k, rerank=True)
    if name == "openai":
        return OpenAIEmbed(mems, args.k)
    if name in JEV_VARIANTS:
        return Jev(mems, args.threshold, name)
    if name.startswith("llm:"):
        model, _, effort = name[4:].partition("@")
        return LLM(mems, model, effort or None)
    raise SystemExit(f"unknown system {name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--systems", default="bm25,dense,dense+rerank")
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--only", default="", help="comma-separated scenario ids")
    args = ap.parse_args()

    from rich.console import Console
    from rich.table import Table
    con = Console()

    mems, today, scenarios = load_data()
    if args.only:
        keep = set(args.only.split(","))
        scenarios = [s for s in scenarios if s["id"] in keep]
    text = {m["id"]: m["text"] for m in mems}

    out = {"when": datetime.now().isoformat(timespec="seconds"), "k": args.k, "threshold": args.threshold,
           "n_memories": len(mems), "results": {}}
    for sysname in args.systems.split(","):
        con.rule(f"[bold]{sysname}")
        system = build(sysname, mems, args)
        rows = []
        for sc in scenarios:
            try:
                got, meta = system.run(today, sc["request"])
            except Exception as e:  # keep going; record the failure
                con.print(f"[red]{sc['id']}: {e}")
                got, meta = [], {"error": str(e)}
            g = grade(sc, got)
            rows.append({"scenario": sc["id"], "got": got, **g, **meta})
            mark = "[green]PASS" if g["pass"] else "[red]FAIL"
            con.print(f"{mark}[/] {sc['id']:<22} missed={g['missed']} noise={len(g['noise'])} "
                      f"lat={meta.get('latency_s', 0):.2f}s cost=${meta.get('cost_usd', 0):.5f}")
        out["results"][sysname] = rows

    # summary
    t = Table(title=f"{len(mems)} memories, {len(scenarios)} requests")
    for c in ["system", "pass", "required found", "avg noise", "avg returned", "avg latency", "avg cost", "avg cost (cached)"]:
        t.add_column(c, justify="right")
    for sysname, rows in out["results"].items():
        n = len(rows)
        req_total = sum(len(s["required"]) for s in scenarios)
        found = sum(len(r["found"]) for r in rows)
        avg = lambda k: sum(r.get(k, 0) or 0 for r in rows) / n
        cached = avg("cost_cached_usd") if any("cost_cached_usd" in r for r in rows) else avg("cost_usd")
        t.add_row(sysname, f"{sum(r['pass'] for r in rows)}/{n}", f"{found}/{req_total}",
                  f"{sum(len(r['noise']) for r in rows)/n:.1f}",
                  f"{avg('returned'):.1f}", f"{avg('latency_s'):.2f}s", f"${avg('cost_usd'):.5f}", f"${cached:.5f}")
    con.print(t)

    res_dir = HERE / "results"
    res_dir.mkdir(exist_ok=True)
    path = res_dir / f"{datetime.now():%Y%m%d-%H%M%S}-{'_'.join(s.replace(':', '-') for s in out['results'])}.json"
    path.write_text(json.dumps(out, indent=2))
    con.print(f"saved {path.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main()
