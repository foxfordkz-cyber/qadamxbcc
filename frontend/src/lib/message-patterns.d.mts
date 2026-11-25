export const signalCodes: readonly ["bankClaim", "safeAccount", "secrecy", "codeRequest"];
export type MessageSignal = typeof signalCodes[number];
export type SignalMatch = { code: MessageSignal; phrase: string };
export function messageMatches(text: string): SignalMatch[];
export function messageSignals(text: string): MessageSignal[];
