/** Bound untrusted data before JSON.parse/Zod; Content-Length alone is insufficient. */
export class RequestBodyError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export async function readBoundedJson(request: Request, maxBytes = 16_384, timeoutMs = 10_000): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/.test(length)) throw new RequestBodyError(400, "invalid");
  if (length !== null && Number(length) > maxBytes) throw new RequestBodyError(413, "requestTooLarge");
  if (!request.body) throw new RequestBodyError(422, "invalid");
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new RequestBodyError(413, "requestTooLarge");
      }
      chunks.push(chunk.value);
    }
    if (length !== null && bytes !== Number(length)) throw new RequestBodyError(400, "invalid");
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)) as unknown; }
    catch { throw new RequestBodyError(422, "invalid"); }
  };
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        reject(new RequestBodyError(408, "apiError"));
        void reader.cancel().catch(() => {});
      }, timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
    try { reader.releaseLock(); } catch { /* A timed-out read is being cancelled. */ }
  }
}
