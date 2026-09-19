"""Jev Recall: give it a situation and a pile of memories, get back only the ones that matter.

Each memory becomes one yes/no ("noul") question in a single TypeSafe System One request.
The situation is sent once as the shared `state`, so scoring N memories costs roughly
the memories' own tokens plus one copy of the context.
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator, Sequence

import httpx

DEFAULT_BASE_URL = "https://api.typesafe.ai"
DEFAULT_MODEL = "jev-latest"
PRICE_PER_MTOK = 0.042  # USD per million input tokens; output is free

DEFAULT_INSTRUCTIONS = "Memory: {memory}\nDoes this memory matter for the situation?"
POINTER_INSTRUCTIONS = "Does memory {mid} matter for the situation?"
SHORTLIST_INSTRUCTIONS = "Which memory matters most for the situation?"
GATE_INSTRUCTIONS = "Does any memory in the store matter for the situation?"
MODES = ("inline", "pointer", "shortlist")
DEFAULT_CRITERIA = {
    "true": "Knowing this memory would change what the assistant does, avoids, checks, or mentions.",
    "false": "The memory is unrelated or only shares a topic; the situation is handled the same without it.",
}
STATE_NOTE = (
    "An assistant is about to act on the situation below. Each question is one memory from the "
    "assistant's long-term store. Judge whether that memory matters for this situation, including "
    "memories that matter only by implication (constraints, conflicts, risks, people involved)."
)

# Documented limits: 64k tokens per request, 32k for state + the longest question;
# a Choice question takes at most 255 options.
MAX_REQUEST_TOKENS = 60_000
MAX_STATE_PLUS_QUESTION_TOKENS = 30_000
MAX_STATE_MEMORY_TOKENS = 24_000  # memories placed in state (pointer/shortlist modes), per request
MAX_CHOICE_OPTIONS = 255


@dataclass
class Memory:
    text: str
    id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class Hit:
    memory: Memory
    score: float  # probability in [0, 1] that the memory is relevant

    @property
    def text(self) -> str:
        return self.memory.text


@dataclass
class RecallResult:
    hits: list[Hit]  # scores >= threshold, best first
    all_scores: list[Hit]  # every memory, in input order
    threshold: float
    input_tokens: int
    cost_usd: float
    latency_s: float
    requests: int

    def __iter__(self) -> Iterator[Hit]:
        return iter(self.hits)

    def __len__(self) -> int:
        return len(self.hits)

    @property
    def texts(self) -> list[str]:
        return [h.memory.text for h in self.hits]

    @property
    def ids(self) -> list[str | None]:
        return [h.memory.id for h in self.hits]


class RecallError(RuntimeError):
    pass


def _estimate_tokens(obj: Any) -> int:
    s = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
    return len(s) // 3 + 8  # deliberately pessimistic


def _mid(i: int) -> str:
    return f"M{i:03d}"


def _as_memories(memories: Iterable[str | Memory | dict]) -> list[Memory]:
    out = []
    for i, m in enumerate(memories):
        if isinstance(m, Memory):
            out.append(m)
        elif isinstance(m, str):
            out.append(Memory(text=m, id=str(i)))
        elif isinstance(m, dict):
            out.append(Memory(text=m["text"], id=m.get("id", str(i)), metadata=m.get("metadata", {})))
        else:
            raise TypeError(f"memory must be str, Memory or dict, got {type(m)!r}")
    return out


class Recall:
    """Filter memories down to the ones relevant to a situation.

    >>> recall = Recall()  # reads TYPESAFE_API_KEY
    >>> result = recall.filter("Book dinner for Dad's birthday", memories)
    >>> result.texts
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        model: str = DEFAULT_MODEL,
        mode: str = "pointer",
        threshold: float = 0.5,
        shortlist_size: int = 15,
        instructions: str = DEFAULT_INSTRUCTIONS,
        criteria: dict[str, str] | None = None,
        state_note: str | None = STATE_NOTE,
        max_request_tokens: int = MAX_REQUEST_TOKENS,
        concurrency: int = 8,
        timeout: float = 30.0,
        max_retries: int = 4,
        base_url: str = DEFAULT_BASE_URL,
        price_per_mtok: float = PRICE_PER_MTOK,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("TYPESAFE_API_KEY")
        if not self.api_key:
            raise RecallError("No API key: pass api_key= or set TYPESAFE_API_KEY")
        if "{memory}" not in instructions:
            raise ValueError("instructions must contain a {memory} placeholder")
        if mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}")
        self.model = model
        self.mode = mode
        self.shortlist_size = shortlist_size
        self.threshold = threshold
        self.instructions = instructions
        self.criteria = criteria
        self.state_note = state_note
        self.max_request_tokens = max_request_tokens
        self.concurrency = concurrency
        self.timeout = timeout
        self.max_retries = max_retries
        self.base_url = base_url.rstrip("/")
        self.price_per_mtok = price_per_mtok
        self._transport = transport

    # ---------- request building ----------

    def build_state(self, context: Any, extra: dict[str, Any] | None = None,
                    memories: dict[str, str] | None = None) -> dict[str, Any]:
        state: dict[str, Any] = {}
        if self.state_note:
            state["task"] = self.state_note
        state["situation"] = context
        if extra:
            state.update(extra)
        if memories is not None:
            state["memories"] = memories
        return state

    def build_question(self, memory: Memory) -> dict[str, Any]:
        """Inline question: the memory text travels inside the question."""
        q: dict[str, Any] = {"type": "noul", "instructions": self.instructions.format(memory=memory.text)}
        if self.criteria:
            q["criteria"] = self.criteria
        return q

    def _pointer_question(self, mid: str) -> dict[str, Any]:
        q: dict[str, Any] = {"type": "noul", "instructions": POINTER_INSTRUCTIONS.format(mid=mid)}
        if self.criteria:
            q["criteria"] = self.criteria
        return q

    def plan_requests(self, state: dict, memories: Sequence[Memory]) -> list[list[int]]:
        """Inline mode: greedily pack memory indices into requests that fit the token limits."""
        state_tokens = _estimate_tokens(state)
        batches: list[list[int]] = []
        cur: list[int] = []
        cur_tokens = state_tokens
        for i, m in enumerate(memories):
            qt = _estimate_tokens(self.build_question(m))
            if state_tokens + qt > MAX_STATE_PLUS_QUESTION_TOKENS:
                raise RecallError(
                    f"context + memory {m.id!r} is ~{state_tokens + qt} tokens; "
                    f"limit is {MAX_STATE_PLUS_QUESTION_TOKENS}. Shorten the context."
                )
            if cur and cur_tokens + qt > self.max_request_tokens:
                batches.append(cur)
                cur, cur_tokens = [], state_tokens
            cur.append(i)
            cur_tokens += qt
        if cur:
            batches.append(cur)
        return batches

    def plan_shards(self, base_state: dict, memories: Sequence[Memory], max_items: int | None = None) -> list[list[int]]:
        """Pointer/shortlist modes: split memories into shards whose texts fit in one state."""
        base = _estimate_tokens(base_state)
        if base > MAX_STATE_PLUS_QUESTION_TOKENS - 2_000:
            raise RecallError(f"context is ~{base} tokens; limit is ~{MAX_STATE_PLUS_QUESTION_TOKENS - 2_000}. Shorten the context.")
        budget = min(MAX_STATE_MEMORY_TOKENS, MAX_STATE_PLUS_QUESTION_TOKENS - 1_000 - base)
        shards: list[list[int]] = []
        cur: list[int] = []
        cur_tokens = 0
        for i, m in enumerate(memories):
            t = _estimate_tokens(m.text) + 4
            if t > budget:
                raise RecallError(f"memory {m.id!r} is too long (~{t} tokens) to fit next to this context")
            if cur and (cur_tokens + t > budget or (max_items and len(cur) >= max_items)):
                shards.append(cur)
                cur, cur_tokens = [], 0
            cur.append(i)
            cur_tokens += t
        if cur:
            shards.append(cur)
        return shards

    # ---------- HTTP ----------

    async def _post(self, client: httpx.AsyncClient, body: dict) -> dict:
        delay = 0.5
        for attempt in range(self.max_retries + 1):
            try:
                r = await client.post(f"{self.base_url}/v1/systemone", json=body)
            except httpx.TransportError as e:
                if attempt == self.max_retries:
                    raise RecallError(f"network error: {e}") from e
            else:
                if r.status_code == 200:
                    return r.json()
                if r.status_code not in (408, 429, 500, 502, 503, 504, 529) or attempt == self.max_retries:
                    raise RecallError(f"TypeSafe API {r.status_code}: {r.text[:500]}")
                ra = r.headers.get("retry-after")
                if ra and ra.replace(".", "", 1).isdigit():
                    delay = max(delay, float(ra))
            await asyncio.sleep(delay + random.random() * 0.25)
            delay = min(delay * 2, 16)
        raise AssertionError("unreachable")

    # ---------- public API ----------

    async def afilter(
        self,
        context: Any,
        memories: Iterable[str | Memory | dict],
        *,
        threshold: float | None = None,
        top_k: int | None = None,
        state_extra: dict[str, Any] | None = None,
        mode: str | None = None,
    ) -> RecallResult:
        mems = _as_memories(memories)
        thr = self.threshold if threshold is None else threshold
        mode = mode or self.mode
        if mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}")
        if not mems:
            return RecallResult([], [], thr, 0, 0.0, 0.0, 0)
        sem = asyncio.Semaphore(self.concurrency)
        headers = {"Authorization": f"Bearer {self.api_key}"}
        usage = {"tokens": 0, "requests": 0}
        scores = [0.0] * len(mems)
        t0 = time.perf_counter()

        async with httpx.AsyncClient(headers=headers, timeout=self.timeout, transport=self._transport) as client:

            async def ask(state: Any, questions: dict[str, dict]) -> dict:
                async with sem:
                    resp = await self._post(client, {"model": self.model, "state": state, "questions": questions})
                usage["tokens"] += int(resp.get("usage", {}).get("input_tokens", 0))
                usage["requests"] += 1
                return resp.get("answers", {})

            def noul(answers: dict, qid: str) -> float:
                a = answers.get(qid)
                if a is None or a.get("noul") is None:
                    raise RecallError(f"missing answer {qid!r}: {json.dumps(answers)[:300]}")
                return float(a["noul"])

            async def inline(indices: list[int]) -> None:
                state = self.build_state(context, state_extra)
                sub = [mems[i] for i in indices]

                async def run(batch: list[int]) -> None:
                    ans = await ask(state, {f"q{j}": self.build_question(sub[j]) for j in batch})
                    for j in batch:
                        scores[indices[j]] = noul(ans, f"q{j}")

                await asyncio.gather(*(run(b) for b in self.plan_requests(state, sub)))

            if mode == "inline":
                await inline(list(range(len(mems))))

            elif mode == "pointer":
                base = self.build_state(context, state_extra)

                async def run_shard(shard: list[int]) -> None:
                    ids = {i: _mid(i) for i in shard}
                    state = self.build_state(context, state_extra, {ids[i]: mems[i].text for i in shard})
                    ans = await ask(state, {ids[i]: self._pointer_question(ids[i]) for i in shard})
                    for i in shard:
                        scores[i] = noul(ans, ids[i])

                await asyncio.gather(*(run_shard(sh) for sh in self.plan_shards(base, mems)))

            else:  # shortlist: rank every memory with one Choice per shard, then verify the top few inline
                base = self.build_state(context, state_extra)
                ranked: list[tuple[float, int]] = []

                async def rank_shard(shard: list[int]) -> None:
                    ids = {i: _mid(i) for i in shard}
                    state = self.build_state(context, state_extra, {ids[i]: mems[i].text for i in shard})
                    ans = await ask(state, {
                        "rank": {"type": "choice", "instructions": SHORTLIST_INSTRUCTIONS,
                                 "criteria": {ids[i]: None for i in shard}},
                    })
                    probs = (ans.get("rank") or {}).get("probabilities") or {}
                    ranked.extend((float(probs.get(ids[i], 0.0)), i) for i in shard)

                await asyncio.gather(*(rank_shard(sh) for sh in self.plan_shards(base, mems, MAX_CHOICE_OPTIONS)))
                ranked.sort(reverse=True)
                await inline([i for _, i in ranked[: self.shortlist_size]])

        latency = time.perf_counter() - t0
        all_hits = [Hit(m, s) for m, s in zip(mems, scores)]
        hits = sorted((h for h in all_hits if h.score >= thr), key=lambda h: -h.score)
        if top_k is not None:
            hits = hits[:top_k]
        return RecallResult(
            hits=hits,
            all_scores=all_hits,
            threshold=thr,
            input_tokens=usage["tokens"],
            cost_usd=usage["tokens"] * self.price_per_mtok / 1e6,
            latency_s=latency,
            requests=usage["requests"],
        )

    def filter(self, context: Any, memories: Iterable[str | Memory | dict], **kw: Any) -> RecallResult:
        """Synchronous wrapper around `afilter` (safe to call from inside a running event loop)."""
        coro = self.afilter(context, memories, **kw)
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coro)
        box: dict[str, Any] = {}

        def worker() -> None:
            try:
                box["v"] = asyncio.run(coro)
            except BaseException as e:  # noqa: BLE001
                box["e"] = e

        t = threading.Thread(target=worker)
        t.start()
        t.join()
        if "e" in box:
            raise box["e"]
        return box["v"]
