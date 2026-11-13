import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Screenshot tour for design review: every page full-length, plus one shot per section of the
// page, on the seeded demo org (npm run db:seed:demo -w @accessaudit/db). Output goes straight
// into docs/design-review/product/. Assertions are minimal; this spec exists to produce images.

const EMAIL = 'demo.owner@accessaudit.example';
const PASSWORD = 'Demo-Password-Only-For-Local-Use-1!';
const OUT = 'docs/design-review/product';

test.describe.configure({ mode: 'serial' });
mkdirSync(OUT, { recursive: true });

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'section'
  );
}

/** Full page, then each visible <section> inside main (or the page body for public pages). */
async function tour(page: Page, name: string): Promise<void> {
  await page.waitForLoadState('load');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const sections = page.locator('main section, main .card, main details');
  const count = await sections.count();
  const seen = new Set<string>();
  let n = 0;
  for (let i = 0; i < count; i++) {
    const el = sections.nth(i);
    if (!(await el.isVisible())) continue;
    const box = await el.boundingBox();
    if (!box || box.height < 60 || box.width < 200) continue;
    // Skip elements nested in another captured element to avoid duplicates.
    const nested = await el.evaluate((node) => {
      const parent = node.parentElement?.closest('main section, main .card');
      return parent !== null && parent !== undefined;
    });
    if (nested) continue;
    const heading = await el.evaluate(
      (node) => node.querySelector('h1, h2, h3, summary')?.textContent ?? '',
    );
    let key = slug(heading);
    if (seen.has(key)) key = `${key}-${String(i)}`;
    seen.add(key);
    n += 1;
    await el
      .screenshot({
        path: `${OUT}/${name}--${String(n).padStart(2, '0')}-${key}.png`,
        timeout: 3000,
        animations: 'disabled',
      })
      .catch(() => undefined);
  }
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/orgs/);
}

test('public pages', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [name, path] of [
    ['01-home', '/'],
    ['02-quick-check', '/quick-check'],
    ['03-login', '/login'],
    ['04-register', '/register'],
    ['05-forgot-password', '/forgot-password'],
    ['06-reset-password', '/reset-password'],
    ['07-not-found', '/no-such-page'],
  ] as const) {
    await page.goto(path);
    await tour(page, name);
  }
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await page.screenshot({ path: `${OUT}/01-home-mobile.png`, fullPage: true });
});

test('signed-in pages', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  await tour(page, '10-orgs');

  await page
    .getByRole('link', { name: /Demo Org/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  const orgUrl = page.url();
  await tour(page, '11-org-dashboard');

  for (const [name, label] of [
    ['12-projects', 'Projects'],
    ['13-members', 'Members'],
    ['14-org-settings', 'Settings'],
  ] as const) {
    await page.goto(orgUrl);
    await page.getByRole('link', { name: label, exact: true }).first().click();
    await expect(page.locator('h1').first()).toBeVisible();
    await tour(page, name);
  }

  await page.goto('/account');
  await expect(page.locator('h1').first()).toBeVisible();
  await tour(page, '15-account');

  // Project: Scans tab and Settings tab.
  await page.goto(orgUrl);
  await page.getByRole('link', { name: 'Projects', exact: true }).first().click();
  await page
    .getByRole('link', { name: /Northwind Shop/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await tour(page, '20-project-scans');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await tour(page, '21-project-settings');
  await page.getByRole('tab', { name: 'Scans' }).click();

  // Report, finding, manual checklist.
  await page
    .locator('tr', { hasText: /completed/i })
    .first()
    .getByRole('link', { name: 'View report' })
    .click();
  await expect(page.getByTestId('finding-counts')).toBeVisible();
  await tour(page, '30-scan-report');
  const reportUrl = page.url();

  await page.getByRole('link', { name: 'Images must have alternative text' }).first().click();
  await expect(page.locator('#visual-evidence')).toBeVisible();
  for (const d of await page.locator('details.tech-details').all()) {
    await d.locator('summary').click();
  }
  await tour(page, '31-finding-detail');

  await page.goto(`${reportUrl}/manual`);
  await expect(page.locator('h1')).toBeVisible();
  await tour(page, '32-manual-checklist');

  // Mobile versions of the main signed-in pages.
  await page.setViewportSize({ width: 375, height: 800 });
  for (const [name, url] of [
    ['11-org-dashboard-mobile', orgUrl],
    ['30-scan-report-mobile', reportUrl],
  ] as const) {
    await page.goto(url);
    await page.waitForLoadState('load');
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  }
});
