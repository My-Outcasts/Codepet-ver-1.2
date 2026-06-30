'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { Byte } from '../Byte';
import {
  getCapability, getToolkit, getStatus,
  installToolkit, uninstallToolkit, getInstallCommand,
} from '@/app/actions/install';

type Cap = { mode: 'local' | 'remote'; reason: string };
type Item = { id: string; name: string; type: 'skill' | 'agent'; source: string; desc: string };
type Status = { id: string; installed: boolean; target: string };
type Result = { id: string; name: string; type: string; target: string; status: string; error?: string };

export function InstallView() {
  const { setInstalled, show } = useApp();
  const [cap, setCap] = useState<Cap | null>(null);
  const [toolkit, setToolkit] = useState<Item[]>([]);
  const [status, setStatus] = useState<Status[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = async () => {
    const [c, t, s] = await Promise.all([getCapability(), getToolkit(), getStatus()]);
    setCap(c as Cap); setToolkit(t as Item[]); setStatus(s as Status[]);
    // store `installed` = "any toolkit item installed" (coarse); the view uses `allInstalled` for the full-set gate
    setInstalled(s.some((x) => x.installed));
    if (c.mode === 'remote') setCmd(await getInstallCommand(t.map((i) => i.id)));
  };
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const ids = toolkit.map((i) => i.id);
  const installedSet = new Set(status.filter((s) => s.installed).map((s) => s.id));
  const allInstalled = toolkit.length > 0 && ids.every((id) => installedSet.has(id));

  const run = async () => {
    setBusy(true);
    try {
      const res = await installToolkit(ids);
      if (res.ok) setResults(res.results);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await uninstallToolkit(ids);
      setResults(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const statusClass = (s: string) => (s === 'error' ? ' err' : ' done');
  const statusIcon = (s: string) => (s === 'error' ? '✗' : '✓');

  return (
    <section className="view on" id="v-install">
      <div className="vhead">
        <h1>{allInstalled ? 'byte is ready' : "Let's wake byte up"}</h1>
        <div className="sub">
          {cap?.mode === 'remote'
            ? "Hosted preview — copy the command below to install byte's toolkit on your machine."
            : "One click installs byte's toolkit into ~/.claude on this machine."}
        </div>
      </div>
      <div className="install">
        <div className="ins-hero">
          <Byte size="s56" className={allInstalled ? 'cheer' : ''} />
          <div className="ins-h-txt">
            <b>{allInstalled ? "byte's awake! 🎉" : "Hi, I'm byte 🐣"}</b>
            <span>
              {allInstalled
                ? `${installedSet.size} item${installedSet.size === 1 ? '' : 's'} installed in ~/.claude`
                : "I'll set up real skills + agents you can use right away"}
            </span>
          </div>
        </div>

        {cap === null && <div className="ins-row on"><span className="ins-ic">○</span><div className="ins-meta"><b>Checking your environment…</b></div></div>}

        {cap?.mode === 'local' && (
          <>
            {!allInstalled
              ? <button className="ins-btn" disabled={busy} onClick={run}>{busy ? 'Installing…' : '▶ Wake byte up'}</button>
              : <button className="ins-btn" disabled={busy} onClick={remove}>{busy ? 'Removing…' : 'Uninstall toolkit'}</button>}

            {(results ?? toolkit.map((i) => ({ id: i.id, name: i.name, type: i.type, target: '', status: installedSet.has(i.id) ? 'installed' : 'pending' } as Result))).map((r) => (
              <div className={`ins-row on${r.status === 'pending' ? '' : statusClass(r.status)}`} key={r.id}>
                <span className="ins-ic">{r.status === 'pending' ? '○' : statusIcon(r.status)}</span>
                <div className="ins-meta">
                  <b>{r.name} <span className="ins-kind">{r.type}</span></b>
                  <span>{r.status === 'error' ? r.error : (r.target || `will install to ~/.claude/${r.type === 'skill' ? 'skills' : 'agents'}`)}</span>
                </div>
                {r.status !== 'pending' && <span className={`ins-tag${r.status === 'error' ? ' err' : ''}`}>{r.status}</span>}
              </div>
            ))}
          </>
        )}

        {cap?.mode === 'remote' && (
          <div className="ins-cmd">
            <div className="ins-cmd-h">Run this from your Codepet repo to install byte's toolkit:</div>
            <div className="ins-cmd-box"><code>{cmd}</code><button className="ins-cmd-copy" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button></div>
          </div>
        )}

        <div className="ins-opt-h">Set up later — no rush</div>
        <div className="ins-pack on">
          <div className="ins-pk-h">optional extras ✨</div>
          <div className="ins-chips">
            <span className="ins-chip c">statusline: tokens</span>
            <span className="ins-chip c">hook: session-start</span>
            <span className="ins-chip">connector: GitHub</span>
            <span className="ins-chip">connector: Notion</span>
          </div>
        </div>

        <button className="ins-skip" onClick={() => show('env')}>Skip → see the full Environment</button>
      </div>
    </section>
  );
}
