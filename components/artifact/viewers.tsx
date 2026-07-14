'use client';
import { useState, type ReactNode } from 'react';
import { useApp } from '@/lib/store';
import { companionById } from '@/lib/companions';
import { fmt } from '@/lib/helpers';
import { computeSheetModel } from '@/lib/ai/sheetModel';

function useCopy() {
  const { toast } = useApp();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string, text: string) => {
    const done = () => {
      setCopied(id);
      toast('Copied to clipboard.');
      setTimeout(() => setCopied(null), 1400);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, done);
    else done();
  };
  return { copied, copy };
}

function download(filename: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
}

// A quiet, honest trust line on the deliverable types that carry real liability —
// financial projections, legal documents, and advice/decision docs. byte drafts these
// from the founder's own context; the note says so plainly and reminds them to verify
// before relying on it, without alarming legal-register boilerplate (one muted line, no
// icon — matches the minimalist bar and PlanViewer's foot). Kept in one place so the
// wording stays consistent across viewers.
const DELIV_NOTE: Record<'sheet' | 'legal' | 'doc', string> = {
  sheet:
    'Projections Codepet drafted from your inputs — not financial advice. Verify the figures before you rely on them.',
  legal: 'Draft, not legal advice — have a lawyer review before you publish or rely on it.',
  doc: 'Codepet’s recommendation, drafted from your context — your call to verify and decide.',
};

function DelivNote({ kind }: { kind: keyof typeof DELIV_NOTE }) {
  return <div className="deliv-note">{DELIV_NOTE[kind]}</div>;
}

/* ===== live website ===== */
export function SiteViewer({ head, file, site }: { head: string; file: string; site: string }) {
  const { toast } = useApp();
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  return (
    <div className="siteart">
      <div className="site-bar">
        <span>{head}</span>
        <span className="site-tabs">
          <button
            className={`st-tab${tab === 'preview' ? ' on' : ''}`}
            onClick={() => setTab('preview')}
          >
            Preview
          </button>
          <button className={`st-tab${tab === 'code' ? ' on' : ''}`} onClick={() => setTab('code')}>
            Code
          </button>
        </span>
        <span className="site-file">{file}</span>
        <button
          className="st-act"
          onClick={() => {
            const w = window.open('', '_blank');
            if (w) {
              w.document.open();
              w.document.write(site);
              w.document.close();
            } else toast('Allow pop-ups to open the site in a new tab.');
          }}
        >
          Open ↗
        </button>
        <button
          className="st-act"
          onClick={() => {
            download('index.html', site, 'text/html');
            toast('index.html downloaded.');
          }}
        >
          Download
        </button>
      </div>
      <div className="site-chrome">
        <span className="cd" />
        <span className="cd" />
        <span className="cd" />
        <span className="url">localhost:3001</span>
      </div>
      <div className="site-stage">
        <div className={`site-frame-wrap${tab === 'code' ? ' off' : ''}`}>
          <iframe
            className="site-frame"
            sandbox="allow-same-origin allow-popups"
            title="preview"
            srcDoc={site}
          />
        </div>
        <pre className={`site-code${tab === 'code' ? ' on' : ''}`}>{site}</pre>
      </div>
    </div>
  );
}

