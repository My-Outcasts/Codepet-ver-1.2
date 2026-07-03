// Build-time image pipeline: re-encode public/ art to WebP (covers also to AVIF).
// Run:  node scripts/optimize-images.mjs [--force]
// Idempotent: skips an output that already exists unless --force. Fails loudly
// per-file without aborting the batch. Originals are removed in a later commit.
import sharp from 'sharp';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(process.cwd(), 'public');

// Which formats/size/quality a source gets, keyed by its public-relative path.
export function encodePlan(relPath) {
  if (relPath.startsWith('covers/')) {
    return { formats: ['webp', 'avif'], maxEdge: 1600, webpQuality: 80, avifQuality: 50 };
  }
  return { formats: ['webp'], maxEdge: 1920, webpQuality: 80, avifQuality: 50 };
}

// Same path with a new extension (png/jpg/jpeg → format).
export function siblingPath(absPath, format) {
  return absPath.replace(/\.(png|jpe?g)$/i, '.' + format);
}

async function collectSources() {
  const out = [];
  for (const [dir, exts] of [
    ['covers', ['.png']],
    ['onboarding', ['.jpg', '.jpeg']],
  ]) {
    const abs = path.join(PUBLIC, dir);
    if (!existsSync(abs)) continue;
    for (const f of await readdir(abs)) {
      if (exts.includes(path.extname(f).toLowerCase())) out.push(`${dir}/${f}`);
    }
  }
  for (const f of ['splash.jpg', 'loading.jpg', 'auth.jpg']) {
    if (existsSync(path.join(PUBLIC, f))) out.push(f);
  }
  return out;
}

async function main() {
  const force = process.argv.includes('--force');
  const sources = await collectSources();
  let made = 0,
    skipped = 0,
    failed = 0;
  for (const rel of sources) {
    const input = path.join(PUBLIC, rel);
    const plan = encodePlan(rel);
    for (const format of plan.formats) {
      const out = siblingPath(input, format);
      if (!force && existsSync(out)) {
        skipped++;
        continue;
      }
      const quality = format === 'avif' ? plan.avifQuality : plan.webpQuality;
      try {
        await sharp(input)
          .resize({ width: plan.maxEdge, height: plan.maxEdge, fit: 'inside', withoutEnlargement: true })
          .toFormat(format, { quality })
          .toFile(out);
        made++;
        console.log(`✓ ${path.relative(PUBLIC, out)}`);
      } catch (err) {
        failed++;
        console.error(`✗ ${rel} → ${format}: ${err.message}`);
      }
    }
  }
  console.log(`\ndone: ${made} written, ${skipped} skipped, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

// Only run the batch when invoked directly — importing for tests must not convert.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
