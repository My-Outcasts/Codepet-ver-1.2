import fs from 'node:fs';
import path from 'node:path';
import { itemsByIds } from './manifest.mjs';
import { targetPath, managedTarget, sourcePath } from './paths.mjs';

/** Install items into claudeDir.
 * @param {string[]} ids — must already be validated by validateIds() at the entry boundary (server action / CLI); these functions trust the manifest lookup.
 * @returns {{id,name,type,target,status,error?}[]}
 */
export function installItems(ids, claudeDir) {
  return itemsByIds(ids).map((item) => {
    const target = targetPath(item, claudeDir);
    const base = { id: item.id, name: item.name, type: item.type, target };
    try {
      const src = fs.readFileSync(sourcePath(item), 'utf8');
      let status;
      if (fs.existsSync(target)) {
        status = fs.readFileSync(target, 'utf8') === src ? 'skipped' : 'updated';
      } else {
        status = 'created';
      }
      if (status !== 'skipped') {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, src);
      }
      return { ...base, status };
    } catch (e) {
      return { ...base, status: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** Remove the managed target for each item.
 * @param {string[]} ids — must already be validated by validateIds() at the entry boundary (server action / CLI); these functions trust the manifest lookup.
 * @returns {{id,status,error?}[]}
 */
export function uninstallItems(ids, claudeDir) {
  return itemsByIds(ids).map((item) => {
    const { kind, path: p } = managedTarget(item, claudeDir);
    try {
      if (!fs.existsSync(p)) return { id: item.id, status: 'absent' };
      fs.rmSync(p, kind === 'dir' ? { recursive: true, force: true } : { force: true });
      return { id: item.id, status: 'removed' };
    } catch (e) {
      return { id: item.id, status: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** Existence status for each item.
 * @param {string[]} ids — must already be validated by validateIds() at the entry boundary (server action / CLI); these functions trust the manifest lookup.
 * @returns {{id,installed,target}[]}
 */
export function installedStatus(ids, claudeDir) {
  return itemsByIds(ids).map((item) => {
    const target = targetPath(item, claudeDir);
    return { id: item.id, installed: fs.existsSync(target), target };
  });
}
