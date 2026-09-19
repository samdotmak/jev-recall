import json

import httpx
import pytest

from jev_recall import Memory, Recall, RecallError


def make_transport(score_fn, fail_first=0, calls=None):
    state = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        state["n"] += 1
        body = json.loads(request.content)
        if calls is not None:
            calls.append(body)
        if state["n"] <= fail_first:
            return httpx.Response(429, json={"error": "slow down"})
        assert request.headers["authorization"] == "Bearer k"
        mem = body["state"].get("memories", {}) if isinstance(body["state"], dict) else {}
        resolve = lambda text: " ".join([text] + [v for k, v in mem.items() if k in text])
        answers = {}
        for qid, q in body["questions"].items():
            if q["type"] == "choice":
                raw = {k: score_fn(mem[k]) for k in q["criteria"]}
                tot = sum(raw.values()) or 1
                answers[qid] = {"type": "choice", "probabilities": {k: v / tot for k, v in raw.items()}}
            else:
                answers[qid] = {"type": "noul", "noul": score_fn(resolve(q["instructions"]))}
        return httpx.Response(200, json={"model": "jev", "answers": answers, "usage": {"input_tokens": 1000, "output_tokens": 0}})

    return httpx.MockTransport(handler)


@pytest.mark.parametrize("mode", ["inline", "pointer", "shortlist"])
def test_filters_and_sorts(mode):
    t = make_transport(lambda s: 0.9 if "stent" in s else (0.6 if "wheelchair" in s else 0.1))
    r = Recall(api_key="k", transport=t, mode=mode, shortlist_size=2)
    res = r.filter("Book Dad's birthday dinner", ["likes jazz", "Dad has a stent", "Mom uses a wheelchair"])
    assert res.texts == ["Dad has a stent", "Mom uses a wheelchair"]
    assert res.ids == ["1", "2"]
    assert len(res.all_scores) == 3
    assert res.cost_usd == pytest.approx(res.requests * 1000 * 0.042 / 1e6)


def test_threshold_and_top_k():
    t = make_transport(lambda s: 0.7)
    r = Recall(api_key="k", transport=t)
    assert len(r.filter("x", ["a", "b"], threshold=0.8)) == 0
    assert len(r.filter("x", ["a", "b", "c"], top_k=2)) == 2


def test_shards_large_memory_sets():
    calls = []
    t = make_transport(lambda s: 0.1, calls=calls)
    r = Recall(api_key="k", transport=t, max_request_tokens=2_000, mode="inline")
    mems = [Memory(text="memory number %d " % i * 5, id=f"x{i}") for i in range(200)]
    res = r.filter("ctx", mems)
    assert res.requests == len(calls) > 1
    assert sum(len(c["questions"]) for c in calls) == 200
    assert all(c["state"]["situation"] == "ctx" for c in calls)


def test_retries_on_429():
    t = make_transport(lambda s: 0.9, fail_first=2)
    r = Recall(api_key="k", transport=t)
    assert len(r.filter("x", ["a"])) == 1


def test_non_retryable_error():
    t = httpx.MockTransport(lambda req: httpx.Response(422, json={"detail": "bad"}))
    with pytest.raises(RecallError, match="422"):
        Recall(api_key="k", transport=t).filter("x", ["a"])


def test_context_too_large():
    r = Recall(api_key="k", transport=make_transport(lambda s: 0.1))
    with pytest.raises(RecallError, match="Shorten"):
        r.filter("x" * 200_000, ["a"])


def test_empty():
    assert len(Recall(api_key="k").filter("x", [])) == 0


def test_pointer_puts_memories_in_state_once():
    calls = []
    r = Recall(api_key="k", transport=make_transport(lambda s: 0.1, calls=calls))
    r.filter("ctx", ["alpha", "beta"])
    (body,) = calls
    assert body["state"]["memories"] == {"M000": "alpha", "M001": "beta"}
    assert all("alpha" not in q["instructions"] for q in body["questions"].values())


def test_shortlist_ranks_then_verifies_top_n():
    calls = []
    t = make_transport(lambda s: 0.9 if "hit" in s else 0.01, calls=calls)
    r = Recall(api_key="k", transport=t, mode="shortlist", shortlist_size=3)
    res = r.filter("ctx", [f"miss {i}" for i in range(300)] + ["hit"])
    assert res.texts == ["hit"]
    choice_calls = [c for c in calls if any(q["type"] == "choice" for q in c["questions"].values())]
    assert len(choice_calls) == 2  # 301 memories > 255 options per Choice
    verify = [c for c in calls if c not in choice_calls]
    assert sum(len(c["questions"]) for c in verify) == 3
