'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/firebase/auth';
import { loadTodayUsage } from '@/lib/firebase/companyData';
import { DEFAULT_DAILY_LIMIT } from '@/lib/ai/rateLimit';
import { usageMeter } from '@/lib/billing';

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
      </div>
    </section>
  );
}
