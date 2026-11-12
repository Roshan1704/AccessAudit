import axe from 'axe-core';
import type { AnalyzeOptions, RuleDef, Severity, WcagLevel, WcagVersion } from './types.js';

export const AXE_VERSION: string = axe.version;
export const ENGINE_VERSION = '0.1.0';

const SC_TAG = /^wcag(\d)(\d)(\d{1,2})$/;
const LEVEL_TAGS: Record<string, { level: WcagLevel; version: WcagVersion }> = {
  wcag2a: { level: 'A', version: '2.0' },
  wcag2aa: { level: 'AA', version: '2.0' },
  wcag2aaa: { level: 'AAA', version: '2.0' },
  wcag21a: { level: 'A', version: '2.1' },
  wcag21aa: { level: 'AA', version: '2.1' },
  wcag22aa: { level: 'AA', version: '2.2' },
};

const LEVEL_ORDER: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };
const VERSION_ORDER: Record<WcagVersion, number> = { '2.0': 0, '2.1': 1, '2.2': 2 };

/** Axe rules whose pass/fail depends on author intent or design, so a failure is never auto-confirmed. */
const AXE_HEURISTIC = new Set([
  'link-in-text-block',
  'target-size',
  'scrollable-region-focusable',
  'region',
  'label-title-only',
  'identical-links-same-purpose',
  'heading-order',
  'page-has-heading-one',
  'landmark-unique',
  'css-orientation-lock',
  'p-as-heading',
  'avoid-inline-spacing',
  'label-content-name-mismatch',
  'autocomplete-valid',
]);

export function parseWcagTags(tags: readonly string[]): {
  criteria: string[];
  level: WcagLevel | null;
  version: WcagVersion | null;
} {
  const criteria: string[] = [];
  let level: WcagLevel | null = null;
  let version: WcagVersion | null = null;
  for (const t of tags) {
    const m = SC_TAG.exec(t);
    if (m !== null) criteria.push(`${m[1] ?? ''}.${m[2] ?? ''}.${m[3] ?? ''}`);
    const l = LEVEL_TAGS[t];
    if (l !== undefined) {
      level = l.level;
      version = l.version;
    }
  }
  return { criteria, level, version };
}

function axeRuleDefs(): RuleDef[] {
  return axe.getRules().map((r) => {
    const w = parseWcagTags(r.tags);
    const deprecated = r.tags.includes('deprecated');
    const experimental = r.tags.includes('experimental');
    return {
      id: `axe:${r.ruleId}`,
      source: 'axe' as const,
      title: r.help,
      description: r.description,
      wcagCriteria: w.criteria,
      wcagLevel: w.level,
      wcagVersion: w.version,
      defaultSeverity: 'moderate',
      helpUrl: r.helpUrl,
      reliability:
        AXE_HEURISTIC.has(r.ruleId) || experimental || deprecated
          ? ('heuristic' as const)
          : ('deterministic' as const),
      engineVersion: AXE_VERSION,
    };
  });
}

function custom(
  id: string,
  source: 'custom' | 'interaction',
  title: string,
  description: string,
  wcagCriteria: string[],
  level: WcagLevel,
  version: WcagVersion,
  severity: Severity,
  reliability: RuleDef['reliability'],
): RuleDef {
  return {
    id,
    source,
    title,
    description,
    wcagCriteria,
    wcagLevel: level,
    wcagVersion: version,
    defaultSeverity: severity,
    helpUrl: `https://www.w3.org/WAI/WCAG22/Understanding/${slug(wcagCriteria[0] ?? '')}`,
    reliability,
    engineVersion: ENGINE_VERSION,
  };
}

function slug(sc: string): string {
  const names: Record<string, string> = {
    '1.3.1': 'info-and-relationships',
    '1.3.5': 'identify-input-purpose',
    '1.4.10': 'reflow',
    '2.1.1': 'keyboard',
    '2.1.2': 'no-keyboard-trap',
    '2.4.3': 'focus-order',
    '2.4.4': 'link-purpose-in-context',
    '2.4.7': 'focus-visible',
    '3.3.1': 'error-identification',
    '3.3.2': 'labels-or-instructions',
    '4.1.2': 'name-role-value',
    '4.1.3': 'status-messages',
    '1.2.2': 'captions-prerecorded',
    '1.2.1': 'audio-only-and-video-only-prerecorded',
    '2.2.2': 'pause-stop-hide',
    '1.3.3': 'sensory-characteristics',
    '2.4.11': 'focus-not-obscured-minimum',
  };
  return names[sc] ?? '';
}

