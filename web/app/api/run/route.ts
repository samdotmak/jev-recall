// POST /api/run  { system: "embeddings" | "sonnet" | "jev", request: string }
// The caller's API key comes in a header (see KEY_HEADERS). It is passed straight to the
// provider and never logged, stored, or echoed back.
import { ProviderError, runEmbeddings, runJev, runSonnet } from "@/lib/systems";
import { KEY_HEADERS, type SystemId } from "@/lib/types";

export const maxDuration = 60;

const RUNNERS: Record<SystemId, (key: string, request: string) => Promise<unknown>> = {
  embeddings: runEmbeddings,
  sonnet: runSonnet,
  jev: runJev,
};

export async function POST(req: Request) {
  let payload: { system?: string; request?: string };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const system = payload.system as SystemId;
  const request = typeof payload.request === "string" ? payload.request.trim() : "";
  if (!(system in RUNNERS)) return Response.json({ error: "Unknown system." }, { status: 400 });
  if (!request || request.length > 500) {
    return Response.json({ error: "Request must be 1 to 500 characters." }, { status: 400 });
  }
  const key = req.headers.get(KEY_HEADERS[system])?.trim();
  if (!key) return Response.json({ error: "Add your key to run live." }, { status: 401 });
  try {
    return Response.json(await RUNNERS[system](key, request));
  } catch (err) {
    if (err instanceof ProviderError) return Response.json({ error: err.message }, { status: err.status });
    return Response.json({ error: "Something went wrong running this system." }, { status: 500 });
  }
}
