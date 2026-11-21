"use client";

import { useState } from "react";
import "./live-number.css";

/**
 * Count how many times a value has changed. The first value does not count, so nothing animates on load.
 * Uses the render-time update pattern, so a change is seen in the same render that carries it.
 * @param value the value to watch
 * @return 0 until the value changes, then 1, 2, 3 and so on
 */
export function useBump(value: unknown): number {
  const [seen, setSeen] = useState({ value, count: 0 });
  if (seen.value !== value) setSeen({ value, count: seen.count + 1 });
  return seen.count;
}

/** A number that slides in from below when it changes. Plain text on first load. */
export function LiveNumber({ value, className }: { value: number | string; className?: string }) {
  const bumps = useBump(value);
  return (
    <span key={bumps} className={`${className ?? ""} ${bumps > 0 ? "live-number" : ""}`}>
      {value}
    </span>
  );
}
