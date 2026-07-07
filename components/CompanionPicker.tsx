'use client';
// The 7-character chooser. Two layouts share one component:
//   'grid' — the roomy onboarding step (sprite + name + tone stacked).
//   'list' — the compact sidebar switcher popover (sprite + name + one-line
//            truncated tone in a row, with a check on the active one).
import { COMPANIONS } from '@/lib/companions';
import { Companion } from './Companion';

export function CompanionPicker({
  selected,
  onSelect,
  variant = 'grid',
}: {
  selected: string;
  onSelect: (id: string) => void;
  variant?: 'grid' | 'list';
}) {
  const list = variant === 'list';
  return (
    <div className={`cpick${list ? ' is-list' : ''}`}>
      {COMPANIONS.map((c) => {
        const sel = c.id === selected;
        return (
          <button
            key={c.id}
            type="button"
            className={`cpick-cell${sel ? ' sel' : ''}`}
            aria-pressed={sel}
            onClick={() => onSelect(c.id)}
          >
            <Companion id={c.id} size="s28" />
            {list ? (
              <>
                <span className="cpick-txt">
                  <span className="cpick-name">{c.name}</span>
                  <span className="cpick-tone">{c.tone}</span>
                </span>
                {sel && (
                  <svg
                    className="cpick-check"
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3.5 8.5l3 3 6-6.5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </>
            ) : (
              <>
                <span className="cpick-name">{c.name}</span>
                <span className="cpick-tone">{c.tone}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
