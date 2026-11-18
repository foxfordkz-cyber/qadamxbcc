"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeRecovery, persistLegacyRecovery, readRecovery, recoveryKey, saveRecovery, type RecoveryRecord } from "@/lib/recovery";
import { readPending } from "@/lib/transfer-session";

function browserStorage() { try { return window.localStorage; } catch { return undefined; } }
export function useRecovery() {
  const [records, setRecords] = useState<RecoveryRecord[]>([]);
  const current = useRef<RecoveryRecord[]>([]);
  const [persisted, setPersisted] = useState(true);
  const refresh = useCallback(() => {
    const next = mergeRecovery(current.current, readRecovery(browserStorage()));
    current.current = next; setRecords(next); return next;
  }, []);
  const commit = useCallback((entry: RecoveryRecord) => {
    const result = saveRecovery(mergeRecovery(current.current, [entry]), browserStorage());
    setPersisted(result.persisted);
    if (!result.persisted) return false;
    current.current = result.records; setRecords(result.records); return result.persisted;
  }, []);
  const record = useCallback((entry: RecoveryRecord, requireDurable = false) => {
    // Reservations already own the Web Lock and must persist before sending.
    if (requireDurable) return commit(entry);
    // Receipts remain visible immediately; serialize their writes too so another
    // tab's newly reserved ID cannot be overwritten by a stale read/modify/write.
    const next = mergeRecovery(current.current, [entry]); current.current = next; setRecords(next);
    void withIntentLock(() => commit(entry)).catch(() => setPersisted(false));
    return true;
  }, [commit]);
  useEffect(() => {
    const previous = refresh();
    try {
      const ids = readPending(window.sessionStorage);
      if (ids.length) {
        const migrated = ids.filter(id => !previous.some(item => item.id === id)).map(id => ({ id, state: "unknown" as const, updatedAt: Date.now() }));
        const visible = mergeRecovery(current.current, migrated); current.current = visible; setRecords(visible);
        void withIntentLock(() => {
          const result = persistLegacyRecovery(current.current, browserStorage(), window.sessionStorage);
          setPersisted(result.persisted);
          if (result.persisted) { current.current = result.records; setRecords(result.records); }
        }).catch(() => setPersisted(false));
      }
    } catch { setPersisted(false); }
    const changed = (event: StorageEvent) => { if (event.key === recoveryKey || event.key === null) refresh(); };
    window.addEventListener("storage", changed);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener("focus", refresh); };
  }, [record, refresh]);
  return { records, persisted, refresh, record, get: useCallback(() => current.current, []) };
}

/** Serializes intent reservation across tabs before any bank request is sent. */
export async function withIntentLock<T>(operation: () => Promise<T> | T, manager: Pick<LockManager, "request"> | null = typeof navigator !== "undefined" ? navigator.locks ?? null : null): Promise<T> {
  if (!manager) throw new Error("recoveryUnavailable");
  return manager.request("bcc-shield.transfer-intent.v2", operation);
}
