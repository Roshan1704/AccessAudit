import { z } from 'zod';

/**
 * AI provider abstraction (Phase 4). Providers receive only the redacted input below:
 * rule metadata and a scrubbed message. Page URLs, selectors, evidence and user data
 * never cross this boundary.
 */

export const explainInputSchema = z.object({
  ruleId: z.string().min(1).max(200),
  ruleTitle: z.string().max(500),
  ruleDescription: z.string().max(2000),
  wcagCriteria: z.array(z.string().max(20)).max(20),
  severity: z.enum(['critical', 'serious', 'moderate', 'minor', 'none']),
  classification: z.enum(['confirmed', 'strong_potential', 'manual_verification', 'informational']),
  message: z.string().max(1000),
});
export type ExplainInput = z.infer<typeof explainInputSchema>;

export const explanationSchema = z.object({
  /** Who wrote it. Always shown to the user so nobody mistakes a template for a model. */
  source: z.enum(['template', 'ai']),
  provider: z.string().max(100),
  summary: z.string().max(1000),
  whyItMatters: z.string().max(1000),
  howToFix: z.array(z.string().max(500)).min(1).max(10),
  verify: z.string().max(500),
  disclaimer: z.string().max(500),
});
export type Explanation = z.infer<typeof explanationSchema>;

export interface AiProvider {
  readonly name: string;
  explain(input: ExplainInput): Promise<Explanation>;
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;

/** Remove anything that could identify a page, person or secret from free text. */
export function redactText(text: string): string {
  return text
    .replace(URL_RE, '[url]')
    .replace(EMAIL_RE, '[email]')
    .replace(LONG_TOKEN_RE, '[token]')
    .slice(0, 1000);
}

export function buildExplainInput(raw: {
  ruleId: string;
  ruleTitle: string;
  ruleDescription: string;
  wcagCriteria: string[];
  severity: ExplainInput['severity'];
  classification: ExplainInput['classification'];
  message: string;
}): ExplainInput {
  return explainInputSchema.parse({
    ruleId: raw.ruleId,
    ruleTitle: raw.ruleTitle,
    ruleDescription: raw.ruleDescription,
    wcagCriteria: raw.wcagCriteria,
    severity: raw.severity,
    classification: raw.classification,
    message: redactText(raw.message),
  });
}

interface Guidance {
  why: string;
  fix: string[];
  verify: string;
}

/** Hand-written guidance for the most common axe rules. Keys are axe rule ids without the prefix. */
const RULE_GUIDANCE: Record<string, Guidance> = {
  'image-alt': {
    why: 'People using screen readers get no description of the image.',
    fix: [
      'Add an alt attribute that says what the image conveys.',
      'Use alt="" if the image is purely decorative.',
    ],
    verify: 'Turn on a screen reader or inspect the accessibility tree and read the image name.',
  },
  'color-contrast': {
    why: 'Low contrast text is hard or impossible to read for people with low vision.',
    fix: [
      'Raise the contrast ratio to at least 4.5:1 (3:1 for large text).',
      'Change the text or background colour; do not rely on opacity.',
    ],
    verify: 'Re-measure with a contrast checker, including hover and focus states.',
  },
  label: {
    why: 'Without a label, assistive technology cannot tell users what to type.',
    fix: [
      'Associate a visible <label for> with the input id.',
      'If no visible label fits, use aria-labelledby or aria-label.',
    ],
    verify:
      'Click the label; focus should move to the field. Check the field name in a screen reader.',
  },
  'link-name': {
    why: 'A link with no name is announced as just "link".',
    fix: [
      'Give the link visible text that states its destination.',
      'For icon links, add an accessible name with aria-label or visually hidden text.',
    ],
    verify: 'List links in a screen reader and confirm each one makes sense alone.',
  },
  'button-name': {
    why: 'A button with no name is announced as just "button".',
    fix: ['Put descriptive text inside the button.', 'For icon buttons, add aria-label.'],
    verify: 'Tab to the button and read its name in a screen reader.',
  },
  'html-has-lang': {
    why: 'Screen readers pick the pronunciation language from the page language.',
    fix: ['Add a valid lang attribute to the <html> element, for example lang="en".'],
    verify: 'Inspect the <html> element.',
  },
  'document-title': {
    why: 'The title is the first thing a screen reader announces and labels the browser tab.',
    fix: ['Add a short, unique <title> that describes the page.'],
    verify: 'Check the browser tab and the page source.',
  },
  'heading-order': {
    why: 'Skipped heading levels break the outline people use to navigate.',
    fix: ['Make headings follow a logical order without skipping levels.'],
    verify: 'List headings in a screen reader or an outline tool.',
  },
  'aria-valid-attr-value': {
    why: 'Invalid ARIA values make assistive technology ignore or misreport the element.',
    fix: ['Correct the attribute value, or remove ARIA and use native HTML.'],
    verify: 'Re-run the check and test with a screen reader.',
  },
};

const GENERIC_FIX = [
  'Read the linked rule guidance for the exact failing pattern.',
  'Prefer native HTML elements over custom widgets with ARIA.',
  'Fix the element, then re-scan to confirm the finding is gone.',
];

/**
 * Deterministic, offline provider. Same input gives the same output, needs no key or network.
 * It is rule-level guidance, not an analysis of the page.
 */
export class TemplateProvider implements AiProvider {
  readonly name = 'template-v1';

  explain(input: ExplainInput): Promise<Explanation> {
    const key = input.ruleId.replace(/^axe:/, '');
    const g = RULE_GUIDANCE[key];
    const wcag =
      input.wcagCriteria.length > 0 ? ` It relates to WCAG ${input.wcagCriteria.join(', ')}.` : '';
    const hedge =
      input.classification === 'confirmed'
        ? ''
        : ' This is not a confirmed failure, so check it before changing anything.';
    return Promise.resolve({
      source: 'template',
      provider: this.name,
      summary: `${input.ruleTitle}.${wcag}${hedge}`,
      whyItMatters:
        g?.why ?? 'This pattern can stop some people from perceiving or operating the content.',
      howToFix: g?.fix ?? GENERIC_FIX,
      verify: g?.verify ?? 'Re-scan and test the element with a keyboard and a screen reader.',
      disclaimer:
        'Generated from fixed templates for this rule, not from your page. Review before applying.',
    });
  }
}

export function defaultProvider(): AiProvider {
  return new TemplateProvider();
}
