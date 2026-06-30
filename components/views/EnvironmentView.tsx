'use client';
import { useApp } from '@/lib/store';
import { ENV, ENV_CATS, ENV_META } from '@/lib/data';
import { Byte } from '../Byte';

export function EnvironmentView() {
  const { bump, tick } = useApp();
  void tick;

  const toggle = (k: string, i: number) => {
    ENV[k][i].s = ENV[k][i].s ? 0 : 1;
    bump();
  };

  const recs: Array<{ k: string; i: number; x: (typeof ENV)[string][number] }> = [];
  ['skills', 'connectors', 'agents'].forEach((k) =>
    ENV[k].forEach((x, i) => {
      if (x.rec) recs.push({ k, i, x });
    }),
  );
  const needYou = recs.filter((r) => !r.x.s && r.k === 'connectors').length;

  return (
    <section className="view on" id="v-env">
      <div className="vhead">
        <h1>Your Claude Code environment</h1>
        <div className="sub">
          Set up byte&apos;s toolkit — skills, connectors, and agents — so it can do more of the
          work for you.
        </div>
      </div>
      <div className="envwrap">
        <div className="env-byte">
          <Byte size="s28" />
          <div className="txt">
            Based on your <b>beta launch</b>, here&apos;s the toolkit I&apos;d set up. I&apos;ve
            turned on the skills and agents I can
            {needYou
              ? ` — you just need to connect ${needYou} account${needYou > 1 ? 's' : ''}.`
              : '.'}
          </div>
        </div>

        <div className="env-sech">Recommended for your project</div>
        <div className="erec">
          {recs.map(({ k, i, x }) => {
            const m = ENV_META[k];
            const needsYou = k === 'connectors';
            return (
              <div
                className="rcard"
                key={`${k}-${i}`}
                style={{ ['--rc' as string]: `var(${m.col})` }}
              >
                <div className="rc-top">
                  <span className="rc-ic">{x.ab}</span>
                  <span className="rc-cat">{m.label}</span>
                </div>
                <div className="rc-n">{x.n}</div>
                <div className="rc-why">{x.why || x.d}</div>
                <div className="rc-act">
                  {x.s ? (
                    <span className="rc-done">
                      <span className="ck">✓</span>
                      {m.on}
                    </span>
                  ) : (
                    <>
                      <button className="rc-btn" onClick={() => toggle(k, i)}>
                        {m.add}
                      </button>
                      {needsYou && <span className="rc-you">needs you</span>}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="env-sech" style={{ marginTop: 36 }}>
          Browse all
        </div>
        <div className="ebrowse">
          {ENV_CATS.map(([key, label, cls, addL, onL]) => {
            const items = ENV[key];
            const on = items.filter((x) => x.s).length;
            return (
              <div className="ereg" key={key}>
                <div className="ereg-h">
                  <span className="t">{label}</span>
                  <span className="c">
                    {on}/{items.length}
                  </span>
                </div>
                <div className="env-card">
                  {items.map((x, i) => (
                    <div className={`erow ec-${cls}`} key={i}>
                      <div className="eic">{x.ab}</div>
                      <div className="en">{x.n}</div>
                      <button className={`eb${x.s ? ' on' : ''}`} onClick={() => toggle(key, i)}>
                        {x.s ? (
                          <>
                            <span className="ck">✓</span>
                            {onL}
                          </>
                        ) : (
                          addL
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
