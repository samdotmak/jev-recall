"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Preset } from "@/data/presets";
import { METHOD_COLOR } from "@/lib/format";
import { KEY_HEADERS, SYSTEMS, type Memory, type RunResult, type SystemId } from "@/lib/types";
import { KeysDialog, useKeys } from "./KeysDialog";
import { ResultCard, type CardState } from "./ResultCard";
import { ScanField, type Scan } from "./ScanField";
import { Stage } from "./Stage";

type Replays = Record<string, Record<SystemId, RunResult> & { recordedAt: string }>;
type Phase = "ready" | "typing" | "running" | "done";
type Cards = Record<SystemId, CardState>;

const IDLE: Cards = {
  embeddings: { status: "idle", elapsedMs: 0 },
  sonnet: { status: "idle", elapsedMs: 0 },
  jev: { status: "idle", elapsedMs: 0 },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// From the benchmark in bench/ (README): 238 memories, 18 requests, 20 key memories.
const BENCHMARK = {
  requests: 18,
  jev: "19/20",
  sonnet: "19/20",
  embeddings: "4/20",
  faster: "~22× faster",
  cost: "~1/46 the cost",
};

export function Demo({
  memories,
  presets,
  replays,
  present,
}: {
  memories: Memory[];
  presets: Preset[];
  replays: Replays;
  present: boolean;
}) {
  const memoryById = Object.fromEntries(memories.map((m) => [m.id, m]));
  const [preset, setPreset] = useState<Preset>(presets[0]);
  const [request, setRequest] = useState(presets[0].request);
  const [typed, setTyped] = useState(present ? 0 : presets[0].request.length);
  const [phase, setPhase] = useState<Phase>("ready");
  const [cards, setCards] = useState<Cards>(IDLE);
  const [clock, setClock] = useState(0);
  const [showKeys, setShowKeys] = useState(false);
  const [hoveredMemory, setHoveredMemory] = useState<string | null>(null);
  const keys = useKeys();
  const runId = useRef(0);

  const live = keys.jev !== "" && keys.sonnet !== "" && keys.embeddings !== "";
  const isPreset = request.trim() === preset.request;
  const keyIds = isPreset ? preset.keyIds : [];

  const run = useCallback(
    async (p: Preset, text: string, opts: { type: boolean }) => {
      const my = ++runId.current;
      const alive = () => runId.current === my;
      setCards(IDLE);
      setClock(0);
      if (opts.type) {
        setPhase("typing");
        setTyped(0);
        await sleep(700);
        for (let i = 1; i <= text.length; i++) {
          if (!alive()) return;
          setTyped(i);
          await sleep(30);
        }
        await sleep(700);
      }
      if (!alive()) return;
      setTyped(text.length);
      setPhase("running");

      const t0 = performance.now();
      const finished = new Set<SystemId>();
      let slowest = 0;
      const tick = () => {
        if (!alive()) return;
        const now = performance.now() - t0;
        if (finished.size < SYSTEMS.length) setClock(now);
        setCards((c) => {
          const next = { ...c };
          for (const s of SYSTEMS) if (next[s.id].status === "running") next[s.id] = { ...next[s.id], elapsedMs: now };
          return next;
        });
        if (finished.size < SYSTEMS.length) requestAnimationFrame(tick);
      };
      setCards({
        embeddings: { status: "running", elapsedMs: 0 },
        sonnet: { status: "running", elapsedMs: 0 },
        jev: { status: "running", elapsedMs: 0 },
      });
      requestAnimationFrame(tick);

      const finish = (id: SystemId, state: CardState) => {
        if (!alive()) return;
        finished.add(id);
        setCards((c) => ({ ...c, [id]: state }));
        slowest = Math.max(slowest, state.elapsedMs);
        if (finished.size === SYSTEMS.length) setClock(slowest);
      };

      await Promise.all(
        SYSTEMS.map(async ({ id }) => {
          if (live) {
            try {
              const r = await fetch("/api/run", {
                method: "POST",
                headers: { "Content-Type": "application/json", [KEY_HEADERS[id]]: keys[id] },
                body: JSON.stringify({ system: id, request: text }),
              });
              const body = await r.json();
              const elapsedMs = performance.now() - t0;
              if (!r.ok) finish(id, { status: "error", elapsedMs, error: body.error ?? "Request failed." });
              else finish(id, { status: "done", elapsedMs, result: body as RunResult });
            } catch {
              finish(id, { status: "error", elapsedMs: performance.now() - t0, error: "Network error." });
            }
          } else {
            const rec = replays[p.id]?.[id];
            if (!rec) return finish(id, { status: "error", elapsedMs: 0, error: "No recording for this request." });
            await sleep(rec.latencyMs);
            finish(id, { status: "done", elapsedMs: rec.latencyMs, result: rec });
          }
        }),
      );
      if (alive()) setPhase("done");
    },
    [live, keys, replays],
  );

  const choose = useCallback(
    (p: Preset, autoplay: boolean) => {
      runId.current++;
      setPreset(p);
      setRequest(p.request);
      setCards(IDLE);
      setClock(0);
      setPhase("ready");
      setTyped(p.request.length);
      if (autoplay) run(p, p.request, { type: present });
    },
    [run, present],
  );

  // Presentation mode autoplays once. Keyboard: Space runs, 1-4 pick presets.
  useEffect(() => {
    if (!present) return;
    const t = setTimeout(() => run(presets[0], presets[0].request, { type: true }), 900);
    return () => clearTimeout(t);
  }, [present, presets, run]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        run(preset, request, { type: present });
      }
      const n = Number(e.key);
      if (n >= 1 && n <= presets.length) choose(presets[n - 1], present);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, choose, preset, request, present, presets]);

  // The scan field's view of each method: what it picked and where its scanner settles.
  const scans = Object.fromEntries(
    SYSTEMS.map(({ id }) => {
      const c = cards[id];
      const picks = c.result?.ids ?? [];
      const target = picks.find((p) => keyIds.includes(p)) ?? picks[0];
      return [id, { status: c.status, elapsedMs: c.elapsedMs, picks, target } satisfies Scan];
    }),
  ) as Record<SystemId, Scan>;

  const done = phase === "done";
  const sonnetRun = cards.sonnet.result;
  const jevRun = cards.jev.result;
  const runStats =
    done && sonnetRun && jevRun && keyIds.length > 0
      ? {
          caption: `${keyIds.length === 1 ? "1 key memory" : `${keyIds.length} key memories`} to find`,
          found: Object.fromEntries(
            SYSTEMS.map(({ id }) => {
              const r = cards[id].result;
              const hit = r ? keyIds.filter((k) => r.ids.includes(k)).length : 0;
              return [id, `${hit}/${keyIds.length}`];
            }),
          ) as Record<SystemId, string>,
          faster: `${Math.round(cards.sonnet.elapsedMs / Math.max(cards.jev.elapsedMs, 1))}× faster`,
          cost: `1/${Math.round(sonnetRun.costUsd / Math.max(jevRun.costUsd, 1e-9))} the cost`,
        }
      : null;

  const headline =
    phase === "running" ? `Scanning ${memories.length} memories…` : phase === "done" ? `Scanned ${memories.length} memories` : `${memories.length} memories`;
  const editable = live && !present && phase !== "running" && phase !== "typing";

  return (
    <Stage>
      <div className="flex h-full flex-col px-10 pb-7 pt-8">
        {/* Headline + mode controls */}
        <div className="flex items-start justify-between gap-8">
          <div>
            <div className="mb-3 flex gap-[3px]">
              <span className="h-[5px] w-[22px] rounded-full bg-embeddings" />
              <span className="h-[5px] w-[22px] rounded-full bg-sonnet" />
              <span className="h-[5px] w-[22px] rounded-full bg-jev" />
              <span className="h-[5px] w-[9px] rounded-full bg-accent" />
            </div>
            <h1 className="text-[40px] font-medium leading-[1.08] tracking-[-0.01em] text-text">
              <span className="font-bold">Jev Recall</span> catches the memories semantic search{" "}
              <em className="underline decoration-accent decoration-[3px] underline-offset-[6px]">misses.</em>
            </h1>
            <p className="mt-2 text-[19px] leading-snug text-muted">
              Same answers as Claude Sonnet 5, at a fraction of the time and cost.
            </p>
          </div>
          {!present && (
            <div className="flex shrink-0 items-center gap-3 pt-2">
              <button
                onClick={() => setShowKeys(true)}
                className="label rounded-full border border-line bg-panel px-3.5 py-1.5 !text-text hover:bg-panel-2"
              >
                {live ? "Keys" : "Run live with your keys"}
              </button>
            </div>
          )}
        </div>

        {/* Preset nav */}
        {!present && (
          <div className="mt-6 border-b border-line pb-2.5">
            <div className="flex items-baseline gap-7">
              {presets.map((p) => {
                const active = p.id === preset.id && isPreset;
                return (
                  <button
                    key={p.id}
                    onClick={() => choose(p, false)}
                    className={`relative pb-2.5 text-[16px] transition ${active ? "text-text" : "text-muted hover:text-text"}`}
                  >
                    {p.label}
                    {active && <span className="absolute inset-x-0 -bottom-[1px] h-[2px] rounded-full bg-accent" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Request */}
        <div className="mt-5 flex items-center gap-4">
          <div className="flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-xl border border-line bg-panel text-accent">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-label="Your request" role="img">
              <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4.8 20c.6-3.8 3.6-6 7.2-6s6.6 2.2 7.2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex h-[62px] flex-1 items-center rounded-xl border border-line bg-panel px-6">
            {editable ? (
              <input
                value={request}
                maxLength={500}
                onChange={(ev) => {
                  setRequest(ev.target.value);
                  setTyped(ev.target.value.length);
                  setCards(IDLE);
                  setPhase("ready");
                }}
                onKeyDown={(ev) => ev.key === "Enter" && run(preset, request, { type: false })}
                className="w-full bg-transparent text-[20px] text-text outline-none"
              />
            ) : (
              <div className="text-[20px] text-text">
                {request.slice(0, typed)}
                {phase === "typing" && <span className="caret ml-0.5 text-jev">▍</span>}
              </div>
            )}
          </div>
          <button
            onClick={() => run(preset, request, { type: false })}
            disabled={phase === "running" || phase === "typing" || !request.trim()}
            className="flex h-[62px] shrink-0 items-center gap-3 rounded-xl bg-text px-8 text-[19px] font-medium text-[#faf8f2] transition hover:opacity-90 disabled:opacity-40"
          >
            <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden>
              <path d="M1 1.5v13l12-6.5z" fill="currentColor" />
            </svg>
            Run comparison
          </button>
        </div>
        {/* Scan field + results */}
        <div className="mt-4 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_600px] gap-5">
          <ScanField
            memories={memories}
            scans={scans}
            keyIds={keyIds}
            keyLabel={preset.keyLabel}
            headline={headline}
            elapsedMs={clock}
            running={phase === "running"}
            highlightId={hoveredMemory}
          />
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            {SYSTEMS.map((s) => (
              <ResultCard
                key={s.id}
                id={s.id}
                name={s.name}
                method={s.method}
                state={cards[s.id]}
                memoryById={memoryById}
                keyIds={keyIds}
                keyLabel={preset.keyLabel}
                onHoverMemory={setHoveredMemory}
              />
            ))}
          </div>
        </div>

        {/* Results strip: this run once it finishes, the full benchmark before that */}
        <div className="mt-4 flex h-[60px] items-center rounded-xl border border-line bg-panel px-8 text-[19px]">
          <div className="flex items-center gap-3 pr-8">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden className="text-accent">
              <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z M7 6H4a3 3 0 0 0 3 4 M17 6h3a3 3 0 0 1-3 4 M12 14v4 M8 20h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="label !text-text">{runStats ? "This request" : "Benchmark"}</span>
            <span className="text-[15px] text-muted">
              {runStats ? runStats.caption : `${BENCHMARK.requests} requests, ${memories.length} memories`}
            </span>
          </div>
          <div className="flex flex-1 items-center gap-10 border-l border-line pl-10">
            {SYSTEMS.map(({ id }) => (
              <span key={id} className="text-muted">
                {id === "sonnet" ? "Sonnet" : id === "embeddings" ? "Embeddings" : "Jev"}{" "}
                <span className="tabular ml-2 text-[21px]" style={{ color: METHOD_COLOR[id] }}>
                  {runStats ? runStats.found[id] : BENCHMARK[id]}
                </span>
              </span>
            ))}
          </div>
          <div className="tabular border-l border-line px-10 text-[17px] text-text">
            {runStats ? runStats.faster : BENCHMARK.faster}
          </div>
          <div className="tabular border-l border-line pl-10 text-[17px] text-text">
            {runStats ? runStats.cost : BENCHMARK.cost}
          </div>
        </div>
      </div>
      {showKeys && <KeysDialog initial={keys} onClose={() => setShowKeys(false)} />}
    </Stage>
  );
}
