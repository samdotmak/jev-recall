"use client";
import { motion, AnimatePresence } from "motion/react";
import type { Memory, RunResult, SystemId } from "@/lib/types";

export type ColumnState = {
  status: "idle" | "running" | "done" | "error";
  elapsedMs: number;
  result?: RunResult;
  error?: string;
};

const ACCENT: Record<SystemId, string> = { embeddings: "var(--embeddings)", sonnet: "var(--sonnet)", jev: "var(--jev)" };
const MAX_ROWS = 10;

export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.00001) return "<$0.00001";
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(3)}`;
}

export function SystemColumn({
  id,
  name,
  method,
  state,
  memoryById,
  keyIds,
  keyLabel,
  graded,
  badReply,
  goodReply,
  hero,
}: {
  id: SystemId;
  name: string;
  method: string;
  state: ColumnState;
  memoryById: Record<string, Memory>;
  keyIds: string[];
  keyLabel: string;
  graded: boolean;
  badReply: string;
  goodReply: string;
  hero?: boolean;
}) {
  const accent = ACCENT[id];
  const result = state.status === "done" ? state.result : undefined;
  const keys = new Set(keyIds);
  const foundAll = !!result && keyIds.every((k) => result.ids.includes(k));

  // Rows to show: the system's picks in its own order, always keeping key memories visible.
  // Key memories first so they stay visible; the rest keep the system's own order.
  let rows = [...(result?.ids ?? [])].sort((a, b) => Number(keys.has(b)) - Number(keys.has(a)));
  let hidden = 0;
  if (rows.length > MAX_ROWS) {
    const keep = new Set([...rows.filter((r) => keys.has(r)), ...rows.slice(0, MAX_ROWS)]);
    const trimmed = rows.filter((r) => keep.has(r)).slice(0, Math.max(MAX_ROWS, [...keep].length));
    hidden = rows.length - trimmed.length;
    rows = trimmed;
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden rounded-2xl border bg-panel"
      style={{ borderColor: hero ? `color-mix(in srgb, ${accent} 45%, transparent)` : "var(--line)" }}
    >
      {hero && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-25"
          style={{ background: `radial-gradient(60% 100% at 50% 0%, ${accent}, transparent)` }}
        />
      )}
      <div className="relative px-5 pt-4">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
          <span className="text-[19px] font-semibold tracking-tight">{name}</span>
        </div>
        <div className="mt-1 text-[13px] text-muted">{method}</div>
        <div className="mt-3 flex items-end justify-between border-b border-line pb-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-faint">Time</div>
            <div className="tabular font-mono text-[28px] font-medium leading-none" style={{ color: state.status === "idle" ? "var(--faint)" : "var(--text)" }}>
              {(state.elapsedMs / 1000).toFixed(2)}s
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.14em] text-faint">Cost</div>
            <div className="tabular font-mono text-[20px] leading-none text-text">
              {result ? formatCost(result.costUsd) : state.status === "running" ? "…" : "–"}
            </div>
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden px-5 pt-3">
        {state.status === "running" && (
          <div className="flex items-center gap-2 text-[14px] text-muted">
            <motion.span
              className="h-2 w-2 rounded-full"
              style={{ background: accent }}
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ repeat: Infinity, duration: 0.9 }}
            />
            {id === "sonnet" ? "Reading all 238 memories…" : id === "jev" ? "Scoring all 238 memories…" : "Finding similar memories…"}
          </div>
        )}
        {state.status === "error" && <div className="text-[14px] text-bad">{state.error}</div>}
        {result && (
          <>
            <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-faint">
              Picked {result.ids.length} {result.ids.length === 1 ? "memory" : "memories"}
            </div>
            <ul className="space-y-1">
              {rows.map((mid, i) => {
                const isKey = keys.has(mid);
                const score = result.scores?.[mid];
                return (
                  <motion.li
                    key={mid}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-[5px] text-[12.5px] ${
                      isKey ? "border border-key/70 bg-key/10 text-text" : "bg-panel-2 text-muted"
                    }`}
                  >
                    {isKey && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-key">Key</span>}
                    <span className={isKey ? "leading-snug" : "truncate"}>{memoryById[mid]?.text}</span>
                    {score !== undefined && (
                      <span className="tabular ml-auto shrink-0 font-mono text-[11px]" style={{ color: accent }}>
                        {score.toFixed(2)}
                      </span>
                    )}
                  </motion.li>
                );
              })}
              {hidden > 0 && <li className="px-2.5 text-[12px] text-faint">+{hidden} more</li>}
            </ul>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-panel to-transparent" />
          </>
        )}
      </div>

      <div className="relative shrink-0 px-5 pb-4 pt-2">
        <AnimatePresence>
          {result && graded && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(rows.length, 10) * 0.06 + 0.25 }}
              className="space-y-2"
            >
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] font-semibold ${
                  foundAll ? "bg-good/15 text-good" : "bg-bad/15 text-bad"
                }`}
              >
                <span className="text-[16px]">{foundAll ? "✓" : "✗"}</span>
                <span>{foundAll ? `Found ${keyLabel}` : `Missed ${keyLabel}`}</span>
              </div>
              <div className="rounded-xl rounded-tl-sm border border-line bg-panel-2 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.14em] text-faint">Assistant replies</div>
                <div className={`mt-1 text-[13.5px] leading-snug ${foundAll ? "text-text" : "text-bad/90"}`}>
                  {foundAll ? goodReply : badReply}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
