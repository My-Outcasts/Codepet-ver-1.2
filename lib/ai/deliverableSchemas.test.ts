import { describe, it, expect } from 'vitest';
import {
  STRUCTURED_SCHEMAS,
  DELIVERABLE_INSTRUCTIONS,
  SCREENS_SCHEMA,
  SCREEN_ARTS,
  type StructuredKind,
} from './deliverableSchemas';

// Anthropic's strict JSON-schema subset (output_config.format) requires every
// object to set `additionalProperties: false` AND `required` to list *every*
// declared property. A schema that violates this 400s at request time — so we
// assert it here, where CI catches it before a deploy.
function assertStrict(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((n, i) => assertStrict(n, `${path}[${i}]`));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  if (obj.type === 'object') {
    expect(obj.additionalProperties, `${path}: additionalProperties must be false`).toBe(false);
    const props = obj.properties as Record<string, unknown> | undefined;
    const required = obj.required as string[] | undefined;
    expect(props, `${path}: object needs properties`).toBeTruthy();
    const propKeys = Object.keys(props ?? {}).sort();
    expect((required ?? []).slice().sort(), `${path}: required must list every property`).toEqual(
      propKeys,
    );
  }
  // Recurse into nested schemas (properties, items, etc.).
  for (const [k, v] of Object.entries(obj)) assertStrict(v, `${path}.${k}`);
}

describe('deliverableSchemas', () => {
  const kinds = Object.keys(STRUCTURED_SCHEMAS) as StructuredKind[];

  it('registers screens + sheet + site + dms + calendar + checklist alongside the existing structured kinds', () => {
    expect(kinds.sort()).toEqual([
      'calendar',
      'checklist',
      'dms',
      'email',
      'legal',
      'post',
      'screens',
      'sheet',
      'site',
    ]);
  });

  it.each(kinds)('%s is a strict JSON schema', (kind) => {
    assertStrict(STRUCTURED_SCHEMAS[kind], kind);
  });

  it.each(kinds)('%s has a prompt instruction', (kind) => {
    expect(DELIVERABLE_INSTRUCTIONS[kind]?.length ?? 0).toBeGreaterThan(0);
  });

  it('constrains screen art to exactly what the viewer can render', () => {
    const screens = SCREENS_SCHEMA.properties as { screens: { items: Record<string, unknown> } };
    const art = (screens.screens.items.properties as { art: { enum: string[] } }).art;
    expect(art.enum).toEqual([...SCREEN_ARTS]);
    // Guards against silently widening the enum past the viewer's 3 illustrations.
    expect(SCREEN_ARTS).toEqual(['connect', 'session', 'recap']);
  });
});
