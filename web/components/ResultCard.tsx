"use client";
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
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col rounded-xl border border-line bg-panel px-5 py-3.5">
      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="h-[18px] w-[18px] rounded-full" style={{ background: color }} />
            <span className="text-[20px] font-semibold text-text">{name}</span>
          </div>
          <div className="ml-[30px] mt-0.5 text-[14px] text-muted">
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
            <div className="label">Time</div>
            <div className="tabular mt-0.5 text-[18px] text-text">
              {state.status === "idle" ? "–" : `${(state.elapsedMs / 1000).toFixed(2)}s`}
            </div>
          </div>
          <div className="w-[118px] border-l border-line pl-4">
            <div className="label">Cost</div>
            <div className="tabular mt-0.5 text-[18px] text-text">{r ? formatCost(r.costUsd) : "–"}</div>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex min-h-0 flex-1 flex-col gap-1.5">
        {state.status === "running" &&
          [0, 1].map((i) => <div key={i} className="skeleton h-[42px] shrink-0 rounded-xl" />)}
        {rows.map((row, i) => {
            const score = row.kind !== "miss" ? r?.scores?.[row.id] : undefined;
            const tinted = row.kind === "hit";
            const full = row.kind === "miss" ? keyIds.map((k) => memoryById[k]?.text).join(" ") : memoryById[row.id]?.text;
            return (
              <div
                key={`${id}-${row.id}`}
                className="fade-up group relative flex h-[42px] shrink-0 items-center gap-3 rounded-xl border px-3"
                style={{
                  animationDelay: `${80 + i * 120}ms`,
                  borderColor: tinted ? `color-mix(in srgb, ${color} 30%, transparent)` : "var(--line)",
                  background: tinted
                    ? `color-mix(in srgb, ${color} 12%, var(--panel))`
                    : row.kind === "miss"
                      ? "var(--panel-2)"
                      : "var(--panel)",
                }}
              >
                {full && (
                  <div
                    className={`pointer-events-none absolute inset-x-0 z-50 rounded-lg border border-line bg-panel px-3 py-2 text-[14px] leading-snug text-text opacity-0 shadow-[0_8px_24px_rgba(22,21,15,0.14)] transition-opacity duration-150 group-hover:opacity-100 ${
                      i === 0 ? "top-[calc(100%+6px)]" : "bottom-[calc(100%+6px)]"
                    }`}
                  >
                    {full}
                  </div>
                )}
                {row.kind === "miss" ? <MissIcon /> : <DocIcon />}
                <div className="min-w-0 flex-1">
                  {row.kind === "miss" ? (
                    <>
                      <div className="truncate text-[15px] text-muted">
                        {keyLabel.charAt(0).toUpperCase() + keyLabel.slice(1)}
                        <span className="ml-2 text-[14px] text-faint">Doesn&apos;t find this detail.</span>
                      </div>
                    </>
                  ) : (
                    <div className="truncate text-[15px] text-text">{memoryById[row.id]?.text}</div>
                  )}
                </div>
                {score !== undefined && tinted && (
                  <span
                    className="fade-up tabular shrink-0 text-[13px] text-jev-ink"
                    style={{ animationDelay: `${500 + i * 120}ms` }}
                  >
                    Relevance {score.toFixed(2)}
                  </span>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
