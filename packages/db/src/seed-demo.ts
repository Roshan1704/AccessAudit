/**
 * Opt-in DEMO dataset. Separate from `db:seed`, which stays data-free by product rule.
 *
 * Everything created here is fictional and labelled as demo data: the organization is named
 * "Demo Org (sample data)", hostnames use the reserved `.example` TLD, and no finding claims
 * to come from a real external website.
 *
 * Run with the owner/migrator connection (aa_api cannot write evidence or rules):
 *   MIGRATION_DATABASE_URL=... npm run db:seed:demo -w @accessaudit/db
 * Idempotent: does nothing when the demo organization already exists.
 * Refuses to run when NODE_ENV=production.
 */
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { Argon2PasswordHasher, generateToken, hashToken } from '@accessaudit/security';
import { createDb, withTenant } from './client.js';
import {
  accessibilityRules,
  auditLogs,
  authorizedDomains,
  crawledPages,
  findingComments,
  findingEvidence,
  findingHistory,
  findings,
  manualVerificationTasks,
  organizationMembers,
  organizations,
  projectSettings,
  projects,
  scans,
  users,
} from './schema.js';

export const DEMO_ORG_SLUG = 'demo-org-sample-data';
export const DEMO_EMAIL = 'demo.owner@accessaudit.example';
export const DEMO_PASSWORD = 'Demo-Password-Only-For-Local-Use-1!';

type Cls = 'confirmed' | 'strong_potential' | 'manual_verification' | 'informational';
type Sev = 'critical' | 'serious' | 'moderate' | 'minor' | 'none';
type Review = 'open' | 'false_positive' | 'accepted_risk' | 'fixed';

interface Rule {
  id: string;
  source: 'axe' | 'custom';
  title: string;
  description: string;
  wcag: string[];
  level: 'A' | 'AA';
  sev: Sev;
}

const RULES: Rule[] = [
  {
    id: 'axe:color-contrast',
    source: 'axe',
    title: 'Text contrast is below the minimum',
    description: 'Text must have a contrast ratio of at least 4.5:1 against its background.',
    wcag: ['1.4.3'],
    level: 'AA',
    sev: 'serious',
  },
  {
    id: 'axe:label',
    source: 'axe',
    title: 'Form field has no label',
    description:
      'Every form field needs an accessible name so assistive technology can announce it.',
    wcag: ['1.3.1', '4.1.2'],
    level: 'A',
    sev: 'critical',
  },
  {
    id: 'axe:image-alt',
    source: 'axe',
    title: 'Image has no alternative text',
    description: 'Informative images need a text alternative.',
    wcag: ['1.1.1'],
    level: 'A',
    sev: 'critical',
  },
  {
    id: 'axe:link-name',
    source: 'axe',
    title: 'Link has no discernible text',
    description: 'Links need text that describes where they go.',
    wcag: ['2.4.4', '4.1.2'],
    level: 'A',
    sev: 'serious',
  },
  {
    id: 'axe:button-name',
    source: 'axe',
    title: 'Button has no discernible text',
    description: 'Buttons need an accessible name.',
    wcag: ['4.1.2'],
    level: 'A',
    sev: 'critical',
  },
  {
    id: 'axe:heading-order',
    source: 'axe',
    title: 'Heading levels skip',
    description: 'Heading levels should only increase by one.',
    wcag: ['1.3.1'],
    level: 'A',
    sev: 'moderate',
  },
  {
    id: 'axe:landmark-one-main',
    source: 'axe',
    title: 'Page has no main landmark',
    description: 'A page should have one main landmark.',
    wcag: ['1.3.1'],
    level: 'A',
    sev: 'moderate',
  },
];

interface PageSpec {
  path: string;
  title: string;
  status: 'scanned' | 'failed' | 'skipped';
  reason?: string;
  httpStatus?: number;
}

interface FindingSpec {
  rule: string;
  page: number;
  selector: string;
  cls: Cls;
  sev: Sev;
  conf: number;
  occ: number;
  message: string;
  html: string;
  /** Present in the earlier scan / the later scan. */
  early: boolean;
  late: boolean;
  /** Review status in each scan (default open). */
  earlyReview?: Review;
  lateReview?: Review;
  comment?: string;
}

interface ProjectSpec {
  name: string;
  host: string;
  pages: PageSpec[];
  /** Pages (indexes) that were not scanned in the later scan although scanned earlier. */
  findings: FindingSpec[];
  latePageStatus?: Record<number, PageSpec['status']>;
  manual: { rule: string; instructions: string; resolved?: 'passed' | 'failed'; note?: string }[];
  failedScanReason?: string;
}

