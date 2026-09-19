"use client";
import { AnimatePresence, motion } from "motion/react";
import { METHOD_COLOR, formatCost } from "@/lib/format";
import type { Memory, RunResult, SystemId } from "@/lib/types";

export type CardState = {
  status: "idle" | "running" | "done" | "error";
  elapsedMs: number;
  result?: RunResult;
  error?: string;
};

const ROWS = 2;

function DocIcon() {
  return (
    <svg width="18" height="22" viewBox="0 0 22 26" fill="none" aria-hidden className="shrink-0 text-faint">
      <path d="M3 1.5h10.5L19.5 7.5V24a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13 1.5V8h6.5M6.5 12.5h9M6.5 16.5h9M6.5 20.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function MissIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-faint">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 18.5 18.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ResultCard({
  id,
  name,
  method,
  state,
  memoryById,
  keyIds,
  keyLabel,
}: {
  id: SystemId;
  name: string;
  method: string;
  state: CardState;
  memoryById: Record<string, Memory>;
  keyIds: string[];
  keyLabel: string;
}) {
  const color = METHOD_COLOR[id];
  const r = state.status === "done" ? state.result : undefined;
  const keys = new Set(keyIds);
  const foundKeys = r ? r.ids.filter((x) => keys.has(x)) : [];
  const missed = r ? keyIds.filter((k) => !r.ids.includes(k)) : [];
  const others = r ? r.ids.filter((x) => !keys.has(x)) : [];

  type Row = { kind: "hit" | "other" | "miss"; id: string };
  const rows: Row[] = [
    ...foundKeys.map((k) => ({ kind: "hit" as const, id: k })),
    ...(missed.length ? [{ kind: "miss" as const, id: "miss" }] : []),
    ...others.map((o) => ({ kind: "other" as const, id: o })),
  ].slice(0, ROWS);

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col rounded-2xl border border-line bg-panel px-5 py-3.5">
      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="h-[18px] w-[18px] rounded-full" style={{ background: color }} />
            <span className="text-[19px] font-semibold tracking-tight text-text">{name}</span>
          </div>
          <div className="ml-[30px] mt-0.5 text-[13px] text-muted">
            {method}
            {r && (
              <span className="ml-2 text-text">
                · {r.ids.length} {r.ids.length === 1 ? "result" : "results"}
              </span>
            )}
            {state.status === "running" && <span className="ml-2">· searching…</span>}
            {state.status === "error" && <span className="ml-2 text-[#dc2626]">· {state.error}</span>}
          </div>
        </div>
        <div className="flex">
          <div className="w-[86px] border-l border-line pl-4">
            <div className="text-[13px] text-muted">Time</div>
            <div className="tabular text-[19px] text-text">
              {state.status === "idle" ? "–" : `${(state.elapsedMs / 1000).toFixed(2)}s`}
            </div>
          </div>
          <div className="w-[118px] border-l border-line pl-4">
            <div className="text-[13px] text-muted">Cost</div>
            <div className="tabular text-[19px] text-text">{r ? formatCost(r.costUsd) : "–"}</div>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex min-h-0 flex-1 flex-col gap-1.5">
        {state.status === "running" &&
          [0, 1].map((i) => <div key={i} className="skeleton h-[42px] shrink-0 rounded-xl" />)}
        <AnimatePresence>
          {rows.map((row, i) => {
            const score = row.kind !== "miss" ? r?.scores?.[row.id] : undefined;
            const tinted = row.kind === "hit";
            return (
              <motion.div
                key={`${id}-${row.id}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + i * 0.12 }}
                className="flex h-[42px] shrink-0 items-center gap-3 rounded-xl border px-3"
                style={{
                  borderColor: tinted ? `color-mix(in srgb, ${color} 30%, transparent)` : "var(--line)",
                  background: tinted ? `color-mix(in srgb, ${color} 9%, white)` : row.kind === "miss" ? "var(--panel-2)" : "white",
                }}
              >
                {row.kind === "miss" ? <MissIcon /> : <DocIcon />}
                <div className="min-w-0 flex-1">
                  {row.kind === "miss" ? (
                    <>
                      <div className="truncate text-[14px] text-muted">
                        {keyLabel.charAt(0).toUpperCase() + keyLabel.slice(1)}
                        <span className="ml-2 text-[13px] text-faint">Doesn&apos;t find this detail.</span>
                      </div>
                    </>
                  ) : (
                    <div className="truncate text-[14px] text-text">{memoryById[row.id]?.text}</div>
                  )}
                </div>
                {score !== undefined && tinted && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 + i * 0.12 }}
                    className="tabular shrink-0 text-[14px] font-medium text-jev-ink"
                  >
                    Relevance {score.toFixed(2)}
                  </motion.span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
