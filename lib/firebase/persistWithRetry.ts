const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Best-effort persistence that survives a transient blip and, if it ultimately can't save,
// tells the user honestly instead of swallowing the loss. Retries `write` with exponential
// backoff; on final failure logs + shows `failMessage`. Never rejects — callers fire-and-forget.
export async function persistWithRetry(
  write: () => Promise<void>,
  opts: {
    toast: (msg: string) => void;
    failMessage: string;
    label: string; // for the console log only
    retries?: number; // default 2 (→ 3 attempts total)
    baseDelayMs?: number; // default 400 (tests pass 0)
  },
): Promise<void> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 400;
  for (let attempt = 0; ; attempt++) {
    try {
      await write();
      return;
    } catch (err) {
      if (attempt >= retries) {
        console.error(`[persist] ${opts.label} failed after ${attempt + 1} attempts`, err);
        opts.toast(opts.failMessage);
        return;
      }
      await sleep(baseDelayMs * 2 ** attempt); // 400ms, 800ms
    }
  }
}
