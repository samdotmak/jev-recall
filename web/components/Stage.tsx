"use client";
import { useEffect, useState, type ReactNode } from "react";

/** Renders children on a fixed 1600x900 canvas scaled to fit the window, so recordings look identical everywhere. */
export const STAGE_W = 1600;
export const STAGE_H = 900;

export function Stage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-bg">
      <div
        style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, transformOrigin: "center" }}
        className="relative shrink-0"
      >
        {children}
      </div>
    </div>
  );
}
