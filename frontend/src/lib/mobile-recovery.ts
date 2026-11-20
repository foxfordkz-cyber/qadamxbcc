import { z } from "zod";
import { answersSchema } from "./contracts";
import type { Answers } from "./contracts";

const draft = z.object({ saved: z.number().finite(), answers: answersSchema.partial() });
const ttl = 24 * 60 * 60 * 1000;
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function mobileRecovery(scope: string, storage: () => Store, now = Date.now) {
  const prefix = `saqbol.client.v1.${scope}.`;
  function key(id: string) {
    if (!z.uuid().safeParse(id).success) throw new Error("invalid transaction");
    return prefix + id;
  }
  return {
    selection() {
      try { return z.uuid().safeParse(storage().getItem(prefix + "selected")).data ?? null; }
      catch { return null; }
    },
    select(id: string | null) {
      try {
        if (id) { key(id); storage().setItem(prefix + "selected", id); }
        else storage().removeItem(prefix + "selected");
      } catch { /* The existing receipt list still supports manual recovery. */ }
    },
    read(id: string) {
      try {
        const raw = storage().getItem(key(id));
        if (!raw) return null;
        const item = draft.safeParse(JSON.parse(raw));
        if (item.success && item.data.saved <= now() && now() - item.data.saved < ttl) return item.data.answers;
        storage().removeItem(key(id));
      } catch { /* A damaged draft must not prevent opening the server receipt. */ }
      return null;
    },
    save(id: string, answers: Partial<Answers> | null) {
      try {
        if (answers) storage().setItem(key(id), JSON.stringify({ saved: now(), answers: answersSchema.partial().parse(answers) }));
        else storage().removeItem(key(id));
        return true;
      } catch { return false; }
    },
  };
}
