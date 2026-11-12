import type { Severity } from './types.js';

/** Map an axe impact string to our severity scale. Unknown or missing impact becomes "moderate". */
export function severityFromImpact(impact: string | null | undefined): Severity {
  switch (impact) {
    case 'critical':
      return 'critical';
    case 'serious':
      return 'serious';
    case 'minor':
      return 'minor';
    case 'moderate':
      return 'moderate';
    default:
      return 'moderate';
  }
}
