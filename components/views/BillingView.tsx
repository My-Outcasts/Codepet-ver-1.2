'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/firebase/auth';
import { loadPeriodCredits } from '@/lib/firebase/companyData';
import { TRIAL_INCLUDED_CREDITS, PRO_INCLUDED_CREDITS } from '@/lib/ai/credits';
import { creditMeter } from '@/lib/billing';

// Plan state isn't persisted yet (credit engine + billing land in roadmap Phase 2/3), so
// the plan and its allowance are placeholders. Defaulting to Trial keeps the meter and the
// card coherent (X / trial-allowance) for this preview; the real plan drives both later.
const PLACEHOLDER_PLAN = 'trial' as const;
const PLACEHOLDER_ALLOWANCE =
  PLACEHOLDER_PLAN === 'trial' ? TRIAL_INCLUDED_CREDITS : PRO_INCLUDED_CREDITS;

export function BillingView() {
  const { companyId } = useAuth();
  const [used, setUsed] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let live = true;
    loadPeriodCredits(companyId)
      .then((c) => live && setUsed(c))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [companyId]);

  const meter = creditMeter(used ?? 0, PLACEHOLDER_ALLOWANCE);

  return (
    <section className="view on" id="v-billing">
      <div className="vhead">
        <h1>Billing &amp; Usage</h1>
        <div className="sub">Your plan and this month&apos;s credits.</div>
      </div>

      <div className="set-body">
        <div className="set-card usage-card">
          <div className="usage-head">
            <b>Credits this month</b>
            {!failed && used !== null && (
              <span className="usage-left">{Math.round(meter.remaining)} left</span>
            )}
          </div>

          {failed ? (
            <span className="usage-note">Couldn&apos;t load your usage right now.</span>
          ) : used === null ? (
            <span className="usage-note">Loading…</span>
          ) : (
            <>
              <div className="usage-stat">
                <span className="usage-n">{Math.round(meter.used)}</span>
                <span className="usage-tot">/ {meter.allowance} credits</span>
              </div>
              <div className="bill-meter">
                <i style={{ width: `${meter.pct}%` }} />
              </div>
              <span className="usage-cap">Renews monthly.</span>
            </>
          )}
        </div>

        <div className="set-card plan-card">
          <div className="bill-row">
            <div className="set-txt">
              <b>Plan · Trial</b>
              <span>
                Upgrade to Pro for {PRO_INCLUDED_CREDITS} credits a month, then metered overage.
              </span>
            </div>
            <span className="upg-soon" title="Coming soon">
              Upgrade to Pro
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
