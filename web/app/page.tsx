import { Demo } from "@/components/Demo";
import { PRESETS } from "@/data/presets";
import replays from "@/data/replays.json";
import { MEMORIES } from "@/lib/data";

export default async function Page({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  return <Demo memories={MEMORIES} presets={PRESETS} replays={replays as never} present={sp.present === "1"} />;
}
