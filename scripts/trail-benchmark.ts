import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const results: unknown[] = [];
await mkdir("benchmarks", { recursive: true });
for (const trailRenderer of ["path", "polyline", "collection"] as const) {
  for (const trail of ["full", "history", "window"] as const) {
    const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL ?? "chrome",
      args: [
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--enable-precise-memory-info",
      ],
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const deadline = setTimeout(
      () => void page.close().catch(() => {}),
      180000,
    );
    try {
      await page.goto("http://127.0.0.1:5173");
      await page.waitForFunction(
        () => window.simulation?.provider?.loaded.size,
      );
      await page.waitForFunction(() => !document.querySelector(".loading"));
      const result = await page.evaluate(
        async ({ trailRenderer, trail }) => {
          const e = window.simulation!;
          await e.generate({
            ...e.config,
            aircraft: 300,
            strategy: "native",
            trailRenderer,
            trail,
            trailMinutes: 5,
          });
          await e.seek(900);
          await new Promise((r) => setTimeout(r, 2000)); // Allow initial geometry upload/shader warmup.
          e.speed(10);
          e.play();
          const start = performance.now(),
            first = e.monitor.history.length,
            clock = e.seconds();
          await new Promise((r) => setTimeout(r, 5000));
          e.pause();
          return {
            environment: { userAgent: navigator.userAgent },
            trailRenderer,
            trail,
            initialMs: e.monitor.initialMs,
            realMs: performance.now() - start,
            simulationSeconds: e.seconds() - clock,
            canAnimate: e.viewer.clock.canAnimate,
            metrics: e.monitor.history.slice(first),
            config: e.config,
          };
        },
        { trailRenderer, trail },
      );
      results.push(result);
      console.log(
        `${trailRenderer}/${trail}: ${result.initialMs.toFixed(0)} ms initialization`,
      );
    } catch (error) {
      results.push({ trailRenderer, trail, error: String(error) });
    } finally {
      clearTimeout(deadline);
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      await writeFile(
        "benchmarks/trails.json",
        JSON.stringify(results, null, 2),
      );
    }
  }
}
