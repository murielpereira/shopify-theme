const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ recordVideo: { dir: 'verification/videos' } });
  const page = await context.newPage();

  // Load the static mockup page where the component exists
  await page.goto('file://' + process.cwd() + '/produto.html');
  await page.waitForTimeout(500);

  // Take screenshot
  await page.screenshot({ path: 'verification/screenshots/verification.png' });
  await page.waitForTimeout(500);

  await context.close();
  await browser.close();
})();
