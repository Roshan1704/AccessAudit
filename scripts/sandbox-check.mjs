/* eslint-disable no-console -- CLI diagnostic script, output is the point */
// Run inside the worker image to see whether Chromium starts with and without its own sandbox.
// Usage is in docs/DEPLOYMENT.md. Prints one line per mode; exits non-zero if the sandboxed launch fails.
import { chromium } from 'playwright-core';

let sandboxedOk = false;
for (const noSandbox of [false, true]) {
  try {
    const browser = await chromium.launch({ args: noSandbox ? ['--no-sandbox'] : [] });
    const page = await browser.newPage();
    await page.setContent('<title>ok</title>');
    console.log(`noSandbox=${String(noSandbox)} launch OK title=${await page.title()}`);
    if (!noSandbox) sandboxedOk = true;
    await browser.close();
  } catch (e) {
    console.log(`noSandbox=${String(noSandbox)} FAIL ${String(e.message).split('\n')[0]}`);
  }
}
process.exit(sandboxedOk ? 0 : 1);
