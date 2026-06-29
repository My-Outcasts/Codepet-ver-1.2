'use client';
import { useApp } from '@/lib/store';

export function Toast() {
  const { toastMsg } = useApp();
  const msg = toastMsg || 'Your roadmap is ready — byte mapped 9 steps across 8 departments.';
  return (
    <div className={`toast${toastMsg ? ' on' : ''}`}>
      <span className="ok" style={{ width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, color: '#fff' }}>✓</span>
      <span>{msg}</span>
    </div>
  );
}
