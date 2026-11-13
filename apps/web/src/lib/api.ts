/** Typed client for the AccessAudit API. Cookies carry the session; mutations echo the CSRF cookie. */

const BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const m = /(?:^|;\s*)aa_csrf=([^;]+)/.exec(document.cookie);
  return m?.[1] ? decodeURIComponent(m[1]) : '';
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'Cannot reach the server. Check your connection and try again.',
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const e = (
      json as {
        error?: { code?: string; message?: string; requestId?: string; details?: unknown };
      } | null
    )?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'UNKNOWN',
      e?.message ?? `Request failed (${String(res.status)}).`,
      e?.requestId,
      e?.details,
    );
  }
  return json as T;
}

export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export interface User {
  id: string;
  email: string;
  name: string;
}
export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
}
export interface Project {
  id: string;
  name: string;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
}
export interface Member {
  userId: string;
  role: Role;
  email: string;
  name: string;
  joinedAt: string;
}
export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}
export interface Schedule {
  id: string;
  projectId: string;
  frequency: 'daily' | 'weekly';
  maxPages: number;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastScanId: string | null;
  lastError: string | null;
}

/** Credentials are write-only: the API never returns them. */
export interface AuthProfile {
  id: string;
  projectId: string;
  name: string;
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  successSelector: string;
  createdAt: string;
}

export interface Domain {
  id: string;
  projectId: string;
  hostname: string;
  method: 'dns_txt' | 'well_known' | 'meta_tag';
  status: 'pending' | 'verified' | 'failed' | 'expired' | 'revoked';
  verifiedAt: string | null;
  lastVerifiedAt: string | null;
  nextRevalidateAt: string | null;
  failedChecks: number;
  lastFailureReason: string | null;
  createdAt: string;
}
export type VerificationInstructions =
  | { type: 'dns_txt'; recordName: string; recordValue: string }
  | { type: 'well_known'; url: string; fileContent: string }
  | { type: 'meta_tag'; url: string; tag: string };

export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type Classification =
  'confirmed' | 'strong_potential' | 'manual_verification' | 'informational';
export type Severity = 'critical' | 'serious' | 'moderate' | 'minor';
export type ReviewStatus = 'open' | 'false_positive' | 'accepted_risk' | 'fixed';
export type TaskStatus = 'pending' | 'passed' | 'failed' | 'not_applicable';

export interface Scan {
  id: string;
  projectId: string;
  status: ScanStatus;
  startUrl: string;
  maxPages: number;
  wcagVersion: string;
  conformanceLevel: string;
  interactionTests: boolean;
  failureReason: string | null;
  engineVersions: Record<string, string> | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}
/** Row in the scan list: open finding counts are included by the list endpoint only. */
export interface ScanListItem extends Scan {
  openConfirmed: number;
  openPotential: number;
}
export interface ScanPage {
  id: string;
  url: string;
  title: string | null;
  status: string;
  failureReason: string | null;
  httpStatus: number | null;
  domNodes: number | null;
  depth: number;
  confirmed: number;
  potential: number;
  manual: number;
}
export interface ScanDetail {
  scan: Scan;
  summary: {
    byClassification: Partial<Record<Classification, number>>;
    bySeverity: Partial<Record<Severity, number>>;
    manualTasks: Partial<Record<TaskStatus, number>>;
    pagesScanned: number;
    pagesNotScanned: number;
  };
  pages: ScanPage[];
}
export interface FindingRow {
  id: string;
  ruleId: string;
  ruleTitle: string;
  classification: Classification;
  confidence: number;
  severity: Severity;
  wcagCriteria: string[];
  message: string;
  selector: string | null;
  occurrences: number;
  reviewStatus: ReviewStatus;
  pageId: string;
  pageUrl: string;
}
export interface Evidence {
  id: string;
  kind: string;
  content: unknown;
  blobBase64: string | null;
  contentType: string | null;
}
export interface ManualTask {
  id: string;
  ruleId: string;
  ruleTitle: string;
  wcagCriteria: string[];
  findingId: string | null;
  instructions: string;
  status: TaskStatus;
  note: string | null;
}
export interface FindingDetail {
  finding: {
    id: string;
    scanId: string;
    ruleId: string;
    ruleTitle: string;
    ruleDescription: string;
    helpUrl: string | null;
    classification: Classification;
    confidence: number;
    severity: Severity;
    wcagCriteria: string[];
    message: string;
    selector: string | null;
    occurrences: number;
    reviewStatus: ReviewStatus;
    reviewedAt: string | null;
    assigneeId: string | null;
    pageUrl: string;
  };
  evidence: Evidence[];
  tasks: { id: string; instructions: string; status: TaskStatus; note: string | null }[];
}
export interface Explanation {
  source: 'template' | 'ai';
  provider: string;
  guidance: 'rule-specific' | 'generic';
  summary: string;
  whyItMatters: string;
  howToFix: string[];
  verify: string;
  disclaimer: string;
}
export interface FindingActivity {
  comments: { id: string; authorId: string | null; body: string; createdAt: string }[];
  history: {
    id: string;
    actorId: string | null;
    kind: string;
    fromValue: string | null;
    toValue: string | null;
    createdAt: string;
  }[];
}
export interface QuickFinding {
  ruleId: string;
  ruleTitle: string;
  classification: Classification;
  confidence: number;
  severity: Severity;
  wcagCriteria: string[];
  message: string;
  selector: string | null;
  occurrences: number;
  evidence: { kind: string; content: unknown }[];
}
export type QuickResult =
  | {
      status: 'done';
      url: string;
      finalUrl: string;
      title: string | null;
      findings: QuickFinding[];
      manualTasks: { ruleId: string; instructions: string }[];
      coverage: { interaction: boolean; note: string };
      engine: Record<string, string>;
    }
  | { status: 'blocked'; reason: string };

