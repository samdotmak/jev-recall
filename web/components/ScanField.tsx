"use client";
import { motion } from "motion/react";
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
}: {
  memories: Memory[];
  scans: Record<SystemId, Scan>;
  keyIds: string[];
  keyLabel: string;
  headline: string;
  elapsedMs: number;
  running: boolean;
}) {
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

  return (
    <div className="flex h-full flex-col rounded-2xl border border-line bg-panel px-8 pb-7 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-[21px] text-text">{headline}</span>
          <span className="h-2 w-2 rounded-full bg-[#d8dce3]" />
          <span className="tabular font-mono text-[24px] font-semibold text-text">{(elapsedMs / 1000).toFixed(2)}s</span>
          {running && (
            <motion.span
              className="h-2 w-2 rounded-full bg-jev"
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ repeat: Infinity, duration: 0.9 }}
            />
          )}
        </div>
        <div className="flex items-center gap-2 text-[14px] text-faint">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-cell" />
          Each square is a memory
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="relative" style={{ width, height }}>
          {/* cells */}
          {memories.map((m, i) => {
            const { x, y } = cellXY(i);
            const isKey = reveal && keySet.has(m.id);
            return (
              <div
                key={m.id}
                title={m.text}
                className="absolute rounded-[6px] transition-colors duration-500"
                style={{
                  left: x,
                  top: y,
                  width: CELL,
                  height: CELL,
                  background: isKey ? "#fff" : "var(--cell)",
                  boxShadow: isKey ? "0 0 0 2px var(--text)" : undefined,
                }}
              >
                {pickedBy[m.id] && (
                  <div className="absolute inset-x-0 bottom-[5px] flex justify-center gap-[3px]">
                    {[0, 1, 2].map((slot) => {
                      const sys = pickedBy[m.id].find((s) => DOT_SLOT[s] === slot);
                      return (
                        <span
                          key={slot}
                          className="h-[5px] w-[5px] rounded-full"
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
            let pos: { x: number; y: number };
            let col = 0;
            const sweeping = scan.status === "running";
            if (sweeping) {
              const p = Math.floor((scan.elapsedMs / 1000) * SWEEP_CELLS_PER_SEC) + START_ROW[id] * COLS;
              const cell = p % memories.length;
              pos = cellXY(cell);
              col = cell % COLS;
            } else {
              const t = scan.target !== undefined ? index[scan.target] : undefined;
              pos = t !== undefined ? cellXY(t) : { x: -999, y: -999 };
            }
            // Two scanners can settle on the same memory; nest them so both stay visible.
            const inset = !sweeping && id === "sonnet" && scans.jev.target === scan.target ? -5 : 0;
            return (
              <div key={id}>
                {sweeping && (
                  <div
                    className="pointer-events-none absolute rounded-[6px]"
                    style={{
                      top: pos.y,
                      left: Math.max(0, col - TRAIL) * PITCH,
                      width: Math.min(col, TRAIL) * PITCH + CELL,
                      height: CELL,
                      background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${color} 28%, transparent))`,
                    }}
                  />
                )}
                {pos.x > -999 && (
                  <motion.div
                    className="pointer-events-none absolute rounded-[8px] border-[3px]"
                    initial={false}
                    animate={{ x: pos.x - 4 + inset, y: pos.y - 4 + inset }}
                    transition={sweeping ? { duration: 0 } : { type: "spring", stiffness: 140, damping: 18 }}
                    style={{
                      width: CELL + 8 - inset * 2,
                      height: CELL + 8 - inset * 2,
                      borderColor: color,
                      background: inset ? "transparent" : `color-mix(in srgb, ${color} 22%, transparent)`,
                      boxShadow: `0 0 16px color-mix(in srgb, ${color} 45%, transparent)`,
                      zIndex: id === "jev" ? 3 : 2,
                    }}
                  />
                )}
              </div>
            );
          })}

          {/* the memory that matters, labeled once every method has reported */}
          {reveal &&
            (() => {
              const i = index[keyIds[0]];
              if (i === undefined) return null;
              const { x, y } = cellXY(i);
              const above = y > 60;
              return (
                <motion.div
                  initial={{ opacity: 0, y: above ? 6 : -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="absolute z-10 whitespace-nowrap rounded-lg bg-text px-3 py-1.5 text-[14px] font-medium text-white shadow-lg"
                  style={{
                    left: Math.min(Math.max(x + CELL / 2, 120), width - 120),
                    top: above ? y - 46 : y + CELL + 14,
                    x: "-50%",
                  }}
                >
                  {keyLabel.charAt(0).toUpperCase() + keyLabel.slice(1)}
                </motion.div>
              );
            })()}
        </div>
      </div>
    </div>
  );
}
