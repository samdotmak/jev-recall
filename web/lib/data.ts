import generated from "@/data/generated/memories.json";
import type { Memory } from "./types";

export const TODAY: string = generated.today;
export const MEMORIES: Memory[] = generated.memories;
export const MEMORY_BY_ID: Record<string, Memory> = Object.fromEntries(MEMORIES.map((m) => [m.id, m]));

/** Same wording as `situation()` in bench/run.py. */
export function situation(request: string): string {
  return `Today is ${TODAY}.\nUser's request to the assistant: ${request}`;
}
