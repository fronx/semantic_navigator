/**
 * Global offline mode state.
 * When enabled, all APIs will serve data from local JSON files instead of database.
 */

import { useState, useEffect } from "react";

const OFFLINE_MODE_KEY = "offline-mode";

export function isOfflineModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(OFFLINE_MODE_KEY) === "true";
}

export function setOfflineMode(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(OFFLINE_MODE_KEY, enabled.toString());
  // Dispatch event so components can react
  window.dispatchEvent(new CustomEvent("offline-mode-changed", { detail: enabled }));
}

export function useOfflineMode(): [boolean, (enabled: boolean) => void] {
  const [isOffline, setIsOffline] = useState(isOfflineModeEnabled);

  useEffect(() => {
    const handler = (e: Event) => {
      setIsOffline((e as CustomEvent).detail);
    };
    window.addEventListener("offline-mode-changed", handler);
    return () => window.removeEventListener("offline-mode-changed", handler);
  }, []);

  return [isOffline, setOfflineMode];
}