/** Rules implemented by this project. IDs are stable; they are persisted with every finding. */
const CUSTOM_RULES: RuleDef[] = [
  custom(
    'custom:focus-indicator',
    'custom',
    'Focused element has no visible focus indicator',
    'Moving keyboard focus to an interactive element produced no measurable change in outline, box-shadow, border or background.',
    ['2.4.7'],
    'AA',
    '2.0',
    'serious',
    'deterministic',
  ),
  custom(
    'custom:focus-hidden',
    'custom',
    'Focusable element is visually hidden',
    'An element that can receive keyboard focus is invisible or positioned off screen, so focus can land on nothing.',
    ['2.4.7', '2.4.3'],
    'AA',
    '2.0',
    'moderate',
    'heuristic',
  ),
  custom(
    'custom:generic-link-text',
    'custom',
    'Link text does not describe its purpose',
    'The accessible name of a link is a generic phrase such as "click here" or "read more" with no extra context.',
    ['2.4.4'],
    'A',
    '2.0',
    'moderate',
    'heuristic',
  ),
  custom(
    'custom:placeholder-only-label',
    'custom',
    'Form field is labelled only by its placeholder',
    'The only source of the field accessible name is the placeholder attribute, which disappears on input.',
    ['3.3.2', '4.1.2'],
    'A',
    '2.0',
    'serious',
    'deterministic',
  ),
  custom(
    'custom:missing-autocomplete',
    'custom',
    'Personal-data field has no autocomplete attribute',
    'A field that collects the user email, phone, name or address has no autocomplete token, so browsers and assistive tools cannot fill it.',
    ['1.3.5'],
    'AA',
    '2.1',
    'moderate',
    'heuristic',
  ),
  custom(
    'custom:group-no-legend',
    'custom',
    'Radio or checkbox group has no group label',
    'Several radio buttons share a name but are not inside a fieldset with a legend or a labelled role=group/radiogroup.',
    ['1.3.1', '3.3.2'],
    'A',
    '2.0',
    'moderate',
    'heuristic',
  ),
  custom(
    'custom:required-not-programmatic',
    'custom',
    'Required field is only marked visually',
    'The label shows a required marker (asterisk or "required") but the field has neither the required nor the aria-required attribute.',
    ['3.3.2', '1.3.1'],
    'A',
    '2.0',
    'moderate',
    'heuristic',
  ),
  custom(
    'custom:reflow',
    'custom',
    'Content needs horizontal scrolling at 320 CSS pixels',
    'At a 320 px viewport width the document is wider than the viewport, which suggests content is lost or requires two-dimensional scrolling.',
    ['1.4.10'],
    'AA',
    '2.1',
    'moderate',
    'heuristic',
  ),
  custom(
    'interaction:keyboard-unreachable',
    'interaction',
    'Interactive element cannot be reached with the keyboard',
    'A mouse-clickable element with an interactive role or click handler was not reached by Tab or reverse-Tab traversal.',
    ['2.1.1'],
    'A',
    '2.0',
    'serious',
    'heuristic',
  ),
  custom(
    'interaction:keyboard-trap',
    'interaction',
    'Keyboard focus cannot leave a component',
    'Repeated Tab presses cycled inside a small set of elements without ever reaching the rest of the page.',
    ['2.1.2'],
    'A',
    '2.0',
    'critical',
    'heuristic',
  ),
  custom(
    'interaction:dialog-focus',
    'interaction',
    'Dialog does not move or contain focus',
    'After opening a dialog with the keyboard, focus did not move into it, or Tab moved focus behind it.',
    ['2.4.3', '4.1.2'],
    'A',
    '2.0',
    'serious',
    'heuristic',
  ),
  custom(
    'interaction:dialog-escape',
    'interaction',
    'Dialog does not close with Escape',
    'Pressing Escape inside an open modal dialog left it open.',
    ['2.1.1'],
    'A',
    '2.0',
    'moderate',
    'heuristic',
  ),
  custom(
    'interaction:dialog-focus-return',
    'interaction',
    'Focus is not returned after the dialog closes',
    'After closing a dialog, focus did not return to the control that opened it.',
    ['2.4.3'],
    'A',
    '2.0',
    'moderate',
    'heuristic',
  ),
  custom(
    'interaction:form-error-association',
    'interaction',
    'Validation error is not associated with its field',
    'After triggering native validation on an empty required field, no error text was exposed through aria-describedby, aria-errormessage or a live region.',
    ['3.3.1'],
    'A',
    '2.0',
    'serious',
    'heuristic',
  ),
  custom(
    'interaction:menu-keyboard',
    'interaction',
    'Menu button does not follow keyboard conventions',
    'A control with aria-haspopup did not expose its expanded state, or its popup could not be operated with the keyboard.',
    ['2.1.1', '4.1.2'],
    'A',
    '2.0',
    'serious',
    'heuristic',
  ),
  custom(
    'interaction:tab-pattern',
    'interaction',
    'Tabs do not follow the WAI-ARIA tabs pattern',
    'Selecting a tab did not update aria-selected, or its panel was not exposed.',
    ['4.1.2', '2.1.1'],
    'A',
    '2.0',
    'serious',
    'heuristic',
  ),
  custom(
    'interaction:disclosure-state',
    'interaction',
    'Disclosure control does not expose its state',
    'Activating an accordion or disclosure button changed the content but aria-expanded did not change accordingly.',
    ['4.1.2'],
    'A',
    '2.0',
    'serious',
    'heuristic',
  ),
  custom(
    'interaction:dynamic-status',
    'interaction',
    'Dynamic update is not announced',
    'Content changed after an interaction but no live region (role=status, role=alert or aria-live) contained the change.',
    ['4.1.3'],
    'AA',
    '2.1',
    'moderate',
    'heuristic',
  ),
  custom(
    'manual:media-alternatives',
    'custom',
    'Time-based media needs captions and alternatives',
    'The page contains audio or video. Automated tools cannot judge caption quality or audio description.',
    ['1.2.1', '1.2.2'],
    'A',
    '2.0',
    'serious',
    'manual',
  ),
  custom(
    'manual:motion-control',
    'custom',
    'Moving or auto-updating content needs a control',
    'The page contains animation, a carousel or auto-refreshing content that may need pause, stop or hide controls.',
    ['2.2.2'],
    'A',
    '2.0',
    'moderate',
    'manual',
  ),
  custom(
    'manual:focus-not-obscured',
    'custom',
    'Focused element may be hidden by sticky content',
    'The page has fixed or sticky positioned content that could cover a focused element.',
    ['2.4.11'],
    'AA',
    '2.2',
    'moderate',
    'manual',
  ),
  custom(
    'manual:sensory-characteristics',
    'custom',
    'Instructions may rely on shape, colour or position',
    'Text on the page refers to shape, colour, size or position. A person must check the instruction is also understandable without sensory cues.',
    ['1.3.3'],
    'A',
    '2.0',
    'minor',
    'manual',
  ),
];

