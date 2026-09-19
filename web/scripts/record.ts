// Records live runs of every preset for replay mode.
//   pnpm tsx scripts/record.ts
// Reads TYPESAFE_API_KEY, ANTHROPIC_API_KEY and OPENAI_API_KEY from ../.env (never committed).
// Each system runs 3 times per preset; the run with the median latency is kept.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PRESETS } from "../data/presets";
import { runEmbeddings, runJev, runSonnet } from "../lib/systems";
import type { RunResult, SystemId } from "../lib/types";

const envPath = join(__dirname, "..", "..", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
const key = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const runners: Record<SystemId, (request: string) => Promise<RunResult>> = {
  embeddings: (r) => runEmbeddings(key("OPENAI_API_KEY"), r),
  sonnet: (r) => runSonnet(key("ANTHROPIC_API_KEY"), r),
  jev: (r) => runJev(key("TYPESAFE_API_KEY"), r),
};

async function main() {
  const out = join(__dirname, "..", "data", "replays.json");
  mkdirSync(join(__dirname, "..", "data"), { recursive: true });
  const replays: Record<string, Record<SystemId, RunResult> & { recordedAt: string }> = {};
  for (const p of PRESETS) {
    const entry = { recordedAt: new Date().toISOString().slice(0, 10) } as Record<SystemId, RunResult> & { recordedAt: string };
    await Promise.all(
      (Object.keys(runners) as SystemId[]).map(async (sys) => {
        const runs: RunResult[] = [];
        for (let i = 0; i < 3; i++) runs.push(await runners[sys](p.request));
        runs.sort((a, b) => a.latencyMs - b.latencyMs);
        entry[sys] = runs[1];
        const found = p.keyIds.filter((id) => runs[1].ids.includes(id));
        console.log(
          `${p.id.padEnd(14)} ${sys.padEnd(10)} key ${found.length}/${p.keyIds.length}  ` +
            `${(runs[1].latencyMs / 1000).toFixed(2)}s  $${runs[1].costUsd.toFixed(5)}  [${runs[1].ids.join(", ")}]`,
        );
      }),
    );
    replays[p.id] = entry;
  }
  writeFileSync(out, JSON.stringify(replays, null, 1));
  console.log(`wrote ${out}`);
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