/* ===== screens — tap-through phone ===== */
export function ScreensViewer({
  head,
  file,
  screens,
}: {
  head: string;
  file: string;
  screens: any[];
}) {
  const [i, setI] = useState(0);
  const { companionId } = useApp();
  const companionName = companionById(companionId).name;
  const S = screens;
  const art = (s: any) => {
    if (s.art === 'connect')
      return (
        <div className="sa-mid">
          <div className="sa-card" style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 30, color: 'var(--accent)' }}>
              {'{ }'}
            </div>
            <p style={{ marginTop: 6 }}>your-project</p>
          </div>
        </div>
      );
    if (s.art === 'session')
      return (
        <div className="sa-mid">
          <div className="sa-prog">
            <div className="ln">
              <span className="pd" />
              session started
            </div>
            <div className="ln">
              <span className="pd" />
              watching edits…
            </div>
            <div className="ln">
              <span className="pd" />3 concepts spotted
            </div>
          </div>
          <div className="sa-dots">
            <i className="on" />
            <i className="on" />
            <i />
          </div>
        </div>
      );
    return (
      <div className="sa-mid">
        <div className="sa-card">
          <h4>{companionName} · recap</h4>
          <p>You wired OAuth into the login flow and refactored the session store.</p>
          <div className="sa-term">
            <span>OAuth</span>
            <span>async/await</span>
            <span>@EnvironmentObject</span>
          </div>
        </div>
      </div>
    );
  };
  return (
    <div className="screensart">
      <div className="site-bar">
        <span>{head}</span>
        <span className="site-file">{file}</span>
      </div>
      <div className="sc-stage">
        {/* Tap the phone to advance (wraps at the end) — matches the "tap through
            all three screens" copy, and works even where the Back/Next row below
            is scrolled out of view in the run modal. */}
        <div
          className="phone tappable"
          role="button"
          tabIndex={0}
          aria-label={`Screen ${i + 1} of ${S.length} — tap to advance`}
          title="Tap to advance"
          onClick={() => setI((cur) => (cur + 1) % S.length)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setI((cur) => (cur + 1) % S.length);
            }
          }}
        >
          <div className="notch" />
          {S.map((s, k) => (
            <div className={`scr${k === i ? ' on' : ''}`} key={k}>
              <div className="kick">{s.kick}</div>
              <h3>{s.title}</h3>
              {s.sub && <div className="ssub">{s.sub}</div>}
              {art(s)}
              {s.cta && <div className="scta">{s.cta}</div>}
              {s.note && <div className="snote">{s.note}</div>}
            </div>
          ))}
        </div>
        <div className="sc-cap">
          <b>{S[i].name}</b> · first value by {S[i].time}
        </div>
        <div className="sc-nav">
          <button disabled={i === 0} onClick={() => setI(Math.max(0, i - 1))}>
            ‹ Back
          </button>
          <span className="sc-dotsrow">
            {S.map((_, k) => (
              <i key={k} className={k === i ? 'on' : ''} />
            ))}
          </span>
          <button disabled={i === S.length - 1} onClick={() => setI(Math.min(S.length - 1, i + 1))}>
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===== interactive financial sheet ===== */
export function SheetViewer({ head, file, sheet }: { head: string; file: string; sheet: any }) {
  const [vals, setVals] = useState<number[]>(sheet.inputs.map((x: any) => x.val));
  const I = sheet.inputs;
  const price = vals[0];
  // The projection is a pure, finite-safe function (churn/price floored) shared
  // with the tests — no division-by-zero from a live-generated input.
  const { paid, mrr, arr, ltv, life, breakeven } = computeSheetModel(vals);
  return (
    <div className="sheetart">
      <div className="site-bar">
        <span>{head}</span>
        <span className="site-file">{file}</span>
      </div>
      <div className="sh-inputs">
        {I.map((x: any, k: number) => (
          <div className="sh-row" key={k}>
            <label>{x.label}</label>
            <input
              type="range"
              min={x.min}
              max={x.max}
              step={x.step}
              value={vals[k]}
              onChange={(e) => setVals((v) => v.map((vv, kk) => (kk === k ? +e.target.value : vv)))}
            />
            <span className="sh-val">
              {x.pre || ''}
              {vals[k].toLocaleString()}
              {x.suf || ''}
            </span>
          </div>
        ))}
      </div>
      <div className="sh-out">
        <div className="sh-cell">
          <div className="l">Paid users</div>
          <div className="v">{paid.toLocaleString()}</div>
        </div>
        <div className="sh-cell hero">
          <div className="l">Seed MRR</div>
          <div className="v">{fmt(mrr)}</div>
        </div>
        <div className="sh-cell">
          <div className="l">Run-rate ARR</div>
          <div className="v">{fmt(arr)}</div>
        </div>
        <div className="sh-cell">
          <div className="l">LTV / user</div>
          <div className="v">{fmt(ltv)}</div>
        </div>
        <div className="sh-cell">
          <div className="l">Churn-adj. life</div>
          <div className="v">{life}mo</div>
        </div>
        <div className="sh-cell">
          <div className="l">Break-even users</div>
          <div className="v">{breakeven.toLocaleString()}</div>
        </div>
      </div>
      <div className="sh-tiers">
        <div className="sh-tier">
          <div className="tn">Free</div>
          <div className="tp">$0</div>
          <div className="tf">
            Session recaps
            <br />
            Last 7 days
          </div>
        </div>
        <div className="sh-tier mid">
          <div className="tn">Pro</div>
          <div className="tp">${price}/mo</div>
          <div className="tf">
            Dictionary + history
            <br />
            Full Learner Model
          </div>
        </div>
        <div className="sh-tier">
          <div className="tn">Team</div>
          <div className="tp">${price + 8}/seat</div>
          <div className="tf">
            Shared glossary
            <br />
            Admin + SSO
          </div>
        </div>
      </div>
      <DelivNote kind="sheet" />
    </div>
  );
}

