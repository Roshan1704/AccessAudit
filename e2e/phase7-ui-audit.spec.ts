import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

/**
 * UI audit: per-route title, axe, horizontal overflow at 320/768/1280 px, keyboard focus
 * visibility, and screenshots saved to e2e-screenshots/ for a human to look at.
 * Screenshots are for review; the assertions are the automated part.
 */

const axeSource = (createRequire(`${process.cwd()}/package.json`)('axe-core') as { source: string })
  .source;

async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  const out = await page.evaluate(`axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }
  }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.length))`);
  return out as string[];
}

const run = Date.now().toString(36);
const password = `E2e-pass-${run}-Xy9!`;
const widths = [320, 768, 1280];

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function checkPage(page: Page, name: string): Promise<void> {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    expect(
      await overflow(page),
      `${name}: horizontal scroll at ${String(width)}px`,
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `e2e-screenshots/${name}-${String(width)}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await axeViolations(page), `${name}: axe`).toEqual([]);
  const title = await page.title();
  expect(title, `${name}: title names the page`).toMatch(/·|AccessAudit/);
}

test('public pages and signed-in pages: titles, reflow, axe, keyboard', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();
  await checkPage(page, 'home');

  await page.goto('/login');
  await expect(page.locator('h1')).toBeVisible();
  await checkPage(page, 'login');
  const loginTitle = await page.title();

  await page.goto('/register');
  await expect(page.locator('h1')).toBeVisible();
  await expect.poll(() => page.title()).not.toBe(loginTitle);
  await checkPage(page, 'register');

  // Keyboard: first Tab stop is the skip link and it becomes visible.
  await page.goto('/register');
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement?.textContent.trim() ?? '');
  expect(first.toLowerCase()).toContain('skip');

  await page.getByLabel('Name').fill('UI Audit');
  await page.getByLabel('Email').fill(`ui-${run}@example.test`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/orgs$/);
  await checkPage(page, 'orgs-empty');

  await page.getByLabel('Name').fill(`UI Org ${run}`);
  await page.getByLabel('URL slug').fill(`ui-org-${run}`);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/orgs\/[0-9a-f-]{36}/);
  const orgId = /\/orgs\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  expect(orgId).not.toBe('');
  await expect(page.locator('h1')).toBeVisible();
  await checkPage(page, 'org-overview');

  for (const [slug, path] of [
    ['projects', `/orgs/${orgId}/projects`],
    ['members', `/orgs/${orgId}/members`],
    ['settings', `/orgs/${orgId}/settings`],
    ['account', '/account'],
  ] as const) {
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    await checkPage(page, slug);
  }

  await page.goto(`/orgs/${orgId}/projects`);
  await page.getByLabel('Name').fill('Audit site');
  await page.getByLabel('Base URL').fill('https://example.com');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: 'Audit site' }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Login profiles' })).toBeVisible();
  await checkPage(page, 'project-detail');

  // Mobile menu: opens, Escape closes it and returns focus to the toggle.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();

  await page.goto('/this-route-does-not-exist');
  await expect(page.locator('h1')).toHaveCount(1);
  await checkPage(page, 'not-found');
});
