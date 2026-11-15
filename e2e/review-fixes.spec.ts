import { expect, test, type Page } from '@playwright/test';

// Covers the PM review fixes on the seeded demo org: compact activity + route, adaptive
// onboarding (completed-scan state), evidence caption honesty and dialog keyboard behaviour,
// and the Finding Detail workflow summary. Needs `npm run db:seed:demo -w @accessaudit/db`.

const EMAIL = 'demo.owner@accessaudit.example';
const PASSWORD = 'Demo-Password-Only-For-Local-Use-1!';

async function openDemoOrg(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page
    .getByRole('link', { name: /Demo Org/ })
    .first()
    .click();
}

test('dashboard: onboarding collapsed after a completed scan, activity compact with route', async ({
  page,
}) => {
  await openDemoOrg(page);
  await expect(page.getByTestId('onboarding-collapsed')).toBeVisible();
  await expect(page.getByTestId('onboarding-full')).toHaveCount(0);

  const activity = page.locator('section[aria-labelledby="ov-activity"]');
  await expect(activity.locator('ul.compact-list > li')).toHaveCount(4);
  await activity.getByRole('link', { name: /View all activity/ }).click();
  await expect(page).toHaveURL(/\/orgs\/[0-9a-f-]{36}\/activity$/);
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
  await expect(page.locator('ul.compact-list > li').first()).toBeVisible();
  expect(await page.locator('ul.compact-list > li').count()).toBeGreaterThan(4);
  await page.getByRole('link', { name: /Back to overview/ }).click();
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
});

test('finding: workflow summary, honest caption, dialog keyboard behaviour', async ({ page }) => {
  await openDemoOrg(page);
  await page.locator('section[aria-labelledby="ov-critical"]').getByRole('link').first().click();
  await expect(page).toHaveURL(/\/findings\//);

  const summary = page.locator('#workflow-summary');
  await expect(summary).toContainText('Status:');
  await expect(summary).toContainText('Owner:');
  await expect(summary.getByRole('link', { name: /comment/i })).toBeVisible();

  const visual = page.locator('#visual-evidence');
  const opener = visual.getByRole('button', { name: /Open larger view/ }).first();
  if ((await opener.count()) === 0) {
    test.info().annotations.push({ type: 'note', description: 'finding has no screenshot' });
    return;
  }
  // Demo screenshots must say they are samples and must not claim a measured box.
  await expect(visual.getByText('Sample image (demo data)').first()).toBeVisible();
  await expect(visual.getByText(/does not mark a measured element position/)).toBeVisible();
  // One label per kind: no duplicate heading beside the details summary.
  await expect(visual.getByRole('heading', { level: 4 })).toHaveCount(0);

  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  await page.keyboard.press('Space');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).press('Enter');
  await expect(dialog).toBeHidden();
});
