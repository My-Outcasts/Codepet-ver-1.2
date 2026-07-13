'use client';
// Client calls for the BYOK endpoint. The raw key only ever travels on the POST body over HTTPS;
// the server never sends it back — responses carry only a masked last4 + status.
import { authHeader } from './runTask';

export interface ByokStatus {
  present: boolean;
  last4?: string;
  status?: 'valid' | 'invalid' | 'unchecked';
  checkedAt?: number;
}

export async function getByok(): Promise<ByokStatus> {
  try {
    const res = await fetch('/api/byok', { headers: { ...(await authHeader()) } });
    if (!res.ok) return { present: false };
    return (await res.json()) as ByokStatus;
  } catch {
    return { present: false };
  }
}

export async function setByok(
  key: string,
): Promise<{ ok: boolean; status?: string; last4?: string; error?: string; message?: string }> {
  const res = await fetch('/api/byok', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ key }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, ...data };
}

export async function clearByok(): Promise<boolean> {
  try {
    const res = await fetch('/api/byok', {
      method: 'DELETE',
      headers: { ...(await authHeader()) },
    });
    return res.ok;
  } catch {
    return false;
  }
}
