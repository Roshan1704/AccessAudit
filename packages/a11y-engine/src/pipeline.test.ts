import { describe, expect, it } from 'vitest';
import {
  allRules,
  axeRuleIdsFor,
  fingerprint,
  getRule,
  manualTasksFor,
  parseWcagTags,
  processFindings,
  ruleApplies,
  validate,
} from './index.js';
import type { RawFinding } from './index.js';

const URL1 = 'https://example.test/a?x=1';

function raw(over: Partial<RawFinding>): RawFinding {
  return {
    ruleId: 'axe:image-alt',
    message: 'Images must have alternative text',
    selector: 'img.hero',
    classification: 'confirmed',
    severity: 'critical',
    evidence: [{ kind: 'html_snippet', content: { html: '<img src="a.png">' } }],
    ...over,
  };
}

describe('registry', () => {
  it('parses WCAG tags', () => {
    expect(parseWcagTags(['wcag2a', 'wcag111'])).toEqual({
      criteria: ['1.1.1'],
      level: 'A',
      version: '2.0',
    });
    expect(parseWcagTags(['wcag22aa', 'wcag258']).criteria).toEqual(['2.5.8']);
    expect(parseWcagTags(['best-practice']).level).toBeNull();
  });
  it('has unique rule ids and every rule is reachable', () => {
    const ids = allRules().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getRule('custom:focus-indicator')).toBeDefined();
  });
  it('respects version and level', () => {
    const r = getRule('axe:target-size');
    if (r === undefined) throw new Error('target-size missing');
    expect(ruleApplies(r, { wcagVersion: '2.1', level: 'AA' })).toBe(false);
    expect(ruleApplies(r, { wcagVersion: '2.2', level: 'AA' })).toBe(true);
    const a = axeRuleIdsFor({ wcagVersion: '2.0', level: 'A', interactionTests: false });
    expect(a).toContain('image-alt');
    expect(a).not.toContain('target-size');
    expect(a).not.toContain('color-contrast');
  });
});

describe('validation', () => {
  it('rejects findings with no evidence or unknown rules', () => {
    expect(validate(raw({ evidence: [] })).rejection?.reason).toBe('no_evidence');
    expect(validate(raw({ ruleId: 'nope' })).rejection?.reason).toBe('unknown_rule');
  });
  it('never confirms a manual rule', () => {
    const v = validate(raw({ ruleId: 'manual:media-alternatives' }));
    expect(v.finding?.classification).toBe('manual_verification');
  });
  it('caps heuristic custom rules below confirmed', () => {
    const v = validate(raw({ ruleId: 'custom:generic-link-text' }));
    expect(v.finding?.classification).toBe('strong_potential');
  });
  it('allows an interaction rule to be confirmed only when reproduced with a trace', () => {
    const base = raw({ ruleId: 'interaction:dialog-escape', selector: '#d' });
    expect(validate(base).finding?.classification).toBe('strong_potential');
    const ok = validate({
      ...base,
      reproduced: true,
      evidence: [...base.evidence, { kind: 'interaction_trace', content: { steps: ['Escape'] } }],
    });
    expect(ok.finding?.classification).toBe('confirmed');
  });
});

describe('fingerprint and dedupe', () => {
  it('is stable and ignores volatile ids', () => {
    expect(fingerprint('axe:image-alt', 'img.hero', URL1)).toBe(
      fingerprint('axe:image-alt', 'img.hero', URL1),
    );
    expect(fingerprint('axe:image-alt', '#x12345', URL1)).toBe(
      fingerprint('axe:image-alt', '#x98765', URL1),
    );
    expect(fingerprint('axe:image-alt', 'img.a', URL1)).not.toBe(
      fingerprint('axe:image-alt', 'img.b', URL1),
    );
  });
  it('merges duplicates, keeps strongest classification and sums occurrences', () => {
    const { findings } = processFindings(
      [
        raw({ classification: 'strong_potential' }),
        raw({
          evidence: [{ kind: 'selector', content: { selector: 'img.hero' } }],
        }),
      ],
      URL1,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.occurrences).toBe(2);
    expect(findings[0]?.classification).toBe('confirmed');
    expect(findings[0]?.evidence.length).toBe(2);
  });
  it('orders confirmed before potential and confidence follows classification', () => {
    const { findings } = processFindings(
      [
        raw({
          ruleId: 'custom:generic-link-text',
          selector: 'a.x',
          classification: 'strong_potential',
        }),
        raw({}),
      ],
      URL1,
    );
    expect(findings.map((f) => f.classification)).toEqual(['confirmed', 'strong_potential']);
    const [c, p] = findings;
    expect((c?.confidence ?? 0) > (p?.confidence ?? 100)).toBe(true);
  });
});

describe('manual tasks', () => {
  it('creates one task per manual finding with instructions', () => {
    const { findings } = processFindings(
      [
        raw({
          ruleId: 'manual:media-alternatives',
          classification: 'manual_verification',
          selector: 'video',
        }),
      ],
      URL1,
    );
    const tasks = manualTasksFor(findings);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.instructions.length).toBeGreaterThan(20);
  });
});
