import { expect, test, type Page } from '@playwright/test';

const run = Date.now().toString(36);
const password = `E2e-pass-${run}-Xy9!`;
const userA = { name: 'E2E Alice', email: `alice-${run}@example.test` };
const userB = { name: 'E2E Bob', email: `bob-${run}@example.test` };
const orgSlug = `e2e-org-${run}`;

let orgUrl = '';
const consoleProblems: string[] = [];

function watchConsole(page: Page) {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleProblems.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`));
}

async function register(page: Page, u: { name: string; email: string }) {
  await page.goto('/register');
  await page.getByLabel('Name').fill(u.name);
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/orgs$/);
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(({ page }) => {
  watchConsole(page);
});

test('protected routes redirect anonymous users to login', async ({ page }) => {
  await page.goto('/orgs');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login$/);
});

test('form labels and validation errors on register', async ({ page }) => {
  await page.goto('/register');
  for (const l of ['Name', 'Email', 'Password']) {
    await expect(page.getByLabel(l, { exact: true })).toBeVisible();
  }
  await page.getByLabel('Name').fill('X');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('.alert.error')).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
});

test('register, create organization and project, logout', async ({ page }) => {
  await register(page, userA);
  await expect(page.getByText(userA.name, { exact: true })).toBeVisible();

  await page.getByLabel('Name').fill(`E2E Org ${run}`);
  await page.getByLabel('URL slug').fill(orgSlug);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `E2E Org ${run}` })).toBeVisible();
  orgUrl = page.url();

  await page.getByRole('link', { name: 'Projects' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  await page.getByLabel('Name').fill('E2E Project');
  await page.getByLabel('Base URL').fill('https://www.example.com');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('link', { name: 'E2E Project' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/orgs');
  await expect(page).toHaveURL(/\/login$/);
});

test('invalid login shows an error and stays on login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(userA.email);
  await page.getByLabel('Password', { exact: true }).fill('definitely-wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.alert.error')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('login, keyboard navigation and visible focus', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(userA.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/orgs$/);

  // The first Tab stop is the skip link and it becomes visible.
  await page.goto('/orgs');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName.toLowerCase()}#${el.id} ${el.textContent.slice(0, 30)}` : 'none';
  });
  test.info().annotations.push({ type: 'first-tab-focus', description: focused });
  expect(focused, 'first Tab stop').toContain('Skip to main content');
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();

  // Every focused element shows an outline.
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'none';
      const s = getComputedStyle(el);
      return `${s.outlineStyle} ${s.outlineWidth}`;
    });
    expect(outline).not.toMatch(/^none/);
    expect(outline).not.toMatch(/ 0px$/);
  }

  // Navigation landmarks are labelled and the current page is marked.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.locator('[aria-current="page"]').first()).toBeVisible();
});

test('another user cannot reach the organization', async ({ page }) => {
  await register(page, userB);
  await page.goto(orgUrl);
  await expect(page.getByText(/not a member|not found/i).first()).toBeVisible();
  await page.goto(`${orgUrl}/projects`);
  await expect(page.getByText('E2E Project')).toHaveCount(0);
  await expect(page.getByText(/not a member|not found/i).first()).toBeVisible();
});

test('expired session returns to login', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(userA.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/orgs$/);
  // Simulates expiry by dropping the session cookie; server-side expiry is covered by API tests.
  await context.clearCookies();
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
});

test('error state when the API is unreachable', async ({ page }) => {
  await page.route('**/auth/me', (r) => r.abort());
  await page.goto('/orgs');
  await expect(page.locator('.alert.error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('no unexpected browser console errors', () => {
  // Aborted /auth/me and the invalid-login 401 produce expected network errors; anything else fails.
  const unexpected = consoleProblems.filter(
    (p) => !/Failed to load resource|net::ERR_FAILED|Failed to fetch/i.test(p),
  );
  expect(unexpected).toEqual([]);
});