const ALL: RuleDef[] = [...axeRuleDefs(), ...CUSTOM_RULES];
const BY_ID = new Map(ALL.map((r) => [r.id, r]));

export function allRules(): readonly RuleDef[] {
  return ALL;
}

export function getRule(id: string): RuleDef | undefined {
  return BY_ID.get(id);
}

/** Does a rule belong in a scan configured for this WCAG version and conformance level? */
export function ruleApplies(
  rule: RuleDef,
  opts: Pick<AnalyzeOptions, 'wcagVersion' | 'level' | 'includeBestPractices'>,
): boolean {
  if (rule.wcagLevel === null || rule.wcagVersion === null)
    return opts.includeBestPractices === true;
  return (
    LEVEL_ORDER[rule.wcagLevel] <= LEVEL_ORDER[opts.level] &&
    VERSION_ORDER[rule.wcagVersion] <= VERSION_ORDER[opts.wcagVersion]
  );
}

/** Axe rule ids that should run for these options (without the `axe:` prefix). */
export function axeRuleIdsFor(opts: AnalyzeOptions): string[] {
  const deprecated = new Set(
    axe
      .getRules()
      .filter((x) => x.tags.includes('deprecated'))
      .map((x) => `axe:${x.ruleId}`),
  );
  return ALL.filter((r) => r.source === 'axe' && !deprecated.has(r.id) && ruleApplies(r, opts)).map(
    (r) => r.id.slice(4),
  );
}
