import { expect, test, type Page } from '@playwright/test';

// Journey on the seeded demo dataset (npm run db:seed:demo -w @accessaudit/db).
// Project -> Scan report -> Finding -> Evidence -> Remediation -> Status -> Compare -> Export.
// The live "start scan" and rescan steps are covered by phase2.spec.ts against a real site; demo
// hostnames use the reserved .example TLD and cannot be scanned.

const EMAIL = 'demo.owner@accessaudit.example';
const PASSWORD = 'Demo-Password-Only-For-Local-Use-1!';

test.describe.configure({ mode: 'serial' });

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `e2e-screenshots/journey-${name}.png`, fullPage: true });
}

async function noOverflow(page: Page, label: string): Promise<void> {
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over, `${label}: horizontal scroll at ${String(width)}px`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test('sign in and open the populated dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/orgs/);
  await page
    .getByRole('link', { name: /Demo Org/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  for (const id of ['ov-critical', 'ov-change', 'ov-manual', 'ov-failed', 'ov-activity']) {
    await expect(page.locator(`section[aria-labelledby="${id}"]`)).toBeVisible();
  }
  await expect(page.getByText(/Northwind Shop/).first()).toBeVisible();
  await noOverflow(page, 'dashboard');
  await shoot(page, '01-dashboard');
});

test('dashboard record links navigate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page
    .getByRole('link', { name: /Demo Org/ })
    .first()
    .click();
  const link = page.locator('section[aria-labelledby="ov-critical"]').getByRole('link').first();
  await link.click();
  await expect(page).toHaveURL(/\/(findings|scans|projects)\//);
});

test('project -> report -> finding -> evidence -> status -> comment -> compare -> export', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page
    .getByRole('link', { name: /Demo Org/ })
    .first()
    .click();
  await page.getByRole('link', { name: 'Projects', exact: true }).first().click();
  await page
    .getByRole('link', { name: /Northwind Shop/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await shoot(page, '02-project');

  // Open the latest completed report.
  await page
    .locator('tr', { hasText: /completed/i })
    .first()
    .getByRole('link', { name: 'View report' })
    .click();
  await expect(page).toHaveURL(/\/scans\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('finding-counts')).toBeVisible();
  await expect(page.getByTestId('coverage-counts')).toBeVisible();
  await expect(page.getByTestId('next-actions')).toBeVisible();
  await noOverflow(page, 'report');
  await shoot(page, '03-report');

  // Compare: regressed and resolved, never resolved for unscanned pages.
  await expect(page.getByRole('heading', { name: 'Change since previous scan' })).toBeVisible();
  await shoot(page, '04-compare');

  // Filters.
  const filters = page.getByRole('group', { name: 'Filter findings' });
  await filters.getByLabel('Severity').selectOption('critical');
  await expect(page.getByTestId('finding-counts')).toBeVisible();
  await shoot(page, '05-report-filtered');
  await filters.getByLabel('Severity').selectOption('');

  // Finding detail.
  await page.getByRole('link', { name: 'Images must have alternative text' }).first().click();
  await expect(page).toHaveURL(/\/findings\/[0-9a-f-]{36}/);
  await expect(page.locator('#visual-evidence')).toBeVisible();
  const tech = page.locator('details.tech-details').first();
  await tech.locator('summary').click();
  await expect(tech.locator('pre').first()).toBeVisible();
  await expect(page.getByText(/template, not AI/)).toBeVisible();
  await noOverflow(page, 'finding');
  await shoot(page, '06-finding');

  // Section nav jumps.
  await page.getByRole('navigation', { name: 'On this page' }).getByText('Workflow').click();

  // Workflow controls are exercised without saving, so the seeded history stays a believable
  // story. Saving and commenting are covered by the API tests and the dedicated e2e specs.
  await expect(page.locator('#workflow-summary')).toContainText('Status:');
  await page.getByLabel('Review status').selectOption('fixed');
  await expect(page.getByLabel('Review status')).toHaveValue('fixed');
  await page.getByLabel('Review status').selectOption('open');
  await page.getByLabel('Add a comment').fill('draft only, not posted');
  await expect(page.getByRole('button', { name: 'Post comment' })).toBeEnabled();
  await page.getByLabel('Add a comment').fill('');
  await shoot(page, '07-finding-workflow');

  // Exports.
  await page.goBack();
  await page.goBack().catch(() => undefined);
  for (const fmt of ['PDF', 'HTML', 'CSV', 'JSON']) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByRole('button', { name: `Download ${fmt}` }).click(),
    ]);
    expect(download.suggestedFilename().toLowerCase()).toContain(fmt.toLowerCase());
  }
});

test('manual verification checklist', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page
    .getByRole('link', { name: /Demo Org/ })
    .first()
    .click();
  await page.getByRole('link', { name: 'Projects', exact: true }).first().click();
  await page
    .getByRole('link', { name: /Northwind Shop/ })
    .first()
    .click();
  await page
    .locator('tr', { hasText: /completed/i })
    .first()
    .getByRole('link', { name: 'View report' })
    .click();
  await page.getByRole('link', { name: 'Open the checklist' }).first().click();
  await expect(page).toHaveURL(/\/manual$/);
  await expect(page.locator('h1')).toBeVisible();
  await noOverflow(page, 'manual');
  await shoot(page, '08-manual');
});

test('mobile navigation and homepage', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await noOverflow(page, 'home');
  await page.setViewportSize({ width: 375, height: 800 });
  await shoot(page, '09-home-mobile');
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page
    .getByRole('link', { name: /Demo Org/ })
    .first()
    .click();
  await noOverflow(page, 'dashboard-mobile');
  await page.setViewportSize({ width: 375, height: 800 });
  await shoot(page, '10-dashboard-mobile');
});
