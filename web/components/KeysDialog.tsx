"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { SystemId } from "@/lib/types";

export type Keys = Record<SystemId, string>;
export const EMPTY_KEYS: Keys = { embeddings: "", sonnet: "", jev: "" };
const STORAGE = "jev-recall-keys";

const EVENT = "jev-recall-keys-changed";
let memoryFallback = "{}"; // used when localStorage is unavailable

function read(): string {
  try {
    return localStorage.getItem(STORAGE) ?? "{}";
  } catch {
    return memoryFallback;
  }
}
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}
function saveKeys(k: Keys) {
  memoryFallback = JSON.stringify(k);
  try {
    localStorage.setItem(STORAGE, memoryFallback);
  } catch {
    /* storage unavailable: keys live for this page view only */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The visitor's saved keys; empty on the server and until hydration. */
export function useKeys(): Keys {
  const raw = useSyncExternalStore(subscribe, read, () => "{}");
  return useMemo(() => {
    try {
      return { ...EMPTY_KEYS, ...JSON.parse(raw) };
    } catch {
      return EMPTY_KEYS;
    }
  }, [raw]);
}

const FIELDS: { id: SystemId; label: string; href: string; placeholder: string }[] = [
  { id: "jev", label: "TypeSafe API key", href: "https://console.typesafe.ai/keys", placeholder: "apikey_…" },
  { id: "sonnet", label: "Anthropic API key", href: "https://console.anthropic.com/settings/keys", placeholder: "sk-ant-…" },
  { id: "embeddings", label: "OpenAI API key", href: "https://platform.openai.com/api-keys", placeholder: "sk-…" },
];

export function KeysDialog({ initial, onClose }: { initial: Keys; onClose: () => void }) {
  const [keys, setKeys] = useState<Keys>(initial);
  const done = (k: Keys) => {
    saveKeys(k);
    onClose();
  };
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm" onClick={() => onClose()}>
      <div className="w-[560px] rounded-2xl border border-line bg-panel p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-[22px] font-semibold">Run it live with your own keys</div>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Without keys you see recorded live runs. Add all three keys to run the presets live or type your own request.
        </p>
        <div className="mt-5 space-y-4">
          {FIELDS.map((f) => (
            <label key={f.id} className="block">
              <div className="flex justify-between text-[13px]">
                <span className="font-medium">{f.label}</span>
                <a href={f.href} target="_blank" rel="noreferrer" className="text-muted underline-offset-2 hover:underline">
                  Get a key
                </a>
              </div>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keys[f.id]}
                placeholder={f.placeholder}
                onChange={(e) => setKeys({ ...keys, [f.id]: e.target.value.trim() })}
                className="mt-1.5 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-[13px] text-text outline-none focus:border-jev"
              />
            </label>
          ))}
        </div>
        <p className="mt-4 text-[12.5px] leading-relaxed text-faint">
          Keys stay in this browser&apos;s local storage. Each run sends them to this site&apos;s API route, which passes them to the
          provider and never stores or logs them. The code is open source.
        </p>
        <div className="mt-6 flex justify-between">
          <button onClick={() => done({ ...EMPTY_KEYS })} className="text-[14px] text-muted hover:text-text">
            Forget keys
          </button>
          <button onClick={() => done(keys)} className="rounded-lg bg-text px-5 py-2 text-[14px] font-semibold text-white">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
