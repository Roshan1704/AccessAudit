import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

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

test('login profile section: empty state, form, rejected input, no axe violations', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Name').fill('E2E Profiles');
  await page.getByLabel('Email').fill(`profiles-${run}@example.test`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/orgs$/);

  await page.getByLabel('Name').fill(`Profiles Org ${run}`);
  await page.getByLabel('URL slug').fill(`profiles-org-${run}`);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/orgs\/[0-9a-f-]{36}/);
  const orgId = /\/orgs\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  expect(orgId).not.toBe('');

  await page.goto(`/orgs/${orgId}/projects`);
  await page.getByLabel('Name').fill('Profiles site');
  await page.getByLabel('Base URL').fill('https://example.com');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: 'Profiles site' }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);

  await expect(page.getByRole('heading', { level: 2, name: 'Login profiles' })).toBeVisible();
  await expect(page.getByText('No login profiles')).toBeVisible();
  // No profiles yet, so the scan form offers no login choice.
  await expect(page.getByLabel('Sign in with')).toHaveCount(0);

  // The password field is masked and the form is labelled.
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');

  // An incomplete profile is rejected and nothing is listed.
  await page.getByRole('button', { name: 'Save login profile' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByText('No login profiles')).toBeVisible();

  const v = await axeViolations(page);
  expect(v, 'axe violations on project detail with login profiles').toEqual([]);
});
