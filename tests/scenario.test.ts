import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  generateChunk,
  metadata,
  samplesPerAircraft,
  aircraft,
  sample,
  resolve,
  validateConfig,
  serializedChunkBytes,
} from "../shared/scenario";
test("bounded byte accounting equals exact serialized UTF-8 including separators", () => {
  for (const n of [0, 1, 5]) {
    const chunk = generateChunk({ ...defaults, aircraft: n }, 0, 60);
    if (n) chunk.tracks[0].aircraft.callsign = "UNICODE-✈";
    assert.equal(
      serializedChunkBytes(chunk),
      new TextEncoder().encode(JSON.stringify(chunk)).byteLength,
    );
  }
});
test("default metadata owns the complete 30 minute clock and exact sample count", () => {
  const m = metadata(defaults);
  assert.equal(m.totalSamples, 540000);
  assert.equal(m.samplesPerAircraft, 1800);
  assert.equal(Date.parse(m.end) - Date.parse(m.start), 1800000);
  const tr = generateChunk({ ...defaults, aircraft: 1 }, 0, 1800).tracks[0];
  assert.equal(tr.samples.length, 1800);
  assert.equal(tr.samples.at(-1)!.t, 1799);
});
test("random-access generation is deterministic and overlap matches", () => {
  const c = { ...defaults, aircraft: 3 };
  const a = generateChunk(c, 0, 60),
    b = generateChunk(c, 60, 120);
  assert.deepEqual(a.tracks[0].samples.at(-1), b.tracks[0].samples[0]);
  assert.deepEqual(b, generateChunk(c, 60, 120));
  assert.notDeepEqual(b, generateChunk({ ...c, seed: 99 }, 60, 120));
});
test("all presets have exact sample counts", () => {
  for (const n of [100, 300, 500, 1000, 2000])
    assert.equal(n * samplesPerAircraft(defaults), n * 1800);
});
test("movement is continuous with plausible speeds, changing numeric and discrete state", () => {
  const a = aircraft(defaults, 6);
  let previous = sample(a, 0);
  for (let t = 1; t < 1800; t++) {
    const s = sample(a, t);
    assert.ok(Math.abs(s.lat - previous.lat) < 0.004);
    assert.ok(Math.abs(s.lon - previous.lon) < 0.006);
    assert.ok(s.speed > 100 && s.speed < 300);
    assert.ok(Math.abs(s.alt - previous.alt) < 3);
    previous = s;
  }
  assert.equal(sample(a, 950).status, "Emergency");
  assert.equal(sample(a, 1020).status, "Active");
  assert.notEqual(sample(a, 5).speed, sample(a, 500).speed);
});
test("state interpolation wraps headings and holds discrete values", () => {
  const a = sample(aircraft(defaults, 0), 0),
    b = { ...a, t: 1, lon: a.lon + 1, heading: 1, status: "Emergency" };
  a.heading = 359;
  const mid = resolve([a, b], 0.5)!;
  assert.equal(mid.heading, 0);
  assert.equal(mid.status, "Active");
  assert.equal(mid.lon, a.lon + 0.5);
  assert.equal(resolve([a, b], 1)!.status, "Emergency");
  assert.equal(resolve([a, b], 0)!.t, 0);
});
test("server input validation rejects unbounded workloads", () => {
  assert.throws(() => validateConfig({ aircraft: 2001 }));
  assert.throws(() => validateConfig({ minutes: NaN }));
  assert.throws(() => validateConfig({ step: 0 }));
});
