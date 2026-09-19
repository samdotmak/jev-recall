"use client";
import { motion, AnimatePresence } from "motion/react";
import { useState } from "react";
import type { Memory } from "@/lib/types";

const COLS = 17;

/** 238 memories as a grid of dots. Key memories light up once revealed. */
export function MemoryWall({
  memories,
  keyIds,
  revealed,
  visible,
}: {
  memories: Memory[];
  keyIds: string[];
  revealed: boolean;
  visible: boolean;
}) {
  const [hover, setHover] = useState<Memory | null>(null);
  const keys = new Set(keyIds);
  return (
    <div className="flex h-full flex-col rounded-2xl border border-line bg-panel p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Memory bank</div>
        <div className="tabular font-mono text-[13px] text-faint">{memories.length} memories</div>
      </div>
      <div
        className="mt-4 grid gap-[5px]"
        style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
        onMouseLeave={() => setHover(null)}
      >
        {memories.map((m, i) => {
          const isKey = revealed && keys.has(m.id);
          return (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={visible ? { opacity: 1, scale: isKey ? 1.35 : 1 } : { opacity: 0, scale: 0.4 }}
              transition={{ delay: visible && !revealed ? i * 0.004 : 0, duration: 0.25 }}
              onMouseEnter={() => setHover(m)}
              className={`aspect-square rounded-[4px] ${
                isKey ? "bg-key shadow-[0_0_14px_2px_rgba(251,191,36,0.7)]" : "bg-[#2a3140] hover:bg-[#3b4456]"
              }`}
            />
          );
        })}
      </div>
      <div className="mt-4 min-h-[44px] text-[13px] leading-snug text-muted">
        {hover ? hover.text : <span className="text-faint">Everything the assistant has learned about you over the past year.</span>}
      </div>
      <div className="mt-auto">
        <AnimatePresence>
          {revealed && keyIds.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="rounded-xl border border-key/60 bg-key/10 p-4"
            >
              <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-key">
                {keyIds.length === 1 ? "The memory that matters" : "The memories that matter"}
              </div>
              <ul className="mt-2 space-y-2">
                {keyIds.map((id) => (
                  <li key={id} className="text-[15px] leading-snug text-text">
                    {memories.find((m) => m.id === id)?.text}
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
