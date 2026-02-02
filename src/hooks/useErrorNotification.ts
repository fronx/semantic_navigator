/**
 * Hook for managing transient error notifications.
 * Displays errors temporarily, auto-clears after timeout.
 */
import { useState, useCallback, useRef, useEffect } from "react";

export function useErrorNotification(timeout = 8000) {
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const notify = useCallback(
    (message: string) => {
      // Clear any existing timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      setError(message);
      timerRef.current = setTimeout(() => setError(null), timeout);
    },
    [timeout]
  );

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { error, notify, clear };
}
