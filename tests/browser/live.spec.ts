import { test, expect } from "@playwright/test";

test("clicking a live aircraft opens updating details and selection clears cleanly", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("tab", { name: "Live stream / No CZML" }).click();
  await expect(page.getByRole("status")).toHaveText("Paused");
  const clickAircraft = async () => {
    // Find an actual rendered icon and click its screen coordinates, exercising GPU picking.
    const point = await page.evaluate(() => {
      const e = window.liveSimulation!;
      const rect = e.viewer.scene.canvas.getBoundingClientRect();
      for (let i = 0; i < e.billboards.length; i++) {
        const b = e.billboards.get(i);
        const p = b.computeScreenSpacePosition(e.viewer.scene);
        if (p && p.x > 320 && p.x < rect.width - 330 && p.y > 180 && p.y < rect.height - 40 && e.viewer.scene.pick(p)?.id === b.id)
          return { x: rect.left + p.x, y: rect.top + p.y, id: b.id };
      }
      throw new Error("No pickable aircraft visible");
    });
    await page.mouse.click(point.x, point.y);
    await expect(page.getByRole("complementary", { name: "Aircraft details" })).toContainText(point.id);
  };
  await clickAircraft();
  const detail = await page.evaluate(() => window.liveSimulation!.state.selected!);
  expect(detail.altitude).toBeGreaterThan(5900);
  expect(detail.speed).toBeGreaterThan(160);
  expect(detail.speed).toBeLessThan(320);
  const before = await page.getByTestId("aircraft-latitude").innerText();
  await page.getByLabel("Live playback speed").selectOption("10");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByTestId("aircraft-latitude")).not.toHaveText(before);
  // Observe actual card updates, rather than just the engine's internal values.
  // A once-per-second inspector cannot pass this sub-second cadence check.
  for (const speed of ["1", "10"]) {
    await page.getByLabel("Live playback speed").selectOption(speed);
    await expect(page.getByRole("status")).toHaveText("Playing");
    const changes = await page.evaluate(() => new Promise<number>(resolve => {
      const field = document.querySelector('[data-testid="aircraft-latitude"]')!;
      let count = 0;
      const observer = new MutationObserver(() => count++);
      observer.observe(field, { characterData: true, childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(count); }, 700);
    }));
    expect(changes).toBeGreaterThan(3);
  }
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await page.getByRole("complementary", { name: "Aircraft details" }).innerText();
  await page.waitForTimeout(1200);
  expect(await page.getByRole("complementary", { name: "Aircraft details" }).innerText()).toBe(paused);
  await page.screenshot({ path: "benchmarks/live-aircraft-details.png" });
  await page.getByRole("button", { name: "Close aircraft details" }).click();
  await expect(page.getByRole("complementary", { name: "Aircraft details" })).toHaveCount(0);
  await clickAircraft();
  await page.getByRole("button", { name: "200", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Aircraft details" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("live history stays bounded after five minutes with 300 aircraft", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Live stream / No CZML" }).click();
  await expect(page.getByRole("status")).toHaveText("Paused");
  await page.getByRole("button", { name: "300", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Paused");
  await page.getByLabel("Live playback speed").selectOption("10");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.liveSimulation!.state.seconds), { timeout: 45000 }).toBeGreaterThan(320);
  const result = await page.evaluate(() => {
    const e = window.liveSimulation!;
    const points = e.trails.get(0).positions;
    const first = points[0], last = points.at(-1)!;
    return { points: points.length, fps: e.state.fps, distance: Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z) };
  });
  expect(result.points).toBeGreaterThan(50);
  expect(result.points).toBeLessThanOrEqual(151);
  expect(result.distance).toBeGreaterThan(40000);
  console.log("300 aircraft with rolling history:", result);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.screenshot({ path: "benchmarks/live-history.png" });
});

test("live tab streams primitives without CZML and supports count, pause and speed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("tab", { name: "Live stream / No CZML" }).click();
  await expect(page.getByRole("status")).toHaveText("Paused");
  await expect(page.locator(".cesium-timeline-main")).toHaveCount(0);
  for (const count of [100, 200, 300]) {
    await page.getByRole("button", { name: String(count), exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Paused");
    expect(await page.evaluate(() => window.liveSimulation!.billboards.length)).toBe(count);
  }
  await page.getByLabel("Manual aircraft count").fill("123");
  await page.getByRole("button", { name: "Apply count" }).click();
  await expect(page.getByRole("status")).toHaveText("Paused");
  expect(await page.evaluate(() => window.liveSimulation!.billboards.length)).toBe(123);
  for (const speed of ["1", "2", "5", "10"]) {
    await page.getByLabel("Live playback speed").selectOption(speed);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Playing");
    const before = await page.evaluate(() => window.liveSimulation!.state.seconds);
    await expect.poll(() => page.evaluate(() => window.liveSimulation!.state.seconds)).toBeGreaterThan(before + Number(speed) * 0.3);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const paused = await page.evaluate(() => ({ ...window.liveSimulation!.state }));
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.liveSimulation!.state.seconds)).toBe(paused.seconds);
    expect(await page.evaluate(() => window.liveSimulation!.state.frames)).toBe(paused.frames);
  }
  expect(await page.evaluate(() => ({ entities: window.liveSimulation!.viewer.entities.values.length, sources: window.liveSimulation!.viewer.dataSources.length })) ).toEqual({ entities: 0, sources: 0 });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.liveSimulation!.trails.get(0).positions.length)).toBeGreaterThan(3);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const trail = await page.evaluate(() => {
    const e = window.liveSimulation!;
    const points = e.trails.get(0).positions;
    const first = points[0], last = points.at(-1)!;
    return { count: e.trails.length, distance: Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z), rotation: e.billboards.get(0).rotation };
  });
  expect(trail.count).toBe(123);
  expect(trail.distance).toBeGreaterThan(900);
  expect(Math.abs(trail.rotation)).toBeGreaterThan(0);
  await page.screenshot({ path: "benchmarks/live-stream.png" });
  await page.getByRole("tab", { name: "Historical / CZML lab" }).click();
  expect(await page.evaluate(() => window.liveSimulation === undefined)).toBe(true);
  expect(errors).toEqual([]);
});
