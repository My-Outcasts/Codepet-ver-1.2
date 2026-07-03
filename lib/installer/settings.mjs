// Pure helper for merging a hook into a Claude Code settings.json object without
// clobbering the user's existing settings. Kept side-effect-free so it's trivially
// unit-tested; the file I/O lives in tracking.mjs.

/**
 * Return a new settings object with `entry` registered under `hooks[eventName]`.
 * Idempotent: a hook group already containing a hook with the same `command` is
 * left untouched. Never mutates the input.
 *
 * @param {Record<string, any>} settings — parsed settings.json (or {})
 * @param {string} eventName — e.g. "SessionEnd"
 * @param {{ type: string, command: string }} entry — the hook to add
 * @returns {Record<string, any>}
 */
export function mergeHook(settings, eventName, entry) {
  const next = structuredClone(settings ?? {});
  const hooks = (next.hooks ??= {});
  const groups = (hooks[eventName] ??= []);

  const already = groups.some(
    (g) => Array.isArray(g?.hooks) && g.hooks.some((h) => h?.command === entry.command),
  );
  if (!already) groups.push({ hooks: [entry] });

  return next;
}
