import { test } from "node:test";
import assert from "node:assert/strict";
import { liveOptions, livePositions } from "../shared/live";

test("live stream validates count, speed and resume time", () => {
  for (const count of [1, 100, 200, 300, 2000])
    for (const speed of [1, 2, 5, 10]) assert.equal(liveOptions(count, speed, 123).count, count);
  for (const count of [0, -1, 2001, 1.5, NaN]) assert.throws(() => liveOptions(count, 1, 0));
  assert.throws(() => liveOptions(100, 3, 0));
  assert.throws(() => liveOptions(100, 1, Infinity));
});
test("streamed positions are deterministic, bounded and move at simulation speed", () => {
  const a = livePositions(300, 0), b = livePositions(300, 1), c = livePositions(300, 10);
  assert.equal(a.length, 900);
  assert.deepEqual(a, livePositions(300, 0));
  assert.ok(c.every(Number.isFinite));
  const distance = (p: number[]) => Math.hypot(p[0] - a[0], p[1] - a[1]);
  assert.ok(distance(b) > 0);
  assert.ok(distance(c) / distance(b) > 9.9);
  assert.ok(livePositions(2000, 1e9).every(Number.isFinite));
  for (let i = 0; i < 300; i++) {
    const j = i * 3;
    const metersPerSecond = Math.hypot(
      (b[j] - a[j]) * 111320 * Math.cos(a[j + 1] * Math.PI / 180),
      (b[j + 1] - a[j + 1]) * 111320,
    );
    assert.ok(metersPerSecond > 160 && metersPerSecond < 320, `Aircraft ${i}: ${metersPerSecond} m/s`);
  }
});
