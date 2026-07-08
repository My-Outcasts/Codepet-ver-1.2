'use client';
// Research — byte's deep research overview of the founder's product. One model call
// (app/actions/research) turns the company brief into a summary, key findings, key
// sources to explore, and suggested next steps. The result is cached module-level so
// tab switches don't re-spend tokens; "Run again" forces a fresh pass. Styling reuses
// the light-theme tokens; see the .res-* rules in globals.css.
import { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { briefToContext } from '@/lib/ai/brief';
import { generateResearchOverview } from '@/app/actions/research';
import type { ResearchOverview } from '@/lib/ai/researchOverview';
import { Byte } from '../Byte';

// Survives view unmount (tab switches) but not a reload — good enough as a token guard.
let cached: ResearchOverview | null = null;

const ERROR_COPY: Record<string, string> = {
  no_brief: 'Tell byte about your product first (finish onboarding) and research unlocks.',
  not_configured: 'The AI key is not set up on the server yet.',
  billing: 'byte is temporarily unavailable — please try again later.',
};

export function ResearchView() {
  const { brief } = useApp();
  const [overview, setOverview] = useState<ResearchOverview | null>(cached);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const context = briefToContext(brief);
    if (!context) {
      setError('no_brief');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await generateResearchOverview(context);
    setLoading(false);
    if (res.ok) {
      cached = res.overview;
      setOverview(res.overview);
    } else {
      setError(res.error);
    }
  };

  // Auto-run once per session; afterwards the cache serves tab switches.
  // Deferred to a microtask so no state is set synchronously inside the effect.
  useEffect(() => {
    if (!cached) Promise.resolve().then(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="view on" id="v-research">
      <div className="vhead">
        <h1>Research</h1>
        <div className="sub">Byte&apos;s got your research overview</div>
      </div>

      {loading && (
        <div className="res-status">
          <Byte size="s28" />
          <span>byte is researching your market…</span>
        </div>
      )}

      {!loading && error && (
        <div className="res-status">
          <Byte size="s28" />
          <span>{ERROR_COPY[error] ?? "byte couldn't finish the research — try again."}</span>
          {error !== 'no_brief' && (
            <button className="res-btn" onClick={() => void run()}>
              Try again
            </button>
          )}
        </div>
      )}

      {!loading && !error && overview && (
        <div className="res-body">
          <div className="res-hero">
            <Byte size="s28" />
            <p>{overview.summary}</p>
          </div>

          {overview.findings.length > 0 && (
            <div className="res-sec">
              <h2>Key findings</h2>
              <ul>
                {overview.findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          {overview.sources.length > 0 && (
            <div className="res-sec">
              <h2>Key sources to explore</h2>
              <div className="res-sources">
                {overview.sources.map((s, i) => (
                  <div className="res-source" key={i}>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.name}
                      </a>
                    ) : (
                      <b>{s.name}</b>
                    )}
                    <span>{s.why}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {overview.nextSteps.length > 0 && (
            <div className="res-sec">
              <h2>Suggested next steps</h2>
              <ul>
                {overview.nextSteps.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          <button className="res-btn" onClick={() => void run()}>
            Run again
          </button>
        </div>
      )}
    </section>
  );
}
