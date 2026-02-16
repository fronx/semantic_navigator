/**
 * Toggle switch for enabling/disabling offline mode.
 * When offline mode is enabled, all API calls are skipped and only cached data is used.
 */

import { useOfflineMode } from "@/lib/offline-mode";

export function OfflineModeToggle() {
  const [isOffline, setIsOffline] = useOfflineMode();

  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={isOffline}
        onChange={(e) => setIsOffline(e.target.checked)}
        className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
      />
      <span className="text-sm text-zinc-700 dark:text-zinc-300 select-none">
        Offline mode
        {isOffline && <span className="ml-1 text-amber-600 dark:text-amber-400">(active)</span>}
      </span>
    </label>
  );
}
