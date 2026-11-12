export type Classification =
  'confirmed' | 'strong_potential' | 'manual_verification' | 'informational';
export type Severity = 'critical' | 'serious' | 'moderate' | 'minor' | 'none';
export type RuleSource = 'axe' | 'custom' | 'interaction';
export type EvidenceKind =
  | 'html_snippet'
  | 'selector'
  | 'computed_style'
  | 'accessible_name'
  | 'screenshot'
  | 'interaction_trace'
  | 'check_data';
export type WcagLevel = 'A' | 'AA' | 'AAA';
export type WcagVersion = '2.0' | '2.1' | '2.2';

/**
 * deterministic: a failure is a failure (axe violation on a well-defined rule).
 * heuristic: the check can be wrong in legitimate designs, so it never reaches "confirmed".
 * manual: the rule only produces human verification tasks.
 */
export type Reliability = 'deterministic' | 'heuristic' | 'manual';

export interface RuleDef {
  id: string;
  source: RuleSource;
  title: string;
  description: string;
  wcagCriteria: string[];
  wcagLevel: WcagLevel | null;
  wcagVersion: WcagVersion | null;
  defaultSeverity: Severity;
  helpUrl: string | null;
  reliability: Reliability;
  engineVersion: string;
}

export interface Evidence {
  kind: EvidenceKind;
  content: Record<string, unknown>;
  blobBase64?: string;
  contentType?: string;
}

/** What a detector emits, before normalisation, validation and confidence scoring. */
export interface RawFinding {
  ruleId: string;
  message: string;
  selector: string | null;
  classification: Classification;
  severity: Severity;
  evidence: Evidence[];
  /** True when the failure was observed on at least two independent attempts. */
  reproduced?: boolean;
  occurrences?: number;
}

export interface Finding extends RawFinding {
  fingerprint: string;
  /** Ranking aid 0-100, not a probability. */
  confidence: number;
  wcagCriteria: string[];
  validationNotes: string[];
}

export interface ManualTask {
  ruleId: string;
  instructions: string;
  /** Fingerprint of the related finding, when the task came from one. */
  findingFingerprint?: string;
}

export interface Rejection {
  ruleId: string;
  reason: string;
}

export interface PageAnalysis {
  findings: Finding[];
  manualTasks: ManualTask[];
  rejected: Rejection[];
  passedRules: number;
  /** What actually ran, so the UI can state coverage honestly. */
  coverage: {
    axe: boolean;
    custom: boolean;
    interaction: boolean;
    interactionsAttempted: number;
    interactionsSkipped: string[];
  };
}

export interface AnalyzeOptions {
  wcagVersion: WcagVersion;
  level: WcagLevel;
  interactionTests: boolean;
  includeBestPractices?: boolean;
  maxScreenshots?: number;
  maxInteractions?: number;
}
