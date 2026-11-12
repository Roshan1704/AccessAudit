import { chromium } from 'playwright-core';

/**
 * Render our own generated HTML to PDF with a local Chrome. The page is static, JavaScript
 * is off and every network request is blocked, so report content cannot reach out or run code.
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const channel = process.env['BROWSER_CHANNEL'];
  const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      printBackground: false,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
    });
  } finally {
    await browser.close();
  }
}
