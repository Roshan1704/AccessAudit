import { createDb, authorizedDomains, withTenant } from '@accessaudit/db';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

const axeSource = (createRequire(`${process.cwd()}/package.json`)('axe-core') as { source: string })
  .source;

/** Runs axe-core in the page against WCAG 2.x A/AA and 2.2 AA. Returns "rule: nodes" strings. */
async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  const out = await page.evaluate(`axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }
  }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.length))`);
  return out as string[];
}

// Real end to end: UI -> API -> Redis queue -> worker (real Chrome) -> PostgreSQL -> UI.
// Domain verification itself is covered by API tests (DNS/HTTP stubs). Here the verified-domain row is
// seeded directly, because proving ownership of a real public domain is impossible in a test.
// Needs the dev stack running (API, worker, Redis, PostgreSQL) and internet access to example.com.

const dbUrl = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
if (!dbUrl) throw new Error('Set DATABASE_URL or TEST_DATABASE_URL to run the e2e tests.');

const run = Date.now().toString(36);
const password = `E2e-pass-${run}-Xy9!`;
const user = { name: 'E2E Scanner', email: `scan-${run}@example.test` };

test.describe.configure({ mode: 'serial' });

test('quick check: one public page, real findings, nothing saved', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/quick-check');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Quick accessibility check' }),
  ).toBeVisible();
  await page.getByLabel('Page address').fill('example.com');
  await page.getByRole('button', { name: 'Run check' }).click();
  await expect(page.getByRole('heading', { name: /^Result for/ })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByText('Checked page:')).toBeVisible();
  await expect(page.getByText(/not saved/)).toBeVisible();
  await expect(page.getByText('Confirmed violation').first()).toBeVisible();
});

test('quick check refuses a private address', async ({ page }) => {
  await page.goto('/quick-check');
  await page.getByLabel('Page address').fill('http://127.0.0.1/');
  await page.getByRole('button', { name: 'Run check' }).click();
  await expect(page.getByText(/cannot be checked/)).toBeVisible({ timeout: 60_000 });
});

test('quick check page has no axe violations', async ({ page }) => {
  await page.goto('/quick-check');
  expect(await axeViolations(page)).toEqual([]);
});

test('authenticated scan: start, wait, review report, finding and manual tasks', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto('/register');
  await page.getByLabel('Name').fill(user.name);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/orgs$/);
  await page.getByLabel('Name').fill(`Scan Org ${run}`);
  await page.getByLabel('URL slug').fill(`scan-org-${run}`);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Scan Org ${run}` })).toBeVisible();
  const orgId = /\/orgs\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  expect(orgId).not.toBe('');

  await page.getByRole('link', { name: 'Projects' }).first().click();
  await page.getByLabel('Name').fill('Example');
  await page.getByLabel('Base URL').fill('https://example.com');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: 'Example' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectId = /projects\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  expect(projectId).not.toBe('');

  const handle = createDb(dbUrl, { max: 1 });
  try {
    await withTenant(handle.db, { orgId }, async (tx) => {
      await tx.insert(authorizedDomains).values({
        organizationId: orgId,
        projectId,
        hostname: 'example.com',
        verificationMethod: 'dns_txt',
        status: 'verified',
        tokenHash: `e2e-${run}`,
      });
    });
  } finally {
    await handle.close();
  }
  await page.reload();

  await page.getByLabel('Max pages').fill('1');
  await page.getByRole('button', { name: 'Scan now' }).click();
  await expect(page.getByRole('link', { name: 'View report' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'View report' }).first().click();

  await expect(page.getByText('Confirmed violation').first()).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/no single accessibility score/i)).toBeVisible();

  expect(await axeViolations(page)).toEqual([]);
  await reflowAndShoot(page, 'report');

  const first = page.locator('a[href*="/findings/"]').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('pre.evidence').first()).toBeVisible();
  expect(await axeViolations(page), 'finding detail: axe').toEqual([]);
  await reflowAndShoot(page, 'finding-detail');

  await page.goBack();
  await page.getByRole('link', { name: 'Open the checklist' }).click();
  await expect(page).toHaveURL(/\/manual$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await axeViolations(page), 'manual checklist: axe').toEqual([]);
  await reflowAndShoot(page, 'manual-checklist');
});

/** No horizontal scroll at 320/768/1280 px; screenshots go to e2e-screenshots/ for a human to review. */
async function reflowAndShoot(page: Page, name: string): Promise<void> {
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const culprits =
      over > 0
        ? await page.evaluate<string[]>(`(() => {
            const limit = document.documentElement.clientWidth;
            return Array.from(document.body.querySelectorAll('*'))
              .filter((el) => el.getBoundingClientRect().right > limit + 0.5)
              .slice(0, 8)
              .map((el) => el.tagName.toLowerCase() + '.' + (el.getAttribute('class') || '') +
                ' right=' + Math.round(el.getBoundingClientRect().right));
          })()`)
        : [];
    expect(
      over,
      `${name}: horizontal scroll at ${String(width)}px; wide elements: ${culprits.join(' | ')}`,
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `e2e-screenshots/${name}-${String(width)}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}
