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

/** Found: a filled indicator square in the method's colour. */
function FoundMark({ color, dim }: { color: string; dim?: boolean }) {
  return <span className="mt-[3px] h-2.5 w-2.5 shrink-0" style={{ background: color, opacity: dim ? 0.45 : 1 }} />;
}

/** Missed: an empty square struck through. */
function MissMark() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" className="mt-[3px] shrink-0 text-faint" aria-hidden>
      <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" fill="none" />
      <path d="M0.5 9.5 9.5 0.5" stroke="currentColor" />
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
  onHoverMemory,
}: {
  id: SystemId;
  name: string;
  method: string;
  state: CardState;
  memoryById: Record<string, Memory>;
  keyIds: string[];
  keyLabel: string;
  onHoverMemory: (id: string | null) => void;
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
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-[3px] border border-line bg-panel px-5 py-3">
      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="h-3 w-3" style={{ background: color }} />
            <span className="text-[17px] font-semibold tracking-[-0.01em] text-text">{name}</span>
          </div>
          <div className="ml-[22px] text-[13px] text-muted">
            {method}
            {r && (
              <span className="ml-2 tabular text-text">
                {r.ids.length} {r.ids.length === 1 ? "result" : "results"}
              </span>
            )}
            {state.status === "running" && <span className="ml-2">searching…</span>}
            {state.status === "error" && <span className="ml-2 text-accent">{state.error}</span>}
          </div>
        </div>
        <div className="flex">
          <div className="w-[84px] border-l border-line pl-4">
            <div className="label">Time</div>
            <div className="tabular mt-0.5 text-[17px] font-medium text-text">
              {state.status === "idle" ? "–" : `${(state.elapsedMs / 1000).toFixed(2)}s`}
            </div>
          </div>
          <div className="w-[116px] border-l border-line pl-4">
            <div className="label">Cost</div>
            <div className="tabular mt-0.5 text-[17px] font-medium text-text">{r ? formatCost(r.costUsd) : "–"}</div>
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex min-h-0 flex-1 flex-col justify-center gap-1.5">
        {state.status === "running" &&
          [0, 1].map((i) => <div key={i} className="skeleton h-[44px] shrink-0 rounded-[2px]" />)}
        {rows.map((row, i) => {
            const score = row.kind !== "miss" ? r?.scores?.[row.id] : undefined;
            const tinted = row.kind === "hit";
            const hoverId = row.kind === "miss" ? keyIds[0] : row.id;
            return (
              <div
                key={`${id}-${row.id}`}
                onMouseEnter={() => onHoverMemory(hoverId)}
                onMouseLeave={() => onHoverMemory(null)}
                className="fade-up group flex min-h-[44px] shrink-0 cursor-default items-start gap-3 rounded-[2px] border px-3 py-2 transition-colors hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
                style={{
                  animationDelay: `${80 + i * 120}ms`,
                  borderColor: tinted ? `color-mix(in srgb, ${color} 45%, var(--line))` : "var(--line)",
                  background: tinted ? `color-mix(in srgb, ${color} 8%, var(--panel))` : "var(--panel)",
                }}
              >
                {row.kind === "miss" ? <MissMark /> : <FoundMark color={color} dim={!tinted} />}
                <div className="min-w-0 flex-1">
                  {row.kind === "miss" ? (
                    <>
                      <div className="text-[14px] leading-[17px] text-muted">
                        {keyLabel.charAt(0).toUpperCase() + keyLabel.slice(1)}
                        <span className="ml-2 text-faint">not found</span>
                      </div>
                    </>
                  ) : (
                    <div className="line-clamp-2 text-[14px] leading-[16px] text-text">{memoryById[row.id]?.text}</div>
                  )}
                </div>
                {score !== undefined && tinted && (
                  <span
                    className="fade-up tabular label mt-[2px] shrink-0 !text-jev-ink"
                    style={{ animationDelay: `${500 + i * 120}ms` }}
                  >
                    {score.toFixed(2)}
                  </span>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