/* ===== social post ===== */
export function PostViewer({ post }: { post: any }) {
  const { copied, copy } = useCopy();
  const V = post.variants;
  const [cur, setCur] = useState(0);
  return (
    <div className="postart">
      <div className="post-card">
        <div className="post-top">
          <span className="out-byte">
            <img src="/byte.png" alt="Codepet" />
          </span>
          <span className="pa">
            <span className="pn">{post.author}</span>
            <span className="ph">{post.handle} · now</span>
          </span>
        </div>
        <div className="post-body">{V[cur].body}</div>
        <div className="post-stats">
          <span>
            <b>{post.stats.replies}</b> Replies
          </span>
          <span>
            <b>{post.stats.reposts}</b> Reposts
          </span>
          <span>
            <b>{post.stats.likes}</b> Likes
          </span>
        </div>
      </div>
      <div className="post-foot">
        <span className="vlabel">Hook:</span>
        {V.map((v: any, i: number) => (
          <button key={i} className={`vchip${i === cur ? ' on' : ''}`} onClick={() => setCur(i)}>
            {v.label}
          </button>
        ))}
        <button
          className={`copybtn${copied === 'post' ? ' ok' : ''}`}
          onClick={() => copy('post', V[cur].body)}
        >
          {copied === 'post' ? 'Copied ✓' : 'Copy post'}
        </button>
      </div>
    </div>
  );
}

