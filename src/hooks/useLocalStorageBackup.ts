/**
 * Automatic localStorage backup to server.
 *
 * Periodically saves all localStorage data via the backup API.
 * An initial backup fires after a 30s debounce, then every 5 minutes.
 */
import { useEffect, useCallback, useRef } from "react";
import { saveBackup } from "@/lib/localStorage-backup";

const BACKUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const INITIAL_DELAY_MS = 30 * 1000; // 30 seconds

export function useLocalStorageBackup(options?: { enabled?: boolean }): void {
  const { enabled = true } = options ?? {};
  const lastBackupRef = useRef<number>(0);

  const performBackup = useCallback(async () => {
    const success = await saveBackup();
    if (success) {
      lastBackupRef.current = Date.now();
      console.log("[localStorage-backup] Backup saved successfully");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const initialTimer = setTimeout(performBackup, INITIAL_DELAY_MS);
    const interval = setInterval(performBackup, BACKUP_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [enabled, performBackup]);
}
