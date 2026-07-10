// One guard for the founder's company name. The name is free text the user typed at
// onboarding, so it can be junk: empty, a single char, all digits ("1"), or — most visibly —
// their raw signup email when the address landed in the name field. `cleanCompanyName`
// returns the trimmed name, or null when it's junk, so every surface (the hero root node, the
// 3D map, byte's chat) can fall back to its own generic ("Your company" / "your company")
// instead of ever showing a bare email or garbage as the company title.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanCompanyName(raw?: string | null): string | null {
  const v = raw?.trim() ?? '';
  if (v.length < 2 || /^\d+$/.test(v) || EMAIL_RE.test(v)) return null;
  return v;
}