/* ===== email ===== */
export function EmailViewer({ email }: { email: any }) {
  return (
    <div className="emailart">
      <div className="em-head">
        <div className="em-subj">{email.subject}</div>
        <div className="em-meta">
          <span className="em-from">{email.from}</span>
          <span>&lt;{email.fromAddr}&gt;</span>
        </div>
        <div className="em-pre">{email.preheader}</div>
      </div>
      <div className="em-body">
        {email.body.map((p: string, i: number) => (
          <p key={i}>{p}</p>
        ))}
        <a className="em-cta">{email.cta}</a>
      </div>
      <div className="em-seq">
        <div className="sqh">Full sequence · sends on milestones</div>
        {email.seq.map((s: any, i: number) => (
          <div className="em-row" key={i}>
            <span className="em-when">{s.when}</span>
            <div className="em-rt">
              <b>{s.title}</b>
              <div>{s.open}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===== content calendar ===== */
export function CalendarViewer({ calendar }: { calendar: any }) {
  return (
    <div className="calart">
      {calendar.weeks.map((w: any, i: number) => (
        <div className="cal-week" key={i}>
          <div className="cal-wh">{w.label}</div>
          <div className="cal-grid">
            {w.items.map((it: any, k: number) => (
              <div className="cal-post" key={k}>
                <div className="ct">
                  <span className="cal-day">{it.day}</span>
                  <span className="cal-kind">{it.kind}</span>
                </div>
                <div className="cb">{it.body}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ===== legal document ===== */
export function LegalViewer({ legal }: { legal: any }) {
  const { copied, copy } = useCopy();
  const { toast } = useApp();
  const plain =
    legal.docTitle + '\n\n' + legal.sections.map((s: any) => `${s.h}\n${s.p}`).join('\n\n');
  return (
    <div className="legalart">
      <div className="lg-sheet">
        <div className="lg-title">{legal.docTitle}</div>
        <div className="lg-upd">{legal.updated}</div>
        {legal.sections.map((s: any, i: number) => (
          <div className="lg-sec" key={i}>
            <h5>{s.h}</h5>
            <p>{s.p}</p>
          </div>
        ))}
        {legal.flag && <div className="lg-flag">{legal.flag}</div>}
      </div>
      <div className="lg-foot">
        <button
          className={`copybtn${copied === 'lg' ? ' ok' : ''}`}
          onClick={() => copy('lg', plain)}
        >
          {copied === 'lg' ? 'Copied ✓' : 'Copy text'}
        </button>
        <button
          className="markbtn"
          onClick={() => {
            const md =
              '# ' +
              legal.docTitle +
              '\n\n' +
              legal.sections.map((s: any) => '## ' + s.h + '\n\n' + s.p).join('\n\n');
            const fn = legal.docTitle.toLowerCase().replace(/\s+/g, '-') + '.md';
            download(fn, md, 'text/markdown');
            toast('Downloaded ' + fn);
          }}
        >
          Download .md
        </button>
      </div>
      <DelivNote kind="legal" />
    </div>
  );
}

/* ===== decision doc ===== */
interface DocSection {
  h: string;
  p: string;
}
interface DocDoc {
  title?: string;
  call: string;
  sections: DocSection[];
  next?: string[];
}
export function DocViewer({ doc, fallback }: { doc?: Partial<DocDoc> | null; fallback?: string }) {
  const { copied, copy } = useCopy();
  const { toast } = useApp();
  // Legacy / plain docs (no structured payload) render as their text body.
  if (!doc || typeof doc.call !== 'string' || !Array.isArray(doc.sections)) {
    return (
      <div className="artifact">
        <div className="art-body">
          <DocBody text={fallback ?? ''} />
        </div>
      </div>
    );
  }
  const call = doc.call;
  const title = doc.title;
  const sections = doc.sections;
  const next: string[] = Array.isArray(doc.next) ? doc.next : [];
  const plain =
    call +
    '\n\n' +
    sections.map((s) => `${s.h}\n${s.p}`).join('\n\n') +
    (next.length ? '\n\nNext:\n' + next.map((n) => `- ${n}`).join('\n') : '');
  return (
    <div className="docart">
      <div className="doc-sheet">
        {title && <div className="doc-title">{title}</div>}
        <div className="doc-call">
          <span className="doc-call-k">The call</span>
          <p>{call}</p>
        </div>
        {sections.map((s, i) => (
          <div className="doc-sec" key={i}>
            <h5>{s.h}</h5>
            <p>{s.p}</p>
          </div>
        ))}
        {next.length > 0 && (
          <div className="doc-next">
            <h5>Next</h5>
            <ul>
              {next.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="doc-foot">
        <button
          className={`copybtn${copied === 'doc' ? ' ok' : ''}`}
          onClick={() => copy('doc', plain)}
        >
          {copied === 'doc' ? 'Copied ✓' : 'Copy text'}
        </button>
        <button
          className="markbtn"
          onClick={() => {
            const md =
              (title ? '# ' + title + '\n\n' : '') +
              '**' +
              call +
              '**\n\n' +
              sections.map((s) => '## ' + s.h + '\n\n' + s.p).join('\n\n') +
              (next.length ? '\n\n## Next\n\n' + next.map((n) => '- ' + n).join('\n') : '');
            const fn = (title || 'document').toLowerCase().replace(/\s+/g, '-') + '.md';
            download(fn, md, 'text/markdown');
            toast('Downloaded ' + fn);
          }}
        >
          Download .md
        </button>
      </div>
      <DelivNote kind="doc" />
    </div>
  );
}

/* ===== sales DMs ===== */
export function DmsViewer({ dms }: { dms: any[] }) {
  const { copied, copy } = useCopy();
  const [sent, setSent] = useState<Record<number, boolean>>({});
  return (
    <div className="dmart">
      {dms.map((m, i) => (
        <div className={`dm-card${sent[i] ? ' sent' : ''}`} key={i}>
          <div className="dm-top">
            <span className="dm-av">{m.name[0]}</span>
            <span style={{ flex: 1 }}>
              <span className="dm-nm">{m.name}</span>
              <div className="dm-note">{m.note}</div>
            </span>
            <span className="dm-sent">✓ Sent</span>
          </div>
          <div className="dm-msg">{m.msg}</div>
          <div className="dm-foot">
            <button
              className={`copybtn${copied === 'dm' + i ? ' ok' : ''}`}
              onClick={() => copy('dm' + i, m.msg)}
            >
              {copied === 'dm' + i ? 'Copied ✓' : 'Copy DM'}
            </button>
            <button className="markbtn" onClick={() => setSent((s) => ({ ...s, [i]: !s[i] }))}>
              {sent[i] ? 'Sent ✓' : 'Mark sent'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ===== ops checklist ===== */
export function ChecklistViewer({ checklist }: { checklist: any[] }) {
  const [items, setItems] = useState(() => checklist.map((x) => ({ ...x })));
  const done = items.filter((x) => x.done).length;
  const pct = Math.round((done / items.length) * 100);
  return (
    <div className="ckart">
      <div className="ck-prog">
        <div className="ck-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="ck-pct">
          {done}/{items.length}
        </span>
      </div>
      <div className="ck-list">
        {items.map((x, i) => (
          <div
            className={`ck-item${x.done ? ' on' : ''}`}
            key={i}
            onClick={() =>
              setItems((arr) => arr.map((it, k) => (k === i ? { ...it, done: !it.done } : it)))
            }
          >
            <span className="ck-box">✓</span>
            <span className="ck-tx">{x.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===== engineering code-change plan ===== */
// Honest: the change byte WOULD make (goal / approach / areas touched / how to
// verify) — never a fake "merged PR" with invented files, line counts, or green
// checks. byte can't open PRs or run CI, so it drafts the plan to hand off instead.
export function PlanViewer({ plan, title }: { plan: any; title?: string }) {
  const steps: string[] = Array.isArray(plan?.steps) ? plan.steps : [];
  const changes: Array<{ area?: string; edit?: string }> = Array.isArray(plan?.changes)
    ? plan.changes
    : [];
  const verify: string[] = Array.isArray(plan?.verify) ? plan.verify : [];
  const goal = typeof plan?.goal === 'string' ? plan.goal : '';
  const risks = typeof plan?.risks === 'string' ? plan.risks : '';
  return (
    <div className="planart">
      <div className="plan-head">
        <span className="plan-chip">Code-change plan</span>
        <div className="plan-title">{title || 'Change plan'}</div>
      </div>
      {goal && (
        <div className="plan-sec">
          <div className="plan-lbl">Goal</div>
          <p className="plan-goal">{goal}</p>
        </div>
      )}
      {steps.length > 0 && (
        <div className="plan-sec">
          <div className="plan-lbl">Approach</div>
          <ol className="plan-steps">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {changes.length > 0 && (
        <div className="plan-sec">
          <div className="plan-lbl">Changes</div>
          <div className="plan-changes">
            {changes.map((c, i) => (
              <div className="plan-change" key={i}>
                <span className="plan-area">{c.area}</span>
                <span className="plan-edit">{c.edit}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {verify.length > 0 && (
        <div className="plan-sec">
          <div className="plan-lbl">How to verify</div>
          <ul className="plan-verify">
            {verify.map((v, i) => (
              <li key={i}>
                <span className="plan-box">☐</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {risks && (
        <div className="plan-risk">
          <span className="plan-rk">!</span>
          <span>{risks}</span>
        </div>
      )}
      <div className="plan-foot">Hand this plan to your coding agent to implement it.</div>
    </div>
  );
}

// dispatch a viewer by artifact type from a task/library item
/* ===== plain-text deliverables (doc / prep / build) =====
   byte writes these in light markdown. Render the small subset it actually emits —
   #/##/### headings, **bold**, `code`, - / * bullets, numbered lists, paragraphs — as
   real elements so the founder sees a finished document, not raw # and ** syntax. Only
   used for the FINAL deliverable; the streaming/typewriter view stays raw on purpose. */

// Resolve **bold** and `code` spans within a single line to React nodes.
function inlineMd(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+?)`/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={key++}>{m[1]}</strong>);
    else out.push(<code key={key++}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function DocBody({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={key++} className="md-p">
          {inlineMd(para.join(' '))}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inlineMd(it)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={key++} className="md-ol">
          {items}
        </ol>
      ) : (
        <ul key={key++} className="md-ul">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    // A line of only dashes/underscores/asterisks (3+) is a section divider. Checked
    // before the bullet rule, though they can't overlap — bullets require a space
    // after the marker ("- text"), a rule has none.
    const isRule = /^\s*([-_*])\1{2,}\s*$/.test(line);
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const level = h[1].length;
      const content = inlineMd(h[2]);
      if (level === 1)
        blocks.push(
          <h3 key={key++} className="md-h md-h1">
            {content}
          </h3>,
        );
      else if (level === 2)
        blocks.push(
          <h4 key={key++} className="md-h md-h2">
            {content}
          </h4>,
        );
      else
        blocks.push(
          <h5 key={key++} className="md-h md-h3">
            {content}
          </h5>,
        );
    } else if (isRule) {
      flushPara();
      flushList();
      blocks.push(<hr key={key++} className="md-hr" />);
    } else if (ul) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1]);
    } else if (ol) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1]);
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="md-body">{blocks}</div>;
}

export function ArtifactViewer({ item }: { item: any }) {
  const { head, file } = item;
  if (item.type === 'site') return <SiteViewer head={head} file={file} site={item.site} />;
  if (item.type === 'screens')
    return <ScreensViewer head={head} file={file} screens={item.screens} />;
  if (item.type === 'sheet') return <SheetViewer head={head} file={file} sheet={item.sheet} />;
  if (item.type === 'post') return <PostViewer post={item.post} />;
  if (item.type === 'email') return <EmailViewer email={item.email} />;
  if (item.type === 'calendar') return <CalendarViewer calendar={item.calendar} />;
  if (item.type === 'legal') return <LegalViewer legal={item.legal} />;
  if (item.type === 'dms') return <DmsViewer dms={item.dms} />;
  if (item.type === 'checklist') return <ChecklistViewer checklist={item.checklist} />;
  if (item.type === 'plan') return <PlanViewer plan={item.plan} title={item.title} />;
  if (item.type === 'doc') return <DocViewer doc={item.doc} fallback={item.out} />;
  return (
    <div className="artifact">
      <div className={`art-bar ${item.type}`}>
        <span>{item.head}</span>
        <span className="art-file">{item.file}</span>
        <span dangerouslySetInnerHTML={{ __html: item.tag }} />
      </div>
      <div className="art-body">
        <DocBody text={item.out ?? ''} />
      </div>
    </div>
  );
}
