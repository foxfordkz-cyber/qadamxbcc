"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/contracts";
import { errorKey, type MessageKey } from "@/lib/i18n";

export function useSocPoll<T>(path: string | null, revision: number, interval: number) {
  const [data, setData] = useState<{ path: string; value: T; receivedAt: number } | null>(null);
  const [activity, setActivity] = useState<{ path: string; loading: boolean; error: MessageKey | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      setActivity(previous => ({ path, loading: true, error: previous?.path === path ? previous.error : null }));
      try {
        const value = await api<T>(path, { signal: controller.signal });
        if (!disposed) {
          setData({ path, value, receivedAt: Date.now() });
          setActivity({ path, loading: false, error: null });
        }
      } catch (error) {
        if (!disposed) setActivity({ path, loading: false, error: errorKey(error) });
      } finally {
        clearTimeout(timeout);
        if (!disposed) timer = setTimeout(() => void poll(), interval);
      }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [path, revision, interval]);
  // Tag data and errors by path: a late old request cannot masquerade as the
  // newly selected case, even before the new effect has started.
  return {
    data: data?.path === path ? data.value : null,
    receivedAt: data?.path === path ? data.receivedAt : null,
    error: activity?.path === path ? activity.error : null,
    loading: path !== null && (activity?.path !== path || activity.loading),
  };
}
