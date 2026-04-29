import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    recordVideo: {
      dir: 'verification/'
    }
  });
  const page = await context.newPage();

  // Test frontend loading product page
  await page.goto('file:///app/produto.html');
  await page.screenshot({ path: 'verification/screenshot.png' });

  // Adding product to cart
  const addToCartBtn = await page.$('#ame-add-to-cart');
  if (addToCartBtn) {
    await addToCartBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'verification/screenshot_cart.png' });
  }

  await context.close();
  await browser.close();
})();
