/**
 * Shared client-side utilities for localStorage backup operations.
 * Used by both the auto-backup hook and the BackupManager UI component.
 */

export interface BackupListItem {
  id: number;
  created_at: string;
  keys: string[];
  size_bytes: number;
}

export interface BackupRecord extends BackupListItem {
  data: Record<string, string>;
}

/** Snapshot all localStorage entries into a plain object. */
export function getLocalStorageData(): Record<string, string> {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key);
      if (value !== null) {
        data[key] = value;
      }
    }
  }
  return data;
}

/** Save a backup to the server. Returns true on success. */
export async function saveBackup(): Promise<boolean> {
  const response = await fetch("/api/localStorage-backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getLocalStorageData()),
  });
  return response.ok;
}

/** List available backups (most recent first). */
export async function listBackups(): Promise<BackupListItem[]> {
  const response = await fetch("/api/localStorage-backup");
  if (!response.ok) return [];
  const { backups } = await response.json();
  return backups;
}

/** Restore localStorage from a specific backup. Returns true on success. */
export async function restoreBackup(backupId: number): Promise<boolean> {
  const response = await fetch(`/api/localStorage-backup?id=${backupId}`);
  if (!response.ok) return false;

  const backup: BackupRecord = await response.json();
  localStorage.clear();
  for (const [key, value] of Object.entries(backup.data)) {
    localStorage.setItem(key, value);
  }
  return true;
}
