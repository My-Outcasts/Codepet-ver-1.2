import { LIB_SKIN } from '@/lib/data';

// A small, purpose-built visual preview of a deliverable's Outcome, shown on the
// left of each Library poster row. Presentational only — static shapes plus a few
// short real strings pulled from the item's structured payload, with a graceful
// fallback to a generic document look when a seed item carries only `out` text.
// Every preview's accent color flows from the type's LIB_SKIN ink via `--op`, and
// the panel tint/border come from the same skin, so the whole set reads as one system.

type Item = {
  type: string;
  out?: string;
  title?: string;
  plan?: { steps?: string[] } | null;
  post?: { variants?: { body?: string }[] } | null;
  email?: { subject?: string; seq?: unknown[] } | null;
  calendar?: { weeks?: { items?: unknown[] }[] } | null;
  legal?: { docTitle?: string; flag?: string } | null;
  dms?: { msg?: string }[] | null;
  checklist?: { t?: string; done?: boolean }[] | null;
  doc?: { title?: string } | null;
};

const firstLine = (out?: string) =>
  (out || '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean) || '';

const bars = (widths: number[]) =>
  widths.map((w, i) => <span className="op-l" key={i} style={{ width: `${w}%` }} />);

// browser chrome, shared by site (clean) and build (+ shipped ribbon)
function Chrome({ shipped }: { shipped?: boolean }) {
  return (
    <>
      <div className="op-chrome">
        <div className="op-ctop">
          <i />
          <i />
          <i />
          <span className="op-url" />
        </div>
        <div className="op-cbody">
          <span className="op-h" />
          {bars([88, 70])}
        </div>
      </div>
      {shipped && <span className="op-ship">✓ shipped &amp; verified</span>}
    </>
  );
}

function DocPage({ flag }: { flag?: boolean }) {
  return (
    <div className="op-doc">
      <span className="op-dh" />
      {bars([96, 99, 74, 92])}
      {flag && <span className="op-flag">review</span>}
    </div>
  );
}

export function OutcomePreview({ item }: { item: Item }) {
  const skin = LIB_SKIN[item.type] || LIB_SKIN.doc;
  const inner = () => {
    switch (item.type) {
      case 'site':
        return <Chrome />;
      case 'build':
        return <Chrome shipped />;
      case 'screens':
        return (
          <div className="op-phones">
            <span className="op-phone op-phone-b" />
            <span className="op-phone op-phone-a" />
          </div>
        );
      case 'plan': {
        const steps =
          Array.isArray(item.plan?.steps) && item.plan!.steps!.length
            ? item.plan!.steps!.slice(0, 3)
            : [0, 0, 0];
        const w = [70, 88, 56];
        return (
          <div className="op-steps">
            {steps.map((_, i) => (
              <div className="op-step" key={i}>
                <span className="op-n">{i + 1}</span>
                <span className="op-t" style={{ width: `${w[i] ?? 70}%` }} />
              </div>
            ))}
          </div>
        );
      }
      case 'sheet':
        return (
          <div className="op-sheet">
            <span className="op-srow op-shead" />
            <span className="op-srow" />
            <span className="op-srow" />
            <span className="op-srow op-sshort" />
          </div>
        );
      case 'post': {
        const body = item.post?.variants?.[0]?.body || firstLine(item.out);
        return (
          <div className="op-post">
            <div className="op-prow">
              <span className="op-av" />
              <span className="op-nm" />
            </div>
            <div className="op-ptx">{body}</div>
          </div>
        );
      }
      case 'email': {
        const subj = item.email?.subject || firstLine(item.out) || 'Email';
        const n = Array.isArray(item.email?.seq) ? item.email!.seq!.length : 0;
        return (
          <div className="op-mail">
            <div className="op-subj">{subj}</div>
            <div className="op-mbody">
              {bars([92, 98, 60])}
              {n > 1 && <div className="op-seq">{n}-email sequence</div>}
            </div>
          </div>
        );
      }
      case 'calendar': {
        // a 2-posts/week rhythm — mark two cells per week across a 2-week grid
        const marked = new Set([0, 3, 7, 10]);
        return (
          <div className="op-cal">
            {Array.from({ length: 14 }, (_, i) => (
              <span className={`op-cd${marked.has(i) ? ' mk' : ''}`} key={i} />
            ))}
          </div>
        );
      }
      case 'legal':
        return <DocPage flag={!!item.legal?.flag} />;
      case 'dms': {
        const msg = item.dms?.[0]?.msg || firstLine(item.out);
        return (
          <div className="op-dms">
            <span className="op-bub op-bub-in" />
            <div className="op-bub op-bub-out">{msg}</div>
          </div>
        );
      }
      case 'checklist':
      case 'prep': {
        const rows =
          Array.isArray(item.checklist) && item.checklist.length
            ? item.checklist.slice(0, 4)
            : [{ done: true }, { done: true }, { done: false }, { done: false }];
        return (
          <div className="op-checks">
            {rows.map((c, i) => (
              <div className={`op-ck${c.done ? ' on' : ''}`} key={i}>
                <b>{c.done ? '✓' : ''}</b>
                <span className="op-ct" />
              </div>
            ))}
          </div>
        );
      }
      default:
        return <DocPage />;
    }
  };

  return (
    <div
      className={`lt-prev op-${item.type}`}
      style={{
        background: skin.tint,
        borderColor: skin.line,
        ['--op' as string]: skin.ink,
      }}
    >
      {inner()}
    </div>
  );
}
