import { TOOLKIT } from '../../toolkit/manifest.mjs';
export { TOOLKIT };

const SLUG = /^[a-z0-9-]+$/;
export const ALL_IDS = TOOLKIT.map((x) => x.id);

/** @param {string[]} ids */
export function itemsByIds(ids) {
  return ids.map((id) => {
    const item = TOOLKIT.find((x) => x.id === id);
    if (!item) throw new Error(`Unknown toolkit id: ${id}`);
    return item;
  });
}

/** Security boundary: accept only known, well-formed ids. @param {unknown} ids @returns {string[]} */
export function validateIds(ids) {
  if (!Array.isArray(ids)) throw new Error('ids must be an array');
  const known = new Set(ALL_IDS);
  return ids.map((id) => {
    if (typeof id !== 'string' || !SLUG.test(id) || !known.has(id)) {
      throw new Error(`Invalid toolkit id: ${String(id)}`);
    }
    return id;
  });
}
