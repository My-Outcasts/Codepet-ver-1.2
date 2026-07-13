'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/firebase/auth';
import { loadTodayUsage } from '@/lib/firebase/companyData';
import { DEFAULT_DAILY_LIMIT } from '@/lib/ai/rateLimit';
import { usageMeter } from '@/lib/billing';
import { getByok, setByok, clearByok, type ByokStatus } from '@/lib/ai/byokClient';

export function BillingView() {
  const { companyId } = useAuth();
  const [used, setUsed] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let live = true;
    loadTodayUsage(companyId)
      .then((n) => live && setUsed(n))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [companyId]);

  const meter = usageMeter(used ?? 0, DEFAULT_DAILY_LIMIT);
  const remaining = Math.max(0, meter.limit - meter.used);

  return (
    <section className="view on" id="v-billing">
      <div className="vhead">
        <h1>Billing &amp; Usage</h1>
        <div className="sub">Your plan and today&apos;s activity.</div>
      </div>

      <div className="set-body">
        <div className="set-card usage-card">
          <div className="usage-head">
            <b>Today&apos;s usage</b>
            {!failed && used !== null && <span className="usage-left">{remaining} left</span>}
          </div>

          {failed ? (
            <span className="usage-note">Couldn&apos;t load your usage right now.</span>
          ) : used === null ? (
            <span className="usage-note">Loading…</span>
          ) : (
            <>
              <div className="usage-stat">
                <span className="usage-n">{meter.used}</span>
                <span className="usage-tot">/ {meter.limit} runs</span>
              </div>
              <div className="bill-meter">
                <i style={{ width: `${meter.pct}%` }} />
              </div>
              <span className="usage-cap">Resets at midnight.</span>
            </>
          )}
        </div>

        <div className="set-card plan-card">
          <div className="bill-row">
            <div className="set-txt">
              <b>Plan · Free (beta)</b>
              <span>Pro is coming — more runs, priority byte, and team seats.</span>
            </div>
            <span className="upg-soon" title="Coming soon">
              Upgrade — coming soon
            </span>
          </div>
        </div>

        <ByokCard />
      </div>
    </section>
  );
}

// Bring-your-own-key: run byte on your OWN Anthropic key (your credits, no daily cap). The key is
// validated, encrypted, and stored server-side — it's never shown again (only its last 4). Entering
// a real key is the founder's action; nothing here logs or echoes it back.
function ByokCard() {
  const [byok, setByokState] = useState<ByokStatus | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    getByok().then((s) => live && setByokState(s));
    return () => {
      live = false;
    };
  }, []);

  const save = async () => {
    const k = key.trim();
    if (!k) return;
    setBusy(true);
    setMsg(null);
    const res = await setByok(k);
    setBusy(false);
    if (res.ok) {
      setKey('');
      setByokState({ present: true, last4: res.last4, status: res.status as ByokStatus['status'] });
      setMsg({
        kind: 'ok',
        text:
          res.status === 'valid'
            ? 'Key saved and verified. byte now runs on your key — no daily cap.'
            : 'Key saved. We couldn’t fully verify it, but byte will use it.',
      });
    } else {
      setMsg({ kind: 'err', text: res.message || 'Couldn’t save that key.' });
    }
  };

  const remove = async () => {
    setBusy(true);
    setMsg(null);
    const ok = await clearByok();
    setBusy(false);
    if (ok) {
      setByokState({ present: false });
      setMsg({ kind: 'ok', text: 'Removed. byte is back on the shared key (daily cap applies).' });
    } else {
      setMsg({ kind: 'err', text: 'Couldn’t remove the key.' });
    }
  };

  const label = { fontSize: 12, color: 'var(--t-3)' } as const;
  return (
    <div className="set-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="set-txt" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b>Your Claude API key</b>
        <span style={label}>
          Run byte on your own Anthropic key — your credits, no daily cap. Stored encrypted; we only
          ever show the last 4 digits.
        </span>
      </div>

      {byok === null ? (
        <span style={label}>Loading…</span>
      ) : byok.present ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: 'var(--mono, monospace)',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--t-1)',
            }}
          >
            sk-ant-…{byok.last4}
          </span>
          {byok.status === 'valid' && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>Verified</span>
          )}
          {byok.status === 'unchecked' && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706' }}>Unverified</span>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--sans)',
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--t-2)',
              background: 'var(--surface)',
              border: '1px solid var(--hairline)',
              borderRadius: 8,
              padding: '6px 12px',
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void save();
              }
            }}
            style={{
              flex: '1 1 240px',
              minWidth: 0,
              fontFamily: 'var(--mono, monospace)',
              fontSize: 13,
              padding: '8px 11px',
              borderRadius: 8,
              border: '1px solid var(--hairline)',
              background: 'var(--surface)',
              color: 'var(--t-1)',
            }}
          />
          <button
            type="button"
            onClick={save}
            disabled={busy || !key.trim()}
            style={{
              flex: 'none',
              fontFamily: 'var(--sans)',
              fontSize: 12.5,
              fontWeight: 700,
              color: 'var(--on-accent)',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 8,
              padding: '8px 16px',
              cursor: busy || !key.trim() ? 'default' : 'pointer',
              opacity: busy || !key.trim() ? 0.6 : 1,
            }}
          >
            {busy ? 'Checking…' : 'Save key'}
          </button>
        </div>
      )}

      {msg && (
        <span style={{ fontSize: 11.5, color: msg.kind === 'ok' ? '#16a34a' : '#dc2626' }}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