const PROJECTS: ProjectSpec[] = [
  {
    name: 'Northwind Shop (demo)',
    host: 'shop.northwind-demo.example',
    pages: [
      { path: '/', title: 'Home', status: 'scanned' },
      { path: '/products', title: 'All products', status: 'scanned' },
      { path: '/products/trail-shoe-2', title: 'Trail Shoe 2', status: 'scanned' },
      { path: '/cart', title: 'Your cart', status: 'scanned' },
      { path: '/checkout', title: 'Checkout', status: 'scanned' },
      { path: '/account/orders', title: 'Orders', status: 'failed', reason: 'navigation_timeout' },
      { path: '/admin', title: 'Admin', status: 'skipped', reason: 'excluded_by_robots' },
      { path: '/blog/archive/2019', title: 'Blog 2019', status: 'skipped', reason: 'page_cap' },
    ],
    latePageStatus: { 4: 'failed' },
    findings: [
      {
        rule: 'axe:label',
        page: 4,
        selector: 'form#payment > div.field:nth-of-type(2) > input[name="card-number"]',
        cls: 'confirmed',
        sev: 'critical',
        conf: 98,
        occ: 3,
        message: 'Form element does not have an accessible label.',
        html: '<input type="text" name="card-number" class="field-input" placeholder="Card number">',
        early: true,
        late: false,
        earlyReview: 'open',
      },
      {
        rule: 'axe:image-alt',
        page: 2,
        selector: 'main > section.gallery > figure:nth-child(1) > img.hero',
        cls: 'confirmed',
        sev: 'critical',
        conf: 97,
        occ: 4,
        message: 'Image has no alt attribute.',
        html: '<img class="hero" src="/img/trail-shoe-2-front.jpg" width="640" height="480">',
        early: true,
        late: true,
        comment: 'Design confirmed the alt text copy: "Trail Shoe 2, side view in forest green".',
      },
      {
        rule: 'axe:color-contrast',
        page: 1,
        selector: '#product-grid .card .price-tag',
        cls: 'confirmed',
        sev: 'serious',
        conf: 95,
        occ: 12,
        message: 'Text has a contrast ratio of 2.9:1 against its background; 4.5:1 is required.',
        html: '<span class="price-tag" style="color:#9aa4b2">$129.00</span>',
        early: true,
        late: true,
        earlyReview: 'fixed',
        comment: 'Marked fixed after the token change, but the old colour shipped again.',
      },
      {
        rule: 'axe:link-name',
        page: 0,
        selector: 'header .social a[href*="instagram"]',
        cls: 'strong_potential',
        sev: 'serious',
        conf: 80,
        occ: 3,
        message: 'Link contains only an icon and has no text alternative.',
        html: '<a href="https://social.example/northwind"><svg viewBox="0 0 24 24"></svg></a>',
        early: false,
        late: true,
      },
      {
        rule: 'axe:heading-order',
        page: 3,
        selector: 'main > section.summary > h4',
        cls: 'strong_potential',
        sev: 'moderate',
        conf: 70,
        occ: 1,
        message: 'Heading levels should only increase by one (h2 followed by h4).',
        html: '<h4 class="summary-title">Order summary</h4>',
        early: true,
        late: true,
        lateReview: 'accepted_risk',
      },
      {
        rule: 'axe:button-name',
        page: 0,
        selector: 'header button.cart-toggle',
        cls: 'confirmed',
        sev: 'critical',
        conf: 96,
        occ: 1,
        message: 'Button has no discernible text.',
        html: '<button class="cart-toggle"><svg aria-hidden="true"></svg></button>',
        early: false,
        late: true,
      },
      {
        rule: 'axe:landmark-one-main',
        page: 1,
        selector: 'html',
        cls: 'informational',
        sev: 'minor',
        conf: 60,
        occ: 1,
        message: 'Document does not have a main landmark.',
        html: '<html lang="en">…</html>',
        early: true,
        late: false,
      },
    ],
    manual: [
      {
        rule: 'axe:color-contrast',
        instructions: 'Check text over the hero banner image at 320 px and 1280 px wide.',
      },
      {
        rule: 'axe:label',
        instructions:
          'Tab through the checkout form and confirm the focus order matches the visual order.',
        resolved: 'passed',
        note: 'Order is correct on desktop and mobile.',
      },
      {
        rule: 'axe:link-name',
        instructions:
          'Listen to the footer links with a screen reader and confirm each makes sense alone.',
      },
    ],
    failedScanReason: 'navigation_timeout',
  },
  {
    name: 'Contoso Help Center (demo)',
    host: 'help.contoso-demo.example',
    pages: [
      { path: '/', title: 'Help home', status: 'scanned' },
      { path: '/articles/reset-password', title: 'Reset your password', status: 'scanned' },
      { path: '/articles/billing', title: 'Billing questions', status: 'scanned' },
      { path: '/contact', title: 'Contact support', status: 'scanned' },
    ],
    findings: [
      {
        rule: 'axe:label',
        page: 3,
        selector: 'form.contact > textarea#message',
        cls: 'confirmed',
        sev: 'critical',
        conf: 97,
        occ: 1,
        message: 'Form element does not have an accessible label.',
        html: '<textarea id="message" rows="6" placeholder="How can we help?"></textarea>',
        early: true,
        late: false,
        earlyReview: 'open',
      },
      {
        rule: 'axe:color-contrast',
        page: 0,
        selector: 'footer .legal a',
        cls: 'strong_potential',
        sev: 'serious',
        conf: 78,
        occ: 5,
        message: 'Text has a contrast ratio of 3.8:1 against its background; 4.5:1 is required.',
        html: '<a href="/legal" style="color:#8a94a6">Legal</a>',
        early: true,
        late: true,
        earlyReview: 'fixed',
      },
      {
        rule: 'axe:heading-order',
        page: 2,
        selector: 'article > h3:first-of-type',
        cls: 'strong_potential',
        sev: 'moderate',
        conf: 65,
        occ: 2,
        message: 'Heading levels should only increase by one.',
        html: '<h3>Refunds</h3>',
        early: false,
        late: true,
      },
    ],
    manual: [
      {
        rule: 'axe:link-name',
        instructions: 'Check that the search suggestions are announced when they appear.',
        resolved: 'failed',
        note: 'Suggestions are not announced by NVDA.',
      },
    ],
  },
  {
    name: 'Fabrikam Docs (demo)',
    host: 'docs.fabrikam-demo.example',
    pages: [
      { path: '/', title: 'Documentation', status: 'scanned' },
      { path: '/guide/install', title: 'Install guide', status: 'scanned' },
    ],
    findings: [
      {
        rule: 'axe:link-name',
        page: 1,
        selector: 'nav.toc a.anchor',
        cls: 'strong_potential',
        sev: 'minor',
        conf: 62,
        occ: 8,
        message: 'Anchor links have no accessible text.',
        html: '<a class="anchor" href="#step-1"></a>',
        early: true,
        late: true,
        lateReview: 'false_positive',
      },
    ],
    manual: [],
  },
];

