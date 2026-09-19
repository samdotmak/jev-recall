"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Preset } from "@/data/presets";
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
const BENCHMARK = { jev: "19/20", sonnet: "19/20", embeddings: "4/20", faster: "~22× faster", cost: "~1/46 cost" };

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

  const headline =
    phase === "running" ? `Scanning ${memories.length} memories…` : phase === "done" ? `Scanned ${memories.length} memories` : `${memories.length} memories`;
  const recordedAt = replays[preset.id]?.recordedAt;
  const editable = live && !present && phase !== "running" && phase !== "typing";

  return (
    <Stage>
      <div className="flex h-full flex-col px-10 pb-7 pt-6">
        {/* Brand */}
        <div className="flex h-9 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border-[1.5px] border-[#cbd2dc] bg-white text-[17px] font-medium text-text">
              J
            </div>
            <div className="text-[19px] font-medium text-text">Jev Recall</div>
          </div>
          {!present && (
            <div className="flex items-center gap-3 text-[13px]">
              <span className="text-faint">
                {live
                  ? "Live with your keys"
                  : `Replaying a live run${recordedAt ? ` from ${new Date(recordedAt + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}`}
              </span>
              <button
                onClick={() => setShowKeys(true)}
                className="rounded-full border border-line bg-white px-3.5 py-1.5 text-text shadow-sm hover:border-[#cbd2dc]"
              >
                {live ? "Keys" : "Run live with your keys"}
              </button>
            </div>
          )}
        </div>

        <h1 className="mt-2 text-[42px] font-bold leading-[1.1] tracking-[-0.02em] text-text">
          See what each method <span className="text-faint">finds.</span>
        </h1>

        {/* Request */}
        <div className="mt-4 flex items-center gap-4">
          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-line bg-white text-[15px] text-muted">
            You
          </div>
          <div className="flex h-[62px] flex-1 items-center rounded-2xl border border-[#dde2e9] bg-white px-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
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
            className="flex h-[62px] shrink-0 items-center gap-3 rounded-2xl border border-[#99e6d8] bg-[#d5f5ef] px-7 text-[19px] font-semibold text-text transition hover:bg-[#c3f0e7] disabled:opacity-60"
          >
            <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden>
              <path d="M1 1.5v13l12-6.5z" fill="currentColor" />
            </svg>
            Run comparison
          </button>
        </div>
        {!present && (
          <div className="ml-[68px] mt-2.5 flex gap-2">
            {presets.map((p, i) => (
              <button
                key={p.id}
                onClick={() => choose(p, false)}
                className={`rounded-full border px-3 py-1 text-[13px] transition ${
                  p.id === preset.id && isPreset
                    ? "border-[#cbd2dc] bg-white text-text shadow-sm"
                    : "border-transparent text-muted hover:text-text"
                }`}
              >
                <span className="mr-1.5 text-faint">{i + 1}</span>
                {p.label}
              </button>
            ))}
          </div>
        )}

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
              />
            ))}
          </div>
        </div>

        {/* Benchmark strip */}
        <div className="mt-4 flex h-[60px] items-center rounded-2xl border border-line bg-panel px-8 text-[20px]">
          <div className="flex items-center gap-3 pr-8">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden className="text-jev">
              <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z M7 6H4a3 3 0 0 0 3 4 M17 6h3a3 3 0 0 1-3 4 M12 14v4 M8 20h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-text">Benchmark</span>
            <span className="text-muted">(same {memories.length} memories)</span>
          </div>
          <div className="flex flex-1 items-center gap-10 border-l border-line pl-10">
            <span className="text-muted">
              Jev <span className="ml-2 text-[24px] font-medium text-jev">{BENCHMARK.jev}</span>
            </span>
            <span className="text-muted">
              Sonnet <span className="ml-2 text-[24px] font-medium text-sonnet">{BENCHMARK.sonnet}</span>
            </span>
            <span className="text-muted">
              embeddings <span className="ml-2 text-[24px] font-medium text-embeddings">{BENCHMARK.embeddings}</span>
            </span>
          </div>
          <div className="border-l border-line px-10 text-text">{BENCHMARK.faster}</div>
          <div className="border-l border-line pl-10 text-text">{BENCHMARK.cost}</div>
        </div>
      </div>
      {showKeys && <KeysDialog initial={keys} onClose={() => setShowKeys(false)} />}
    </Stage>
  );
}
