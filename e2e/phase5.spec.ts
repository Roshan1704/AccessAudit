import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

const axeSource = (createRequire(`${process.cwd()}/package.json`)('axe-core') as { source: string })
  .source;

/** axe-core, WCAG 2.x A/AA and 2.2 AA. Returns "rule: nodes" strings. */
async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  const out = await page.evaluate(`axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }
  }).then(r => r.violations.map(v => v.id + ': ' + v.nodes.length))`);
  return out as string[];
}

const run = Date.now().toString(36);
const password = `E2e-pass-${run}-Xy9!`;
const user = { name: 'E2E Overview', email: `overview-${run}@example.test` };

test.describe.configure({ mode: 'serial' });

async function expectClean(page: Page, label: string) {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  const v = await axeViolations(page);
  expect(v, `axe violations on ${label}`).toEqual([]);
}

test('public routes have no axe violations', async ({ page }) => {
  for (const path of ['/', '/quick-check', '/login', '/register', '/forgot-password']) {
    await page.goto(path);
    await expectClean(page, path);
  }
});

test('every signed-in route has no axe violations and overview shows honest empty state', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Name').fill(user.name);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/orgs$/);
  await expectClean(page, '/orgs');

  await page.getByLabel('Name').fill(`Overview Org ${run}`);
  await page.getByLabel('URL slug').fill(`overview-org-${run}`);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Overview Org ${run}` })).toBeVisible();
  const orgId = /\/orgs\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  expect(orgId).not.toBe('');
  await expect(page.getByText('Add your first project')).toBeVisible();
  await expectClean(page, 'org overview (empty)');

  await page.goto(`/orgs/${orgId}/projects`);
  await page.getByLabel('Name').fill('Example');
  await page.getByLabel('Base URL').fill('https://example.com');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expectClean(page, 'projects');

  await page.goto(`/orgs/${orgId}`);
  await expect(page.getByText('No completed scan yet.')).toBeVisible();
  await expect(page.getByText(/does not mean a site is accessible/)).toBeVisible();
  await expectClean(page, 'org overview (project, no scan)');

  await page.getByRole('link', { name: 'Example' }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expectClean(page, 'project detail');

  for (const tail of ['members', 'settings']) {
    await page.goto(`/orgs/${orgId}/${tail}`);
    await expectClean(page, tail);
  }
  await page.goto('/account');
  await expectClean(page, '/account');
  await page.goto('/this-route-does-not-exist');
  await expectClean(page, 'not found');
});
