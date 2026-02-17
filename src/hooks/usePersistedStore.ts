/**
 * Generic localStorage-backed store for a group of settings.
 *
 * Reads synchronously on first render (no flash). Merges stored values with
 * defaults so new fields are automatically picked up. When `debounceMs > 0`,
 * returns a separate `debounced` snapshot for expensive computation;
 * otherwise `debounced` is the same reference as `values`.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

export interface PersistedStore<T extends Record<string, any>> {
  values: T;
  debounced: T;
  update: <K extends keyof T>(key: K, value: T[K]) => void;
}

export function usePersistedStore<T extends Record<string, any>>(
  storageKey: string,
  defaults: T,
  debounceMs = 0
): PersistedStore<T> {
  const [values, setValues] = useState<T>(() => {
    if (typeof window === "undefined") return defaults;
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) return defaults;
      const parsed = JSON.parse(stored) as Partial<T>;
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  });

  // Persist on change
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(values));
  }, [storageKey, values]);

  const update = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Debounce only when needed — avoids extra state + effect when debounceMs is 0
  const debounced = useDebouncedValue(values, debounceMs);

  return useMemo(() => ({ values, debounced, update }), [values, debounced, update]);
}

/** Returns `value` delayed by `ms`. When `ms` is 0, returns `value` directly (no extra state). */
function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (ms <= 0) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timerRef.current);
  }, [value, ms]);

  return ms <= 0 ? value : debounced;
}
