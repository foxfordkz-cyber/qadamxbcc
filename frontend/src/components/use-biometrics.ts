"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { BiometricSensor, type InputField } from "@/lib/biometrics";

export function useBiometrics() {
  const tracker = useRef(new BiometricSensor());
  const completed = useRef(false);
  const [snapshot, setSnapshot] = useState(() => tracker.current.snapshot());
  useEffect(() => {
    const pause = () => { tracker.current.blur("recipient"); tracker.current.blur("amount"); };
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("blur", pause);
    return () => { document.removeEventListener("visibilitychange", pause); window.removeEventListener("blur", pause); };
  }, []);
  const fresh = () => { if (completed.current) { tracker.current.reset(); completed.current = false; } };
  return {
    snapshot,
    context: () => completed.current ? new BiometricSensor().context() : tracker.current.context(),
    complete: () => { completed.current = true; },
    reset: () => { completed.current = false; setSnapshot(tracker.current.reset()); },
    focus: (field: InputField, length: number) => tracker.current.focus(field, length),
    blur: (field: InputField) => tracker.current.blur(field),
    paste: (field: InputField) => { fresh(); setSnapshot(tracker.current.paste(field)); },
    input: (field: InputField, event: ChangeEvent<HTMLInputElement>) => {
      fresh();
      const native = event.nativeEvent as InputEvent;
      setSnapshot(tracker.current.input(field, event.target.value.length, native.inputType ?? "", native.data?.length ?? 0, performance.now()));
    },
  };
}
export type Biometrics = ReturnType<typeof useBiometrics>;
