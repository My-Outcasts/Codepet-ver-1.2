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

  return (
    <section className="view on" id="v-billing">
      <div className="vhead">
        <h1>Billing &amp; Usage</h1>
        <div className="sub">Your plan and today&apos;s activity.</div>
      </div>

      <div className="set-card">
        <div className="bill-row">
          <div className="set-txt">
            <b>Today&apos;s usage</b>
            <span>
              {failed
                ? "Couldn't load your usage right now."
                : used === null
                  ? 'Loading…'
                  : `You've used ${meter.label} · resets at midnight.`}
            </span>
          </div>
        </div>
        {!failed && used !== null && (
          <div className="bill-meter">
            <i style={{ width: `${meter.pct}%` }} />
          </div>
        )}
      </div>

      <div className="set-card">
        <div className="bill-row">
          <div className="set-txt">
            <b>Plan · Free (beta)</b>
            <span>Pro is coming — more runs, priority byte, and team seats.</span>
          </div>
          <button className="set-link" disabled title="Coming soon">
            Upgrade — coming soon
          </button>
        </div>
      </div>
    </section>
  );
}
