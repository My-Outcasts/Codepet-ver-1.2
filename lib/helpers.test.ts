import { describe, it, expect } from 'vitest';
import { esc, fmt, slug, artType, taskState, artMeta } from './helpers';
import type { Task } from './data';

const task = (over: Partial<Task> = {}): Task => ({
  t: 'Do a thing',
  who: 'does',
  out: 'doc',
  ...over,
});

describe('esc', () => {
  it('escapes HTML-significant characters', () => {
    expect(esc('<a> & </a>')).toBe('&lt;a&gt; &amp; &lt;/a&gt;');
  });
  it('escapes & before < and > (ordering is safe)', () => {
    expect(esc('a&b<c')).toBe('a&amp;b&lt;c');
  });
});

describe('fmt', () => {
  it('formats sub-1000 as a rounded dollar amount', () => {
    expect(fmt(0)).toBe('$0');
    expect(fmt(42.4)).toBe('$42');
  });
  it('formats >=1000 as a k value with one decimal', () => {
    expect(fmt(1000)).toBe('$1k');
    expect(fmt(1504)).toBe('$1.5k');
  });
});

describe('slug', () => {
  it('lowercases and dashes non-alphanumerics, trimming edge dashes', () => {
    expect(slug('Launch Post!')).toBe('launch-post');
    expect(slug('  A/B test  ')).toBe('a-b-test');
  });
});

describe('artType', () => {
  it('prefers explicit artifact payloads', () => {
    expect(artType(task({ site: '<html>' }))).toBe('site');
    expect(artType(task({ plan: {} }))).toBe('plan');
  });
  it('honours an explicit kind first, but ignores unknown kinds', () => {
    expect(artType(task({ kind: 'email' }))).toBe('email');
    // a bad kind must not mistype the task — fall through to the payload
    expect(artType(task({ kind: 'bogus', post: {} }))).toBe('post');
  });
  it('maps route runs to build', () => {
    expect(artType(task({ run: 'route' }))).toBe('build');
  });
  it('falls back to prep when the user does the task or walk is set', () => {
    expect(artType(task({ who: 'you' }))).toBe('prep');
    expect(artType(task(), true)).toBe('prep');
  });
  it('defaults to doc', () => {
    expect(artType(task())).toBe('doc');
  });
});

describe('taskState', () => {
  it('reports done first, regardless of availability', () => {
    expect(taskState(task({ done: true }), false).label).toBe('Done');
  });
  it('reports locked when unavailable', () => {
    expect(taskState(task(), false).cls).toBe('st-locked');
  });
  it('distinguishes approval, input, and byte-driven states', () => {
    expect(taskState(task({ who: 'draft' })).cls).toBe('st-draft');
    expect(taskState(task({ who: 'you' })).cls).toBe('st-you');
    expect(taskState(task({ who: 'does' })).cls).toBe('st-does');
  });
});

describe('artMeta', () => {
  it('uses the rich registry for known types', () => {
    expect(artMeta(task(), 'post').file).toBe('launch-post.txt');
  });
  it('derives a slugged filename for site/sheet types', () => {
    expect(artMeta(task({ t: 'Pricing Model' }), 'sheet').file).toBe('pricing-model.model');
  });
});
