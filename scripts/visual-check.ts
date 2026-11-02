import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? "chrome",
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://127.0.0.1:5173");
await page.waitForFunction(() => window.simulation?.provider?.loaded.size);
await page.waitForFunction(() => !document.querySelector(".loading"));
for (const trailRenderer of ["path", "polyline", "collection"] as const) {
  await page.evaluate(async (trailRenderer) => {
    const e = window.simulation!;
    await e.generate({
      ...e.config,
      strategy: "native",
      trail: "window",
      trailRenderer,
      opacity: 1,
      width: 3,
      labels: false,
    });
    await e.seek(900);
    e.speed(10);
    e.play();
  }, trailRenderer);
  await page.waitForTimeout(4000);
  await page.screenshot({
    path: `benchmarks/visual-${trailRenderer}-playing.png`,
  });
  await page.evaluate(() => window.simulation!.pause());
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: `benchmarks/visual-${trailRenderer}-paused.png`,
  });
}
await browser.close();