export type SeverityCounts = Partial<Record<Severity, number>>;

export interface OverviewScan {
  id: string;
  finishedAt: string | null;
  wcagVersion: string;
  conformanceLevel: string;
  maxPages: number;
  confirmed: SeverityCounts;
  potential: SeverityCounts;
  manualTasksOpen: number;
  pagesScanned: number;
  pagesNotScanned: number;
}

export interface OverviewProject {
  id: string;
  name: string;
  baseUrl: string;
  latestScan: OverviewScan | null;
}

export interface Overview {
  projects: OverviewProject[];
  totals: {
    projects: number;
    projectsScanned: number;
    confirmed: number;
    potential: number;
    manualTasksOpen: number;
    pagesScanned: number;
    pagesNotScanned: number;
  };
}

export const CLASS_LABEL: Record<Classification, string> = {
  confirmed: 'Confirmed violation',
  strong_potential: 'Potential violation',
  manual_verification: 'Needs manual check',
  informational: 'Informational',
};
export const CLASS_HELP: Record<Classification, string> = {
  confirmed: 'Reproducible failure backed by evidence.',
  strong_potential: 'Likely a problem, but a person should confirm it.',
  manual_verification: 'Automation cannot decide. A person must check.',
  informational: 'Context only. Not a failure.',
};

export interface CompareItem {
  id: string;
  ruleId: string;
  ruleTitle: string;
  classification: Classification;
  severity: string;
  selector: string | null;
  pageUrl: string;
}
export interface CompareResult {
  baseline: { id: string; createdAt: string } | null;
  current: { id: string };
  comparison: {
    counts: {
      added: number;
      resolved: number;
      regressed: number;
      unchanged: number;
      notRechecked: number;
    };
    added: CompareItem[];
    resolved: CompareItem[];
    regressed: CompareItem[];
    notRechecked: CompareItem[];
  } | null;
}
export interface Coverage {
  pages: { discovered: number; scanned: number; notScanned: number };
  notScannedPages: { url: string; status: string; failureReason: string | null }[];
  reachedPageLimit: boolean;
  limits: string[];
}

export type ReportFormat = 'json' | 'csv' | 'html' | 'pdf';

/** Downloads a report through the authenticated API and saves it as a file. */
export async function downloadReport(
  orgId: string,
  scanId: string,
  format: ReportFormat,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/orgs/${orgId}/scans/${scanId}/report?format=${format}`, {
      credentials: 'include',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }
  if (!res.ok) {
    let message = `Export failed (${String(res.status)}).`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) message = j.error.message;
    } catch {
      /* keep default message */
    }
    throw new ApiError(res.status, 'EXPORT_FAILED', message);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `accessibility-report-${scanId.slice(0, 8)}.${format}`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
export const atLeast = (have: Role, need: Role): boolean => ROLE_RANK[have] >= ROLE_RANK[need];
