"use client";
import { useState } from "react";
import { METHOD_COLOR } from "@/lib/format";
import { SYSTEMS, type Memory, type SystemId } from "@/lib/types";

export const COLS = 22;
const PITCH = 38; // px between cell origins
const CELL = 30;
const SWEEP_CELLS_PER_SEC = 34;
const START_ROW: Record<SystemId, number> = { embeddings: 1, sonnet: 5, jev: 8 };
const TRAIL = 9; // cells of translucent trail behind each scanner
const DOT_SLOT: Record<SystemId, number> = { embeddings: 0, sonnet: 1, jev: 2 };

export type Scan = {
  status: "idle" | "running" | "done" | "error";
  elapsedMs: number;
  picks: string[];
  target?: string; // memory the scanner settles on when done
};

const cellXY = (i: number) => ({ x: (i % COLS) * PITCH, y: Math.floor(i / COLS) * PITCH });

/** One shared grid of every memory; three colored scanners sweep it and settle on what each method picked. */
export function ScanField({
  memories,
  scans,
  keyIds,
  keyLabel,
  headline,
  elapsedMs,
  running,
  highlightId,
}: {
  memories: Memory[];
  scans: Record<SystemId, Scan>;
  keyIds: string[];
  keyLabel: string;
  headline: string;
  elapsedMs: number;
  running: boolean;
  highlightId: string | null; // memory hovered in the results column
}) {
  const [hover, setHover] = useState<number | null>(null);
  const index = Object.fromEntries(memories.map((m, i) => [m.id, i]));
  const rows = Math.ceil(memories.length / COLS);
  const width = (COLS - 1) * PITCH + CELL;
  const height = (rows - 1) * PITCH + CELL;
  const allDone = SYSTEMS.every((s) => scans[s.id].status === "done" || scans[s.id].status === "error");
  const reveal = allDone && keyIds.length > 0 && scans.jev.status === "done";
  const keySet = new Set(keyIds);

  // Which methods picked each memory (drawn as small dots once they finish).
  const pickedBy: Record<string, SystemId[]> = {};
  for (const s of SYSTEMS) {
    if (scans[s.id].status !== "done") continue;
    for (const id of scans[s.id].picks) (pickedBy[id] ??= []).push(s.id);
  }

  const shownIndex = highlightId !== null ? index[highlightId] : hover;
  const hovered = shownIndex !== undefined && shownIndex !== null ? memories[shownIndex] : null;
  const hoverPos = shownIndex !== undefined && shownIndex !== null ? cellXY(shownIndex) : null;

  return (
    <div className="flex h-full flex-col rounded-[3px] border border-line bg-panel px-8 pb-7 pt-5">
      <div className="flex items-end justify-between border-b border-line pb-3">
        <div>
          <div className="label">Memory field</div>
          <div className="mt-1 text-[17px] text-text">{headline}</div>
        </div>
        <div className="flex items-end gap-3">
          {running && <span className="pulse-dot mb-[9px] h-2 w-2 bg-jev" />}
          <div className="text-right">
            <div className="label">Elapsed</div>
            <div className="tabular mt-0.5 text-[26px] font-medium leading-none text-text">
              {(elapsedMs / 1000).toFixed(2)}s
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="relative" style={{ width, height }} onMouseLeave={() => setHover(null)}>
          {/* cells */}
          {memories.map((m, i) => {
            const { x, y } = cellXY(i);
            const isKey = reveal && keySet.has(m.id);
            return (
              <div
                key={m.id}
                onMouseEnter={() => setHover(i)}
                className="absolute rounded-[1px] transition-colors duration-200"
                style={{
                  left: x,
                  top: y,
                  width: CELL,
                  height: CELL,
                  background: isKey ? "var(--panel)" : shownIndex === i ? "var(--cell-hover)" : "var(--cell)",
                  boxShadow: isKey ? "0 0 0 1.5px var(--accent)" : shownIndex === i ? "0 0 0 1.5px var(--text)" : undefined,
                }}
              >
                {pickedBy[m.id] && (
                  <div className="absolute inset-x-0 bottom-[5px] flex justify-center gap-[3px]">
                    {[0, 1, 2].map((slot) => {
                      const sys = pickedBy[m.id].find((s) => DOT_SLOT[s] === slot);
                      return (
                        <span
                          key={slot}
                          className="h-[4px] w-[4px]"
                          style={{ background: sys ? METHOD_COLOR[sys] : "transparent" }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* scanners */}
          {SYSTEMS.map(({ id }) => {
            const scan = scans[id];
            if (scan.status === "idle") return null;
            const color = METHOD_COLOR[id];
            const sweeping = scan.status === "running";
            let pos: { x: number; y: number } | null;
            let col = 0;
            if (sweeping) {
              const p = Math.floor((scan.elapsedMs / 1000) * SWEEP_CELLS_PER_SEC) + START_ROW[id] * COLS;
              const cell = p % memories.length;
              pos = cellXY(cell);
              col = cell % COLS;
            } else {
              const t = scan.target !== undefined ? index[scan.target] : undefined;
              pos = t !== undefined ? cellXY(t) : null;
            }
            if (!pos) return null;
            // Two scanners can settle on the same memory; nest one inside the other.
            const inset = !sweeping && id === "sonnet" && scans.jev.target === scan.target ? -5 : 0;
            return (
              <div key={id}>
                {sweeping && (
                  <div
                    className="pointer-events-none absolute rounded-[1px]"
                    style={{
                      top: pos.y,
                      left: Math.max(0, col - TRAIL) * PITCH,
                      width: Math.min(col, TRAIL) * PITCH + CELL,
                      height: CELL,
                      background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${color} 22%, transparent))`,
                    }}
                  />
                )}
                <div
                  className="pointer-events-none absolute left-0 top-0 rounded-[2px] border-2"
                  style={{
                    transform: `translate3d(${pos.x - 4 + inset}px, ${pos.y - 4 + inset}px, 0)`,
                    transition: sweeping ? "none" : "transform 0.55s cubic-bezier(0.2, 0.8, 0.2, 1)",
                    width: CELL + 8 - inset * 2,
                    height: CELL + 8 - inset * 2,
                    borderColor: color,
                    background: inset ? "transparent" : `color-mix(in srgb, ${color} 16%, transparent)`,
                    zIndex: id === "jev" ? 3 : 2,
                  }}
                />
              </div>
            );
          })}

          {/* hover readout */}
          {hovered && hoverPos && (
            <div
              className="pointer-events-none absolute z-20 max-w-[420px] rounded-[2px] border border-line-strong bg-panel/95 px-3 py-2 text-[13.5px] leading-snug text-text backdrop-blur-[2px]"
              style={{
                left: Math.min(Math.max(hoverPos.x + CELL / 2, 210), width - 210),
                top: hoverPos.y > 70 ? hoverPos.y - 12 : hoverPos.y + CELL + 12,
                transform: `translate(-50%, ${hoverPos.y > 70 ? "-100%" : "0"})`,
              }}
            >
              {hovered.text}
            </div>
          )}

          {/* the memory that matters, labeled once every method has reported */}
          {reveal &&
            !hovered &&
            (() => {
              const i = index[keyIds[0]];
              if (i === undefined) return null;
              const { x, y } = cellXY(i);
              const above = y > 60;
              return (
                <div
                  className="fade-up label absolute z-10 whitespace-nowrap rounded-[2px] border border-accent/40 bg-accent/10 px-2.5 py-1.5 !text-accent"
                  style={{
                    animationDelay: "450ms",
                    left: Math.min(Math.max(x + CELL / 2, 120), width - 120),
                    top: above ? y - 46 : y + CELL + 14,
                    marginLeft: "-0.5px",
                    transform: "translateX(-50%)",
                  }}
                >
                  {keyLabel.charAt(0).toUpperCase() + keyLabel.slice(1)}
                </div>
              );
            })()}
        </div>
      </div>
    </div>
  );
}
