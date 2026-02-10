/**
 * Compact localStorage backup controls - save and restore buttons.
 */
import { useState, useEffect, useRef } from "react";
import { ArrowUpTrayIcon, ArrowUturnLeftIcon } from "@heroicons/react/24/outline";
import {
  type BackupListItem,
  saveBackup,
  listBackups,
  restoreBackup,
} from "@/lib/localStorage-backup";

export function BackupManager() {
  const [backups, setBackups] = useState<BackupListItem[]>([]);
  const [restoring, setRestoring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showRestoreMenu, setShowRestoreMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Load backup list when menu opens
  useEffect(() => {
    if (showRestoreMenu) {
      listBackups().then(setBackups);
    }
  }, [showRestoreMenu]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!showRestoreMenu) return;

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowRestoreMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showRestoreMenu]);

  async function handleSaveNow() {
    setSaving(true);
    const success = await saveBackup();
    if (!success) alert("Failed to save backup");
    if (showRestoreMenu) listBackups().then(setBackups);
    setSaving(false);
  }

  async function handleRestore(backupId: number) {
    if (!confirm("This will replace all current settings. Continue?")) return;

    setRestoring(true);
    setShowRestoreMenu(false);
    const success = await restoreBackup(backupId);

    if (success) {
      alert("Backup restored! Reloading page...");
      window.location.reload();
    } else {
      alert("Failed to restore backup");
      setRestoring(false);
    }
  }

  return (
    <div className="relative flex gap-1 px-3 py-2 border-b border-zinc-200 dark:border-zinc-700" ref={menuRef}>
      <button
        onClick={handleSaveNow}
        disabled={saving}
        className="w-7 h-7 flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-all"
        title="Save backup now"
      >
        <ArrowUpTrayIcon className={`w-4 h-4 ${saving ? "animate-pulse" : ""}`} />
      </button>

      <button
        onClick={() => setShowRestoreMenu(!showRestoreMenu)}
        disabled={restoring}
        className="w-7 h-7 flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-all"
        title="Restore from backup"
      >
        <ArrowUturnLeftIcon className={`w-4 h-4 ${restoring ? "animate-pulse" : ""}`} />
      </button>

      {showRestoreMenu && (
        <div className="absolute top-12 left-2 w-48 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-md shadow-lg dark:shadow-2xl z-50">
          <div className="px-3 py-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
            Restore Backup
          </div>
          {backups.length === 0 ? (
            <div className="px-3 py-4 text-sm text-zinc-500 dark:text-zinc-400 text-center">
              No backups yet
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {backups.slice(0, 10).map((backup) => (
                <button
                  key={backup.id}
                  onClick={() => handleRestore(backup.id)}
                  className="w-full px-3 py-2 text-sm text-left text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  disabled={restoring}
                >
                  {formatDate(backup.created_at)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateString).toLocaleDateString();
}
