import { expect, test } from '@playwright/test';

test('two-player mode is for a PC only: greyed out on phones and tablets', async ({ page }, testInfo) => {
  await page.goto('/');
  const button = page.getByTestId('menu-two-players');
  await expect(button).toBeVisible();
  if (testInfo.project.name === 'desktop') await expect(button).toBeEnabled();
  else await expect(button).toBeDisabled();
});