function fp(rule: string, selector: string, path: string): string {
  return createHash('sha256').update(`${rule}|${selector}|${path}`).digest('hex').slice(0, 32);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A small illustrative PNG: a page-like frame with the affected region highlighted in red. */
function demoScreenshot(): string {
  const w = 320;
  const h = 160;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const o = row + 1 + x * 3;
      let rgb: [number, number, number] = [245, 247, 250];
      if (y < 24) rgb = [30, 41, 59];
      if (x > 20 && x < 300 && y > 40 && y < 56) rgb = [203, 213, 225];
      const hit = x > 60 && x < 260 && y > 80 && y < 120;
      if (hit) rgb = [255, 255, 255];
      const edge = hit && (x < 63 || x > 257 || y < 83 || y > 117);
      if (edge) rgb = [220, 38, 38];
      raw[o] = rgb[0];
      raw[o + 1] = rgb[1];
      raw[o + 2] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png.toString('base64');
}

const DAY = 86_400_000;

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production')
    throw new Error('Refusing to seed demo data in production.');
  const url = process.env['MIGRATION_DATABASE_URL'];
  if (!url) throw new Error('MIGRATION_DATABASE_URL (owner role) is required.');
  const handle = createDb(url, { max: 2 });
  try {
    const { db } = handle;
    const existing = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, DEMO_ORG_SLUG));
    if (existing.length > 0) {
      process.stdout.write('demo data already present; nothing to do\n');
      return;
    }

    const now = Date.now();
    const orgId = randomUUID();
    const ownerId = randomUUID();
    const reviewerId = randomUUID();
    const passwordHash = await new Argon2PasswordHasher().hash(DEMO_PASSWORD);
    const shot = demoScreenshot();

    await db.insert(users).values([
      {
        id: ownerId,
        email: DEMO_EMAIL,
        name: 'Dana Demo',
        passwordHash,
        emailVerifiedAt: new Date(now - 30 * DAY),
      },
      {
        id: reviewerId,
        email: 'demo.reviewer@accessaudit.example',
        name: 'Riley Reviewer',
        passwordHash,
        emailVerifiedAt: new Date(now - 30 * DAY),
      },
    ]);
    await db
      .insert(accessibilityRules)
      .values(
        RULES.map((r) => ({
          id: r.id,
          source: r.source,
          title: r.title,
          description: r.description,
          wcagCriteria: r.wcag,
          wcagLevel: r.level,
          defaultSeverity: r.sev,
          engineVersion: 'demo',
        })),
      )
      .onConflictDoNothing();

    await withTenant(db, { orgId, userId: ownerId }, async (tx) => {
      await tx.insert(organizations).values({
        id: orgId,
        slug: DEMO_ORG_SLUG,
        name: 'Demo Org (sample data)',
      });
      await tx.insert(organizationMembers).values([
        { organizationId: orgId, userId: ownerId, role: 'owner' },
        { organizationId: orgId, userId: reviewerId, role: 'member' },
      ]);

      for (const spec of PROJECTS) {
        const projectId = randomUUID();
        await tx.insert(projects).values({
          id: projectId,
          organizationId: orgId,
          name: spec.name,
          baseUrl: `https://${spec.host}/`,
          createdBy: ownerId,
        });
        await tx.insert(projectSettings).values({ organizationId: orgId, projectId });
        await tx.insert(authorizedDomains).values({
          organizationId: orgId,
          projectId,
          hostname: spec.host,
          verificationMethod: 'dns_txt',
          status: 'verified',
          tokenHash: hashToken(generateToken()),
          verifiedAt: new Date(now - 20 * DAY),
          lastVerifiedAt: new Date(now - 2 * DAY),
          verifiedBy: ownerId,
        });

        const scanIds: string[] = [];
        const findingIdByFp = new Map<string, string>();
        const phases = [
          { when: now - 14 * DAY, late: false },
          { when: now - 1 * DAY, late: true },
        ];
        for (const phase of phases) {
          const scanId = randomUUID();
          scanIds.push(scanId);
          await tx.insert(scans).values({
            id: scanId,
            organizationId: orgId,
            projectId,
            status: 'completed',
            startUrl: `https://${spec.host}/`,
            maxPages: spec.pages.length > 6 ? 6 : 10,
            wcagVersion: '2.2',
            conformanceLevel: 'AA',
            interactionTests: true,
            createdBy: ownerId,
            startedAt: new Date(phase.when),
            finishedAt: new Date(phase.when + 4 * 60_000),
            createdAt: new Date(phase.when),
            engineVersions: { demo: true },
          });
          const pageIds: string[] = [];
          for (const [i, p] of spec.pages.entries()) {
            const pid = randomUUID();
            pageIds.push(pid);
            const status = phase.late ? (spec.latePageStatus?.[i] ?? p.status) : p.status;
            const failed = status === 'failed';
            await tx.insert(crawledPages).values({
              id: pid,
              organizationId: orgId,
              scanId,
              url: `https://${spec.host}${p.path}`,
              finalUrl: status === 'scanned' ? `https://${spec.host}${p.path}` : null,
              httpStatus: status === 'scanned' ? 200 : null,
              title: p.title,
              status,
              failureReason: failed
                ? (p.reason ?? 'navigation_timeout')
                : status === 'skipped'
                  ? (p.reason ?? 'page_cap')
                  : null,
              domNodes: status === 'scanned' ? 400 + i * 130 : null,
              depth: p.path === '/' ? 0 : 1,
              scannedAt: status === 'scanned' ? new Date(phase.when + (i + 1) * 20_000) : null,
              createdAt: new Date(phase.when),
            });
          }
          for (const f of spec.findings) {
            if (!(phase.late ? f.late : f.early)) continue;
            const page = spec.pages[f.page];
            const pageId = pageIds[f.page];
            const rule = RULES.find((r) => r.id === f.rule);
            if (!page || !pageId || !rule) throw new Error(`bad demo spec: ${f.rule}`);
            const pageStatus = phase.late
              ? (spec.latePageStatus?.[f.page] ?? page.status)
              : page.status;
            if (pageStatus !== 'scanned') continue;
            const print = fp(f.rule, f.selector, page.path);
            // Story: detected in the first scan, investigated, assigned, fix recorded; if the next
            // scan no longer reports it, that scan is what verifies the fix.
            const resolvedLater = !phase.late && !f.late && f.cls === 'confirmed';
            const review =
              (phase.late ? f.lateReview : f.earlyReview) ?? (resolvedLater ? 'fixed' : 'open');
            const findingId = randomUUID();
            await tx.insert(findings).values({
              id: findingId,
              organizationId: orgId,
              scanId,
              pageId,
              ruleId: f.rule,
              fingerprint: print,
              classification: f.cls,
              confidence: f.conf,
              severity: f.sev,
              wcagCriteria: rule.wcag,
              message: f.message,
              selector: f.selector,
              occurrences: f.occ,
              reviewStatus: review,
              reviewedBy: review === 'open' ? null : reviewerId,
              reviewedAt:
                review === 'open'
                  ? null
                  : new Date(phase.when + (phase.late ? 3_600_000 : 30 * 3_600_000)),
              assigneeId: f.cls === 'confirmed' ? reviewerId : null,
              createdAt: new Date(phase.when),
            });
            findingIdByFp.set(`${scanId}:${print}`, findingId);
            await tx.insert(findingEvidence).values([
              {
                organizationId: orgId,
                findingId,
                kind: 'html_snippet',
                content: { html: f.html },
              },
              {
                organizationId: orgId,
                findingId,
                kind: 'selector',
                content: { selector: f.selector },
              },
              {
                organizationId: orgId,
                findingId,
                kind: 'check_data',
                content: {
                  axeRule: f.rule.replace('axe:', ''),
                  impact: f.sev,
                  note: 'Illustrative demo data, not a result from a real website.',
                },
              },
              {
                organizationId: orgId,
                findingId,
                kind: 'screenshot',
                content: {
                  caption: 'Illustrative sample image (demo data)',
                  origin: 'demo_sample',
                  annotated: false,
                },
                blobBase64: shot,
                contentType: 'image/png',
              },
            ]);
            const H = 3_600_000;
            if (f.cls === 'confirmed') {
              await tx.insert(findingHistory).values({
                organizationId: orgId,
                findingId,
                actorId: ownerId,
                kind: 'assignee',
                fromValue: null,
                toValue: reviewerId,
                createdAt: new Date(phase.when + H / 2),
              });
              if (!phase.late) {
                await tx.insert(findingComments).values({
                  organizationId: orgId,
                  findingId,
                  authorId: reviewerId,
                  body: `Reproduced on ${page.path}. Checked the markup and the cause matches the evidence.`,
                  createdAt: new Date(phase.when + 5 * H),
                });
              }
            }
            if (review !== 'open') {
              // Review decisions are recorded a day after detection, not in the same hour.
              await tx.insert(findingHistory).values({
                organizationId: orgId,
                findingId,
                actorId: reviewerId,
                kind: 'status',
                fromValue: 'open',
                toValue: review,
                createdAt: new Date(phase.when + (phase.late ? H : 30 * H)),
              });
              if (resolvedLater) {
                await tx.insert(findingComments).values({
                  organizationId: orgId,
                  findingId,
                  authorId: ownerId,
                  body: 'Fix is merged. Marked fixed; the next scan will show whether it holds.',
                  createdAt: new Date(phase.when + 30 * H),
                });
              }
            }
            if (f.comment && phase.late) {
              await tx.insert(findingComments).values({
                organizationId: orgId,
                findingId,
                authorId: reviewerId,
                body: f.comment,
                createdAt: new Date(now - 6 * 3_600_000),
              });
            }
          }
          if (phase.late) {
            for (const m of spec.manual) {
              await tx.insert(manualVerificationTasks).values({
                organizationId: orgId,
                scanId,
                ruleId: m.rule,
                instructions: m.instructions,
                status: m.resolved ?? 'pending',
                note: m.note ?? null,
                resolvedBy: m.resolved ? reviewerId : null,
                resolvedAt: m.resolved ? new Date(now - 5 * 3_600_000) : null,
              });
            }
          }
        }

        if (spec.failedScanReason) {
          const t = now - 3 * 3_600_000;
          await tx.insert(scans).values({
            organizationId: orgId,
            projectId,
            status: 'failed',
            startUrl: `https://${spec.host}/`,
            maxPages: 10,
            wcagVersion: '2.2',
            conformanceLevel: 'AA',
            interactionTests: true,
            failureReason: spec.failedScanReason,
            createdBy: ownerId,
            startedAt: new Date(t),
            finishedAt: new Date(t + 120_000),
            createdAt: new Date(t),
          });
        }
      }

      await tx.insert(auditLogs).values({
        organizationId: orgId,
        actorType: 'system',
        action: 'demo.seeded',
        targetType: 'organization',
        targetId: orgId,
        metadata: { note: 'Demo dataset created by db:seed:demo' },
      });
    });

    process.stdout.write(
      `demo data created. Sign in as ${DEMO_EMAIL} (password in packages/db/src/seed-demo.ts)\n`,
    );
  } finally {
    await handle.close();
  }
}

await main();
