'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { useAuth } from '@/lib/firebase/auth';
import { ensureIngestToken } from '@/lib/firebase/companyData';
import { Byte } from './Byte';
import {
  getCapability,
  getToolkit,
  getStatus,
  installToolkit,
  uninstallToolkit,
  getInstallCommand,
} from '@/app/actions/install';

// The one-time "wake byte up" popup — the former First-install view, now a modal.
// Auto-opens once for a fresh account (see the store's install-prompt effect);
// afterwards the Topbar "⚡ Wake byte up" pill (and Settings) reopen it. Closing it
// any way marks the prompt as seen. One-click install in local mode; a copy-paste
// command in the hosted preview. See
// docs/superpowers/specs/2026-07-07-install-popup-design.md.

type Cap = { mode: 'local' | 'remote'; reason: string };
type Item = { id: string; name: string; type: 'skill' | 'agent'; source: string; desc: string };
type Status = { id: string; installed: boolean; target: string };
type Result = {
  id: string;
  name: string;
  type: string;
  target: string;
  status: string;
  error?: string;
};

export function InstallModal() {
  const { installPromptOpen, closeInstallPrompt, setInstalled } = useApp();
  const { companyId } = useAuth();
  const [cap, setCap] = useState<Cap | null>(null);
  const [toolkit, setToolkit] = useState<Item[]>([]);
  const [status, setStatus] = useState<Status[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The config the installed tracker needs to report activity: the company's ingest
  // token (minted on demand) + this app's origin (which also hosts /api/track).
  // undefined when signed-out — install then proceeds without the tracker.
  const trackingConfig = async () => {
    if (!companyId) return undefined;
    try {
      return {
        companyId,
        token: await ensureIngestToken(companyId),
        apiUrl: window.location.origin,
      };
    } catch {
      return undefined;
    }
  };

  const refresh = async () => {
    const [c, t, s] = await Promise.all([getCapability(), getToolkit(), getStatus()]);
    setCap(c as Cap);
    setToolkit(t as Item[]);
    setStatus(s as Status[]);
    // store `installed` = "any toolkit item installed" (coarse); this modal uses
    // `allInstalled` for the full-set gate.
    setInstalled(s.some((x) => x.installed));
    // The copied CLI command carries the tracker config so remote installs auto-track too.
    if (c.mode === 'remote')
      setCmd(
        await getInstallCommand(
          t.map((i) => i.id),
          await trackingConfig(),
        ),
      );
  };
  // Load fresh state each time the popup opens (it stays mounted while closed).
  // Deferred to a microtask so no state is set synchronously inside the effect.
  useEffect(() => {
    if (installPromptOpen) Promise.resolve().then(refresh);
  }, [installPromptOpen, companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  if (!installPromptOpen) return null;

  const ids = toolkit.map((i) => i.id);
  const installedSet = new Set(status.filter((s) => s.installed).map((s) => s.id));
  const allInstalled = toolkit.length > 0 && ids.every((id) => installedSet.has(id));

  const run = async () => {
    setBusy(true);
    try {
      const res = await installToolkit(ids, await trackingConfig());
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
    <div className="so-overlay" onClick={() => !busy && closeInstallPrompt()}>
      <div className="so-modal ins-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ins-hero">
          <Byte size="s56" className={allInstalled ? 'cheer' : ''} />
          <div className="ins-h-txt">
            <b>{allInstalled ? "byte's awake! 🎉" : "Hi, I'm byte 🐣"}</b>
            <span>
              {allInstalled
                ? `${installedSet.size} item${installedSet.size === 1 ? '' : 's'} installed in ~/.claude`
                : 'One click sets up real skills + agents you can use right away — and turns on activity tracking to your Summary.'}
            </span>
          </div>
        </div>

        {cap === null && (
          <div className="ins-row on">
            <span className="ins-ic">○</span>
            <div className="ins-meta">
              <b>Checking your environment…</b>
            </div>
          </div>
        )}

        {cap?.mode === 'local' && (
          <>
            {!allInstalled ? (
              <button className="ins-btn" disabled={busy} onClick={run}>
                {busy ? 'Installing…' : '▶ Wake byte up'}
              </button>
            ) : (
              <button className="ins-btn" disabled={busy} onClick={remove}>
                {busy ? 'Removing…' : 'Uninstall toolkit'}
              </button>
            )}

            <div className="ins-modal-list">
              {(
                results ??
                toolkit.map(
                  (i) =>
                    ({
                      id: i.id,
                      name: i.name,
                      type: i.type,
                      target: '',
                      status: installedSet.has(i.id) ? 'installed' : 'pending',
                    }) as Result,
                )
              ).map((r) => (
                <div
                  className={`ins-row on${r.status === 'pending' ? '' : statusClass(r.status)}`}
                  key={r.id}
                >
                  <span className="ins-ic">
                    {r.status === 'pending' ? '○' : statusIcon(r.status)}
                  </span>
                  <div className="ins-meta">
                    <b>
                      {r.name} <span className="ins-kind">{r.type}</span>
                    </b>
                    <span>
                      {r.status === 'error'
                        ? r.error
                        : r.target ||
                          `will install to ~/.claude/${r.type === 'skill' ? 'skills' : 'agents'}`}
                    </span>
                  </div>
                  {r.status !== 'pending' && (
                    <span className={`ins-tag${r.status === 'error' ? ' err' : ''}`}>
                      {r.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {cap?.mode === 'remote' && (
          <div className="ins-cmd">
            <div className="ins-cmd-h">
              Hosted preview — run this from your Codepet repo to install byte&apos;s toolkit:
            </div>
            <div className="ins-cmd-box">
              <code>{cmd}</code>
              <button className="ins-cmd-copy" onClick={copy}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <div className="so-acts">
          {allInstalled ? (
            <button className="so-confirm" onClick={closeInstallPrompt}>
              Done
            </button>
          ) : (
            <button className="so-cancel" onClick={closeInstallPrompt} disabled={busy}>
              Later — I&apos;ll find it in the top bar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
