"use client";
import { useRef, useState, type ChangeEvent } from "react";
import { BiometricSensor, type InputField } from "@/lib/biometrics";

export function useBiometrics() {
  const tracker = useRef(new BiometricSensor());
  const [snapshot, setSnapshot] = useState(() => tracker.current.snapshot());
  return {
    snapshot,
    context: () => tracker.current.context(),
    reset: () => setSnapshot(tracker.current.reset()),
    focus: (field: InputField, length: number) => tracker.current.focus(field, length),
    blur: (field: InputField) => tracker.current.blur(field),
    paste: (field: InputField) => setSnapshot(tracker.current.paste(field)),
    input: (field: InputField, event: ChangeEvent<HTMLInputElement>) => {
      const native = event.nativeEvent as InputEvent;
      setSnapshot(tracker.current.input(field, event.target.value.length, native.inputType ?? "", native.data?.length ?? 0, performance.now()));
    },
  };
}
export type Biometrics = ReturnType<typeof useBiometrics>;
