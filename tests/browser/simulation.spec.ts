import { test, expect } from "@playwright/test";
test("fast CZML playback preloads intervening chunks in both directions", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 120000 });
  for (const direction of [1, -1]) {
    await page.evaluate(async (direction) => {
      const e = window.simulation!;
      await e.generate({
        ...e.config,
        aircraft: 5,
        minutes: 5,
        chunk: 10,
        strategy: "chunked",
        trail: "off",
      });
      await e.seek(direction > 0 ? 30 : 240);
      e.speed(direction * 60);
      e.play();
      // Freeze the clock while the real prefetch finishes: no boundary seek can fill gaps.
      e.pause();
    }, direction);
    await expect.poll(() => page.evaluate((direction) => {
      const p = window.simulation!.provider;
      return direction > 0 ? p.has(30, 210) : p.has(60, 240);
    }, direction)).toBe(true);
    const movement = await page.evaluate(() => {
      const e = window.simulation!;
      const position = e.provider.source.entities.getById("AC-0001")!.position!;
      const time = e.viewer.clock.currentTime.clone();
      const a = position.getValue(time)!;
      time.secondsOfDay += 0.25;
      const b = position.getValue(time)!;
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    });
    expect(movement).toBeGreaterThan(1);
    expect(movement).toBeLessThan(100);
  }
});
test("generic inspector resolves actual geometry dimensions and clock-driven radar state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 120000 });
  await page.evaluate(() => {
    const e = window.simulation!;
    e.select(e.viewer.entities.values.find((x) => x.ellipsoid)!.id);
  });
  await expect(page.getByText("20,000 m", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const e = window.simulation!;
    e.select(e.viewer.entities.values.find((x) => x.cylinder)!.id);
  });
  await expect(page.getByText("24,000 m", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const e = window.simulation!;
    await e.seek(15);
    e.select(
      e.viewer.entities.values.find(
        (x) =>
          x.properties?.getValue(e.viewer.clock.currentTime).kind === "Radar",
      )!.id,
    );
  });
  await expect(page.getByText("180.0°", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await window.simulation!.seek(900);
    window.simulation!.select("AC-0007");
  });
  await expect(page.getByText("Emergency", { exact: true })).toBeVisible();
  await page.screenshot({ path: "benchmarks/dashboard.png" });
});
test("trail rendering cannot silently suspend the clock and polyline tips match clock time", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 120000 });
  for (const trailRenderer of ["path", "polyline", "collection"] as const) {
    await page.evaluate(async (trailRenderer) => {
      const e = window.simulation!;
      await e.generate({
        ...e.config,
        aircraft: 20,
        minutes: 5,
        strategy: "native",
        trail: "window",
        trailMinutes: 2,
        trailRenderer,
      });
      await e.seek(150.5);
      e.speed(10);
      e.play();
    }, trailRenderer);
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.simulation!.pause());
    expect(
      await page.evaluate(() => window.simulation!.seconds()),
    ).toBeGreaterThan(158);
    expect(
      await page.evaluate(() => window.simulation!.viewer.clock.canAnimate),
    ).toBe(true);
    if (trailRenderer === "polyline") {
      const error = await page.evaluate(() => {
        const e = window.simulation!,
          a = e.provider.source.entities.getById("AC-0001")!,
          time = e.viewer.clock.currentTime;
        const positions = a.polyline!.positions!.getValue(time),
          tip = positions.at(-1),
          p = a.position!.getValue(time)!;
        return Math.hypot(tip.x - p.x, tip.y - p.y, tip.z - p.z);
      });
      expect(error).toBeLessThan(0.001);
    }
  }
});
test("seeking during delayed backend initialization waits for metadata and keeps the newest target", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 120000 });
  await page.route("**/api/scenarios", async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.continue();
  });
  await page.evaluate(async () => {
    const e = window.simulation!;
    const init = e.generate({
      ...e.config,
      aircraft: 10,
      strategy: "streaming",
      trail: "off",
    });
    await new Promise((r) => setTimeout(r, 100));
    await Promise.all([e.seek(1500), e.seek(300), init]);
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);
  expect(await page.evaluate(() => window.simulation!.seconds())).toBe(300);
  expect(
    await page.evaluate(
      () => !!window.simulation!.provider.state("AC-0001", 300),
    ),
  ).toBe(true);
  const before = await page.evaluate(
    () => window.simulation!.provider.metrics.length,
  );
  await page.evaluate(async () => {
    await window.simulation!.seek(1500);
    await window.simulation!.seek(300);
  });
  expect(
    await page.evaluate(() => window.simulation!.provider.metrics.length),
  ).toBe(before);
});
test("300 aircraft play the complete 30 minutes and hold the final state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 120000 });
  await page.evaluate(async () => {
    const e = window.simulation!;
    await e.generate({ ...e.config, aircraft: 300, strategy: "native" });
    e.select("AC-0001");
    e.speed(60);
    e.play();
  });
  await page.waitForFunction(
    () => window.simulation!.seconds() >= 1800,
    undefined,
    { timeout: 90000 },
  );
  await expect(page.locator(".clock-badge")).toContainText("10:30:00");
  expect(
    await page.evaluate(
      () => window.simulation!.provider.track("AC-0001")!.samples.length,
    ),
  ).toBe(1800);
  expect(
    await page.evaluate(
      () => window.simulation!.provider.state("AC-0001", 1800)!.t,
    ),
  ).toBe(1799);
  expect(
    await page.evaluate(() => window.simulation!.viewer.clock.shouldAnimate),
  ).toBe(false);
});
test("clock excludes synchronous loading time; native timeline and map picking work", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 120000 });
  await page.evaluate(async () => {
    const e = window.simulation!;
    await e.generate({ ...e.config, aircraft: 20, trail: "off" });
    await e.seek(300);
    e.pause();
    const start = performance.now();
    while (performance.now() - start < 500) {}
    e.play();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => window.simulation!.pause());
  expect(await page.evaluate(() => window.simulation!.seconds())).toBeLessThan(
    300.6,
  );
  const timeline = page.locator(".cesium-timeline-bar");
  const box = (await timeline.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.75, box.y + 10);
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 120000 });
  expect(
    await page.evaluate(() => window.simulation!.seconds()),
  ).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "Configure", exact: false }).click();
  await page.getByRole("button", { name: "Metrics", exact: false }).click();
  const picked = await page.evaluate(() => {
    const e = window.simulation!;
    for (const entity of e.provider.source.entities.values) {
      const position = entity.position?.getValue(e.viewer.clock.currentTime);
      if (!position) continue;
      const point = e.viewer.scene.cartesianToCanvasCoordinates(position);
      if (
        point &&
        point.x > 50 &&
        point.x < 1300 &&
        point.y > 120 &&
        point.y < 750
      )
        return { id: entity.id, x: point.x, y: point.y };
    }
    return undefined;
  });
  expect(picked).toBeTruthy();
  const canvas = (await page.locator("canvas").first().boundingBox())!;
  await page.mouse.click(canvas.x + picked!.x, canvas.y + picked!.y);
  await expect(page.locator(".entity-heading")).toContainText(picked!.id);
});
test("full timeline, random access, historical selection, reverse and all providers", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => window.simulation?.provider?.loaded.size);
  await expect(page.locator(".cesium-timeline-main")).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 120000 });
  for (const strategy of ["chunked", "streaming", "native", "full"] as const) {
    await page.evaluate(async (strategy) => {
      const e = window.simulation!;
      await e.generate({
        ...e.config,
        aircraft: 10,
        strategy,
        trail: "window",
        trailMinutes: 2,
      });
    }, strategy);
    for (const time of [900, 300, 1620, 1800, 0]) {
      await page.evaluate(async (t) => {
        await window.simulation!.seek(t);
        window.simulation!.select("AC-0007");
      }, time);
      await expect(page.locator(".clock-badge")).toContainText(
        new Date(Date.parse("2026-01-01T10:00:00Z") + time * 1000)
          .toISOString()
          .slice(11, 19),
      );
      const state = await page.evaluate(() => {
        const e = window.simulation!;
        return {
          duration:
            (e.viewer.clock.stopTime.dayNumber -
              e.viewer.clock.startTime.dayNumber) *
              86400 +
            e.viewer.clock.stopTime.secondsOfDay -
            e.viewer.clock.startTime.secondsOfDay,
          count: e.provider.source.entities.values.length,
          sample: e.provider.state("AC-0007", e.seconds()),
          entities: e.viewer.entities.values.length,
        };
      });
      expect(state.duration).toBe(1800);
      expect(state.count).toBe(10);
      expect(state.sample).toBeTruthy();
      if (time === 900)
        await expect(page.locator(".stat-list")).toContainText(["Emergency"]);
    }
    await page.evaluate(async () => {
      const e = window.simulation!;
      await e.seek(900);
      e.speed(60);
      e.play();
    });
    await page.waitForTimeout(1100);
    const advanced = await page.evaluate(() => window.simulation!.seconds());
    expect(advanced).toBeGreaterThan(920);
    await page.evaluate(() => window.simulation!.pause());
    const paused = await page.evaluate(() => window.simulation!.seconds());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.simulation!.seconds())).toBeCloseTo(
      paused,
      3,
    );
    await page.evaluate(() => {
      window.simulation!.speed(-60);
      window.simulation!.play();
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.simulation!.pause());
    expect(
      await page.evaluate(() => window.simulation!.seconds()),
    ).toBeLessThan(paused);
  }
  await page.screenshot({ path: "test-results/dashboard.png" });
  expect(errors).toEqual([]);
});
test("all trail renderers survive backwards seeking and replacement", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 120000 });
  for (const trailRenderer of ["path", "polyline", "collection"] as const) {
    for (const trail of ["full", "history", "window"] as const) {
      await page.evaluate(
        async ({ trailRenderer, trail }) => {
          const e = window.simulation!;
          await e.generate({
            ...e.config,
            aircraft: 5,
            minutes: 5,
            trailRenderer,
            trail,
          });
          await e.seek(250);
          await e.seek(45);
        },
        { trailRenderer, trail },
      );
      await expect(page.locator(".error-banner")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => window.simulation!.provider.source.entities.values.length,
        ),
      ).toBe(5);
    }
  }
});
