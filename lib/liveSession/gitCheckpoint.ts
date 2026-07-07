// Pure helpers for the "save point" git choreography. The actual git execution lives
// in the server action (app/actions/checkpoint.ts); these are the injectable, testable
// pieces — a ref guard and the exact destructive rewind sequence.

/** Commit message stamped on a save-point snapshot commit. */
export const SAVEPOINT_MESSAGE = 'codepet-savepoint';

/** A snapshot ref must be a hex object id — guard before ever feeding it to a
 *  destructive `git reset --hard` (defence against a bad/injected value). */
export function isObjectId(ref: unknown): boolean {
  return typeof ref === 'string' && /^[0-9a-f]{7,64}$/.test(ref);
}

/** The git commands (argv arrays, no shell) that rewind a repo to a snapshot commit:
 *  reset tracked files to the snapshot, then drop the files the build newly created.
 *  `-fd` only, never `-x`, so ignored files (node_modules, .env) are left alone. */
export function rewindPlan(ref: string): string[][] {
  return [
    ['reset', '--hard', ref],
    ['clean', '-fd'],
  ];
}
