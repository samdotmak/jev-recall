"use client";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Preset } from "@/data/presets";
import { KEY_HEADERS, SYSTEMS, type Memory, type RunResult, type SystemId } from "@/lib/types";
import { KeysDialog, useKeys } from "./KeysDialog";
import { MemoryWall } from "./MemoryWall";
import { Stage } from "./Stage";
import { SystemColumn, formatCost, type ColumnState } from "./SystemColumn";

type Replays = Record<string, Record<SystemId, RunResult> & { recordedAt: string }>;
type Phase = "intro" | "typing" | "reveal" | "racing" | "done";
type Columns = Record<SystemId, ColumnState>;

const IDLE: Columns = {
  embeddings: { status: "idle", elapsedMs: 0 },
  sonnet: { status: "idle", elapsedMs: 0 },
  jev: { status: "idle", elapsedMs: 0 },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const [phase, setPhase] = useState<Phase>(present ? "intro" : "typing");
  const [wallVisible, setWallVisible] = useState(!present);
  const [cols, setCols] = useState<Columns>(IDLE);
  const keys = useKeys();
  const [showKeys, setShowKeys] = useState(false);
  const runId = useRef(0);

  const live = keys.jev !== "" && keys.sonnet !== "" && keys.embeddings !== "";
  const isPreset = request.trim() === preset.request;
  const keyIds = isPreset ? preset.keyIds : [];
  const graded = isPreset;

  const run = useCallback(
    async (p: Preset, text: string, opts: { intro: boolean }) => {
      const my = ++runId.current;
      const alive = () => runId.current === my;
      setCols(IDLE);
      const presetRun = text.trim() === p.request;

      if (opts.intro) {
        setPhase("intro");
        setWallVisible(false);
        setTyped(0);
        await sleep(300);
        setWallVisible(true);
        await sleep(2600);
        if (!alive()) return;
        setPhase("typing");
        for (let i = 1; i <= text.length; i++) {
          setTyped(i);
          await sleep(28);
          if (!alive()) return;
        }
        await sleep(900);
      } else {
        setTyped(text.length);
        setWallVisible(true);
      }
      if (!alive()) return;
      if (presetRun) {
        setPhase("reveal");
        await sleep(opts.intro ? 3200 : 1600);
        if (!alive()) return;
      }
      setPhase("racing");

      const t0 = performance.now();
      const finished = new Set<SystemId>();
      const tick = () => {
        if (!alive()) return;
        const now = performance.now() - t0;
        setCols((c) => {
          const next = { ...c };
          for (const s of SYSTEMS) if (next[s.id].status === "running") next[s.id] = { ...next[s.id], elapsedMs: now };
          return next;
        });
        if (finished.size < SYSTEMS.length) requestAnimationFrame(tick);
      };
      setCols({
        embeddings: { status: "running", elapsedMs: 0 },
        sonnet: { status: "running", elapsedMs: 0 },
        jev: { status: "running", elapsedMs: 0 },
      });
      requestAnimationFrame(tick);

      const finish = (id: SystemId, state: ColumnState) => {
        if (!alive()) return;
        finished.add(id);
        setCols((c) => ({ ...c, [id]: state }));
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
      setCols(IDLE);
      if (autoplay) run(p, p.request, { intro: present });
      else {
        setPhase("typing");
        setTyped(p.request.length);
      }
    },
    [run, present],
  );

  // Presentation mode: autoplay once on load. Keyboard: space runs, 1-4 pick presets.
  useEffect(() => {
    if (present) {
      const t = setTimeout(() => run(presets[0], presets[0].request, { intro: true }), 800);
      return () => clearTimeout(t);
    }
  }, [present, presets, run]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        run(preset, request, { intro: present });
      }
      const n = Number(e.key);
      if (n >= 1 && n <= presets.length) choose(presets[n - 1], present);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, choose, preset, request, present, presets]);

  const done = phase === "done";
  const s = cols.sonnet.result;
  const j = cols.jev.result;
  const e = cols.embeddings.result;
  const found = (r?: RunResult) => !!r && keyIds.every((k) => r.ids.includes(k));
  const costX = s && j && j.costUsd > 0 ? Math.round(s.costUsd / j.costUsd) : 0;
  const speedX = done && cols.jev.elapsedMs > 0 ? Math.round(cols.sonnet.elapsedMs / cols.jev.elapsedMs) : 0;

  const caption: Record<Phase, string> = {
    intro: `Your AI assistant remembers ${memories.length} things about your life.`,
    typing: "You ask it to do something.",
    reveal: keyIds.length > 1 ? "A few of those memories change the right answer." : "One of those memories changes the right answer.",
    racing: "Three ways to choose which memories the assistant reads before it acts.",
    done:
      graded && found(j) && found(s) && !found(e)
        ? `Semantic search missed it. Jev found it ${costX}× cheaper and ${speedX}× faster than Claude.`
        : "Done.",
  };

  const recordedAt = replays[preset.id]?.recordedAt;

  return (
    <Stage>
      <div className="flex h-full flex-col px-10 pb-7 pt-6">
        {/* Top bar */}
        <div className="flex h-10 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-jev/15 font-mono text-[15px] font-bold text-jev">J</div>
            <div className="text-[18px] font-semibold tracking-tight">Jev Recall</div>
            <div className="text-[14px] text-faint">Retrieve by relevance, not resemblance.</div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`rounded-full border px-3 py-1 text-[12.5px] ${live ? "border-good/50 text-good" : "border-line text-muted"}`}>
              {live ? "Live · your keys" : `Replay of a live run${recordedAt ? ` · ${new Date(recordedAt + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}`}
            </div>
            {!present && (
              <button onClick={() => setShowKeys(true)} className="rounded-full border border-line px-3 py-1 text-[12.5px] text-text hover:border-muted">
                {live ? "Keys" : "Run live with your keys"}
              </button>
            )}
          </div>
        </div>

        {/* Headline */}
        <div className="mt-4">
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-tight">
            Your assistant knows {memories.length} things about your life.{" "}
            <span className="text-muted">Which ones should it read first?</span>
          </h1>
        </div>

        {/* Request */}
        <div className="mt-4 flex items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel-2 text-[13px] font-semibold text-muted">You</div>
          <div className="flex min-h-[58px] flex-1 items-center rounded-2xl rounded-tl-sm border border-line bg-panel px-5 py-3">
            {live && !present && phase !== "racing" && phase !== "intro" ? (
              <textarea
                value={request}
                rows={1}
                maxLength={500}
                onChange={(ev) => {
                  setRequest(ev.target.value);
                  setTyped(ev.target.value.length);
                  setCols(IDLE);
                }}
                className="w-full resize-none bg-transparent text-[20px] outline-none"
              />
            ) : (
              <div className="text-[20px]">
                {request.slice(0, typed)}
                {phase === "typing" && typed < request.length && <span className="caret ml-0.5 text-jev">▍</span>}
              </div>
            )}
          </div>
          {!present && (
            <button
              onClick={() => run(preset, request, { intro: false })}
              disabled={phase === "racing" || phase === "reveal" || !request.trim()}
              className="h-[58px] shrink-0 rounded-2xl bg-jev px-6 text-[16px] font-semibold text-bg transition hover:brightness-110 disabled:opacity-40"
            >
              Find relevant memories
            </button>
          )}
        </div>
        {!present && (
          <div className="ml-[60px] mt-3 flex gap-2">
            {presets.map((p, i) => (
              <button
                key={p.id}
                onClick={() => choose(p, false)}
                className={`rounded-full border px-3 py-1 text-[13px] transition ${
                  p.id === preset.id && isPreset ? "border-text/60 bg-panel-2 text-text" : "border-line text-muted hover:text-text"
                }`}
              >
                <span className="mr-1.5 font-mono text-faint">{i + 1}</span>
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Main */}
        <div className="mt-4 grid min-h-0 flex-1 grid-cols-[340px_1fr_1fr_1fr] gap-4">
          <MemoryWall memories={memories} keyIds={keyIds} revealed={phase === "reveal" || phase === "racing" || phase === "done"} visible={wallVisible} />
          {SYSTEMS.map((sys) => (
            <SystemColumn
              key={sys.id}
              id={sys.id}
              name={sys.name}
              method={sys.method}
              state={cols[sys.id]}
              memoryById={memoryById}
              keyIds={keyIds}
              keyLabel={preset.keyLabel}
              graded={graded}
              badReply={preset.badReply}
              goodReply={preset.goodReply}
              hero={sys.id === "jev"}
            />
          ))}
        </div>

        {/* Caption / verdict */}
        <div className="mt-4 flex h-[60px] items-center justify-between">
          <AnimatePresence mode="wait">
            <motion.div
              key={caption[phase]}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35 }}
              className="text-[22px] font-medium tracking-tight"
            >
              {caption[phase]}
            </motion.div>
          </AnimatePresence>
          {done && s && j && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="flex gap-3">
              <Stat label="Jev cost" value={formatCost(j.costUsd)} sub={`vs ${formatCost(s.costUsd)} for Claude`} accent />
              <Stat label="Jev time" value={`${(cols.jev.elapsedMs / 1000).toFixed(2)}s`} sub={`vs ${(cols.sonnet.elapsedMs / 1000).toFixed(1)}s for Claude`} accent />
            </motion.div>
          )}
        </div>
        <div className="mt-1 text-[11.5px] text-faint">
          Claude cost shown without prompt caching. Replies are illustrative. Memories are fictional. Benchmark and code: 238 memories, 18 requests, open source.
        </div>
      </div>
      {showKeys && (
        <KeysDialog
          initial={keys}
          onClose={() => setShowKeys(false)}
        />
      )}
    </Stage>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-1.5 text-right">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-faint">{label}</div>
      <div className={`tabular font-mono text-[18px] leading-tight ${accent ? "text-jev" : ""}`}>{value}</div>
      <div className="text-[11px] text-muted">{sub}</div>
    </div>
  );
}
