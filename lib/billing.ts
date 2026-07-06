// Pure helpers for the Billing & Usage view and the Support modal.

export function usageMeter(
  n: number,
  limit: number,
): { used: number; limit: number; pct: number; label: string } {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
  const raw = Number.isFinite(n) && n > 0 ? n : 0;
  // `safeLimit` is 0 for an invalid limit, so Math.min clamps `used` to 0 there too.
  const used = Math.min(raw, safeLimit);
  const pct = safeLimit ? Math.max(0, Math.min(100, Math.round((used / safeLimit) * 100))) : 0;
  return { used, limit: safeLimit, pct, label: `${used} of ${safeLimit} runs` };
}

// The Support message is sendable only when it has real content.
export function canSendSupport(message: string): boolean {
  return message.trim().length > 0;
}
