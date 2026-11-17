"use client";

import { useEffect, useRef, useState } from "react";
import type { AppConfig } from "@/lib/contracts";
import { errorKey, type MessageKey } from "@/lib/i18n";
import { isUnknownOutcome, TransferAttempt } from "@/lib/transfer-session";
import { trafficScenario, type TrafficRecord } from "@/lib/traffic";

/** Lives above the tabs: stopping the stream drains an accepted request instead of discarding it. */
export function useTrafficStream(config: AppConfig, onRecord: (record: TrafficRecord) => void, onPending: (id: string) => void, onRejected: (id: string) => void) {
  const [active, setActive] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const attempts = useRef(0);
  const occupied = useRef(false);
  const canStart = config.demoActionsEnabled !== false && trafficScenario(config.trafficAccounts ?? [], 0, config.presets) !== null && attempts.current < 200;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      if (stopped || occupied.current) return;
      if (attempts.current >= 200) { setError("trafficLimit"); setActive(false); return; }
      const scenario = trafficScenario(config.trafficAccounts ?? [], attempts.current++, config.presets);
      if (!scenario) { setError("trafficMissing"); setActive(false); return; }
      const attempt = new TransferAttempt(scenario.input);
      occupied.current = true; setInFlight(true); onPending(attempt.input.request_id!);
      try {
        const evaluation = await attempt.execute().catch(async failure => {
          if (!isUnknownOutcome(failure)) throw failure;
          return attempt.execute();
        });
        onRecord({ evaluation, amount: scenario.input.amount, from: scenario.from, to: scenario.to });
      } catch (failure) {
        if (!isUnknownOutcome(failure)) onRejected(attempt.input.request_id!);
        setError(isUnknownOutcome(failure) ? "outcomeUnknown" : errorKey(failure)); setActive(false);
      } finally {
        occupied.current = false; setInFlight(false);
        if (!stopped) timer = setTimeout(() => void tick(), 2500);
      }
    }
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [active, config, onRecord, onPending, onRejected]);
  return { active, inFlight, error, canStart, stop: () => setActive(false), toggle: () => { if (!active && (!canStart || occupied.current)) return; setError(null); setActive(value => !value); } };
}
export type TrafficStream = ReturnType<typeof useTrafficStream>;
