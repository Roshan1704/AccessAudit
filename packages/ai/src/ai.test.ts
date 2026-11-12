import { describe, expect, it } from 'vitest';
import { TemplateProvider, buildExplainInput, redactText } from './index.js';

const base = {
  ruleId: 'axe:image-alt',
  ruleTitle: 'Images must have alternative text',
  ruleDescription: 'Ensures <img> elements have alternate text',
  wcagCriteria: ['1.1.1'],
  severity: 'critical' as const,
  classification: 'confirmed' as const,
  message: 'Image has no text alternative',
};

describe('redaction', () => {
  it('removes urls, emails and long tokens', () => {
    const out = redactText(
      'see https://secret.example.com/a?token=1 mail bob@corp.com key abcdefghijklmnopqrstuvwxyz0123456789',
    );
    expect(out).not.toMatch(/secret\.example|bob@|abcdefghijklmnop/);
    expect(out).toContain('[url]');
    expect(out).toContain('[email]');
    expect(out).toContain('[token]');
  });

  it('redacts the message inside the provider input', () => {
    const i = buildExplainInput({ ...base, message: 'broken at https://x.example.org/p' });
    expect(i.message).toBe('broken at [url]');
  });
});

describe('TemplateProvider', () => {
  const p = new TemplateProvider();

  it('is deterministic and labelled as a template', async () => {
    const i = buildExplainInput(base);
    const a = await p.explain(i);
    expect(a).toEqual(await p.explain(i));
    expect(a.source).toBe('template');
    expect(a.howToFix[0]).toContain('alt');
  });

  it('falls back to generic guidance for unknown rules', async () => {
    const a = await p.explain(buildExplainInput({ ...base, ruleId: 'custom:thing' }));
    expect(a.howToFix.length).toBeGreaterThan(0);
  });

  it('warns that unconfirmed findings need checking', async () => {
    const a = await p.explain(buildExplainInput({ ...base, classification: 'strong_potential' }));
    expect(a.summary).toContain('not a confirmed failure');
  });
});
