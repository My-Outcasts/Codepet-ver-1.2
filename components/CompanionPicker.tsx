'use client';
// The 7-character chooser, reused by onboarding and the in-app switcher.
import { COMPANIONS } from '@/lib/companions';
import { Companion } from './Companion';

export function CompanionPicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="cpick">
      {COMPANIONS.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`cpick-cell${c.id === selected ? ' sel' : ''}`}
          aria-pressed={c.id === selected}
          onClick={() => onSelect(c.id)}
        >
          <Companion id={c.id} size="s28" />
          <span className="cpick-name">{c.name}</span>
          <span className="cpick-tone">{c.tone}</span>
        </button>
      ))}
    </div>
  );
}
