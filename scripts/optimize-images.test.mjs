import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePlan, siblingPath } from './optimize-images.mjs';

test('covers get webp + avif at 1600px', () => {
  const p = encodePlan('covers/eng.png');
  assert.deepEqual(p.formats, ['webp', 'avif']);
  assert.equal(p.maxEdge, 1600);
  assert.equal(p.webpQuality, 80);
  assert.equal(p.avifQuality, 50);
});

test('scene images get webp only at 1920px', () => {
  assert.deepEqual(encodePlan('splash.jpg').formats, ['webp']);
  assert.equal(encodePlan('splash.jpg').maxEdge, 1920);
  assert.deepEqual(encodePlan('onboarding/ob-team.jpg').formats, ['webp']);
});

test('siblingPath swaps the extension case-insensitively', () => {
  assert.equal(siblingPath('/pub/covers/eng.png', 'webp'), '/pub/covers/eng.webp');
  assert.equal(siblingPath('/pub/covers/eng.png', 'avif'), '/pub/covers/eng.avif');
  assert.equal(siblingPath('/pub/onboarding/ob-team.JPG', 'webp'), '/pub/onboarding/ob-team.webp');
});
