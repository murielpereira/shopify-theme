import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # Create context with video recording
        context = await browser.new_context(
            record_video_dir="verification/",
            record_video_size={"width": 1280, "height": 720}
        )
        page = await context.new_page()

        # We need a local server running or we can load static files.
        # Check if there are static files we can load
        await page.goto('file:///app/produto.html')

        # wait a bit for images to load
        await page.wait_for_timeout(2000)

        # Take a screenshot
        await page.screenshot(path="verification/screenshot.png", full_page=True)

        await context.close()
        await browser.close()

asyncio.run(main())
