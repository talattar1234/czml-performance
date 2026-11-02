import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const counts = (process.env.COUNTS ?? "100,300,500,1000,2000")
  .split(",")
  .map(Number);
const strategies = (
  process.env.STRATEGIES ?? "full,chunked,streaming,native"
).split(",");
const dwell = Number(process.env.DWELL_MS ?? 5000);
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? "chrome",
  headless: process.env.HEADED !== "1",
  args: [
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--enable-precise-memory-info",
  ],
});
const rows: unknown[] = [];
await mkdir("benchmarks", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const aircraft of counts)
  for (const strategy of strategies) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(180000);
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
        async ({ aircraft, strategy, dwell }) => {
          const e = window.simulation!;
          await e.generate({
            ...e.config,
            aircraft,
            strategy: strategy as typeof e.config.strategy,
            minutes: 30,
            step: 1,
            seed: 42,
            trail: "window",
            trailMinutes: 5,
            trailRenderer: "path",
          });
          if (!e.provider.has(0, 0)) {
            await new Promise(requestAnimationFrame);
            throw new Error(
              document.querySelector(".error-banner")?.textContent ??
                "Initialization did not produce available data",
            );
          }
          const initialMs = e.monitor.initialMs;
          const loadHeap = (
            performance as Performance & { memory?: { usedJSHeapSize: number } }
          ).memory?.usedJSHeapSize;
          const seeks = [];
          for (const t of [900, 300, 1620]) {
            const start = performance.now();
            await e.seek(t);
            seeks.push({
              seconds: t,
              ms: performance.now() - start,
              available: !!e.provider.state("AC-0001", t),
            });
          }
          const playback = [];
          for (const speed of aircraft === 300
            ? [1, 5, 10, 30, 60, -60]
            : [1, 60]) {
            await e.seek(600);
            e.speed(speed);
            for (const details of aircraft === 300 ? [false, true] : [false]) {
              e.select(details ? "AC-0001" : undefined);
              const start = performance.now(),
                clock = e.seconds(),
                first = e.monitor.history.length;
              e.play();
              await new Promise((r) => setTimeout(r, dwell));
              e.pause();
              playback.push({
                speed,
                details,
                realMs: performance.now() - start,
                simulationSeconds: e.seconds() - clock,
                metrics: e.monitor.history.slice(first),
                state: e.provider.state("AC-0001", e.seconds()),
              });
            }
          }
          return {
            aircraft,
            strategy,
            initialMs,
            loadHeap,
            seeks,
            playback,
            loads: e.provider.metrics,
            history: e.monitor.history,
            environment: {
              userAgent: navigator.userAgent,
              viewport: [innerWidth, innerHeight],
              cores: navigator.hardwareConcurrency,
              gpu: (() => {
                const gl = document
                  .createElement("canvas")
                  .getContext("webgl2");
                const ext = gl?.getExtension("WEBGL_debug_renderer_info");
                return ext
                  ? gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)
                  : "Unavailable";
              })(),
            },
          };
        },
        { aircraft, strategy, dwell },
      );
      rows.push(result);
      console.log(
        `${aircraft} ${strategy}: initialized ${result.initialMs.toFixed(0)} ms`,
      );
    } catch (e) {
      rows.push({ aircraft, strategy, error: String(e) });
      console.error(`${aircraft} ${strategy}: ${String(e)}`);
    } finally {
      clearTimeout(deadline);
      await page.close();
      await writeFile(
        `benchmarks/run-${stamp}.json`,
        JSON.stringify(rows, null, 2),
      );
    }
  }
await browser.close();
console.log(`Results: benchmarks/run-${stamp}.json`);
