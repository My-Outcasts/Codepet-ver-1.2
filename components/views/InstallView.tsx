'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { ENV } from '@/lib/data';
import { Byte } from '../Byte';

export function InstallView() {
  const { installed, markInstalled, bump, tick, show } = useApp();
  void tick; // re-read mutable ENV on each store change

  const [started, setStarted] = useState(false);
  const [s1, setS1] = useState(false); // toolkit unpacked
  const [s2, setS2] = useState(false); // byte awake (complete)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const runSetup = () => {
    setStarted(true); setS1(false); setS2(false);
    timers.current.forEach(clearTimeout); timers.current = [];
    timers.current.push(setTimeout(() => {
      ['skills', 'agents'].forEach((k) => ENV[k].forEach((x) => { if (x.rec) x.s = 1; }));
      setS1(true); bump();
    }, 700));
    timers.current.push(setTimeout(() => {
      setS2(true); markInstalled();
    }, 1600));
  };

  const plur = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

  const packSkills = ENV.skills.filter((x) => x.rec).map((x) => x.n);
  const packAgents = ENV.agents.filter((x) => x.rec).map((x) => x.n);
  const connectors = ENV.connectors.filter((x) => x.n === 'GitHub' || x.n === 'Notion');
  const connect = (x: { s: number }) => { x.s = 1; bump(); };

  // Recap: installed on a previous visit and not currently re-running.
  if (installed && !started) {
    const onSkills = ENV.skills.filter((x) => x.s);
    const onAgents = ENV.agents.filter((x) => x.s);
    const onConn = ENV.connectors.filter((x) => x.s);
    return (
      <section className="view on" id="v-install">
        <div className="vhead"><h1>byte is ready</h1><div className="sub">Your toolkit is set up. byte can already do real work with you.</div></div>
        <div className="install">
          <div className="ins-hero">
            <Byte size="s56" className="cheer" />
            <div className="ins-h-txt"><b>byte's awake and ready 🎉</b><span>{plur(onSkills.length, 'skill')} · {plur(onAgents.length, 'agent')} · {plur(onConn.length, 'connector')} active</span></div>
          </div>
          <div className="ins-recap">
            <div className="ins-rcol"><div className="ins-rh">Skills</div>{onSkills.map((x) => <div className="ins-ri" key={x.n}><span className="ck">✓</span>{x.n}</div>)}</div>
            <div className="ins-rcol"><div className="ins-rh">Agents</div>{onAgents.map((x) => <div className="ins-ri" key={x.n}><span className="ck">✓</span>{x.n}</div>)}</div>
            <div className="ins-rcol"><div className="ins-rh">Connectors</div>{onConn.length ? onConn.map((x) => <div className="ins-ri" key={x.n}><span className="ck">✓</span>{x.n}</div>) : <div className="ins-ri muted">None yet</div>}</div>
          </div>
          <div className="ins-acts">
            <button className="ins-link" onClick={runSetup}>Re-run setup</button>
            <button className="ins-link" onClick={() => show('env')}>Manage in Environment →</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="view on" id="v-install">
      <div className="vhead"><h1>Let's wake byte up</h1><div className="sub">One click sets up byte's toolkit so it can start building with you.</div></div>
      <div className="install">
        <div className="ins-hero">
          <Byte size="s56" className={s2 ? 'cheer' : ''} />
          <div className="ins-h-txt">
            <b>{s2 ? "byte’s awake! 🎉" : "Hi, I’m byte 🐣"}</b>
            <span>{s2 ? 'Ready to play: track tokens + plan with you' : "One tap and I’ll wake right up"}</span>
          </div>
        </div>

        <button className="ins-btn" disabled={started} onClick={runSetup}>
          {!started ? '▶ Wake byte up' : !s2 ? 'Setting up…' : '✓ Toolkit ready'}
        </button>

        <div className={`ins-row${started ? ' on' : ''}${s1 ? ' ok' : ''}`}>
          <span className="ins-ic">{s1 ? '✓' : '○'}</span>
          <div className="ins-meta"><b>Unpacking byte's toolkit…</b><span>pulling out the skills you need to build</span></div>
        </div>

        <div className={`ins-pack${s1 ? ' on' : ''}`}>
          <div className="ins-pk-h">byte's toolkit ✨</div>
          <div className="ins-chips">
            {packSkills.map((n) => <span className="ins-chip s" key={n}>skill: {n}</span>)}
            {packAgents.map((n) => <span className="ins-chip a" key={n}>agent: {n}</span>)}
            <span className="ins-chip c">statusline: tokens</span>
            <span className="ins-chip c">hook: session-start</span>
          </div>
        </div>

        <div className={`ins-row${s1 ? ' on' : ''}${s2 ? ' ok' : ''}`}>
          <span className="ins-ic">{s2 ? '✓' : '○'}</span>
          <div className="ins-meta"><b>byte's awake! 🎉</b><span>ready to track tokens + brainstorm with you</span></div>
          {s2 && <span className="ins-tag">ready</span>}
        </div>

        <div className="ins-opt-h">Connect these later — no rush</div>
        {connectors.map((x) => (
          <div className="ins-conn" key={x.n}>
            <span className="ins-conn-ic">{x.ab}</span>
            <div className="ins-meta"><b>{x.n}</b></div>
            {x.s
              ? <span className="ins-conn-on"><span className="ck">✓</span>Connected</span>
              : <button className="ins-conn-btn" onClick={() => connect(x)}>Connect</button>}
          </div>
        ))}

        <button className="ins-skip" onClick={() => show('env')}>Skip → see the full Environment</button>
      </div>
    </section>
  );
}
