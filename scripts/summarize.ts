import { readFile, writeFile, readdir } from "node:fs/promises";
type Row = {
  aircraft: number;
  strategy: string;
  initialMs?: number;
  loadHeap?: number;
  error?: string;
  environment?: { gpu?: string; userAgent?: string; cores?: number };
  seeks?: { ms: number; available: boolean }[];
  history?: {
    fps: number;
    heapMB: number | null;
    frameMs: number;
    elapsed: number;
  }[];
  playback?: {
    speed: number;
    details: boolean;
    realMs: number;
    simulationSeconds: number;
    metrics: { fps: number }[];
  }[];
};
const filenames =
  process.argv.length > 2
    ? process.argv.slice(2)
    : [
        `benchmarks/${(await readdir("benchmarks"))
          .filter((n) => n.startsWith("run-") && n.endsWith(".json"))
          .sort()
          .at(-1)}`,
      ];
const merged = new Map<string, Row>();
for (const filename of filenames) {
  const data: Row[] = JSON.parse(await readFile(filename, "utf8"));
  for (const row of data) merged.set(`${row.aircraft}/${row.strategy}`, row);
}
const rows = [...merged.values()];
const avg = (a: number[]) =>
  a.length ? a.reduce((n, x) => n + x, 0) / a.length : NaN;
const fmt = (n: number | undefined, d = 0) =>
  n === undefined || !Number.isFinite(n) ? "N/A" : n.toFixed(d);
let report = "# Measured benchmark observations\n\n";
report += `Sources: ${filenames.map((f) => `[${f.split("/").at(-1)}](${f.split("/").at(-1)})`).join(", ")}. Later files replace earlier results for the same count/strategy. These are short local Chrome headless screening runs, not sustained workstation or production capacity tests. Each configuration uses seed 42, 30 minutes, 1-second samples, 5-minute Entity Path trails, and a 1440×1000 viewport. The dwell target was 2.5 seconds per playback segment; actual durations are recorded. Reported JS heap is GC-sensitive and includes framework/raw history/Cesium; initialization heap is measured before far seeks. Runs are sequential, one fresh page per configuration. All timing values below come from the stored measurements.\n\n`;
report += `GPU reported by Chrome: **${rows.find((r) => r.environment?.gpu)?.environment?.gpu ?? "Unavailable"}**.\n\n`;
if (filenames.length > 1)
  report +=
    "The 300/2,000-aircraft cases were rerun after bounded byte accounting and removal of unchanged trail-setting assignments. The 100/500/1,000 cases are from the earlier complete matrix. Compare strategies within each count; these are development experiments, not a single-version certified scaling curve. Earlier 2,000-aircraft preload failures remain in the original JSON and were superseded by the rerun.\n\n";
report +=
  "| Aircraft | Strategy | Initial ms | Initial heap MB | Mean seek ms | Mean sampled FPS¹ | 60× achieved rate² |\n|---:|---|---:|---:|---:|---:|---:|\n";
for (const r of rows) {
  const fast = r.playback?.find((p) => p.speed === 60 && !p.details);
  report += `| ${r.aircraft} | ${r.strategy} | ${fmt(r.initialMs)} | ${fmt(r.loadHeap === undefined ? undefined : r.loadHeap / 1048576, 1)} | ${fmt(avg(r.seeks?.map((s) => s.ms) ?? []), 1)} | ${fmt(avg(r.playback?.flatMap((p) => p.metrics.map((m) => m.fps)) ?? []), 1)} | ${fmt(fast ? fast.simulationSeconds / (fast.realMs / 1000) : undefined, 1)}× |\n`;
}
for (const r of rows.filter((r) => r.error))
  report += `\nFailure for ${r.aircraft}/${r.strategy}: ${r.error}\n`;
report +=
  "\n¹ Arithmetic mean of recorded approximately one-second FPS buckets during playback segments. Startup/loading contamination and short segments limit comparisons. ² Simulation seconds advanced divided by real elapsed seconds; buffering and render stalls reduce achieved throughput even though the configured multiplier is 60. A value below 60 is a limitation, not a substituted clock multiplier.\n\n";
report +=
  "## Main scenario: inspector and playback\n\n| Strategy | Speed | Inspector | FPS buckets mean | Actual rate |\n|---|---:|---|---:|---:|\n";
for (const r of rows.filter((r) => r.aircraft === 300))
  for (const p of r.playback ?? [])
    report += `| ${r.strategy} | ${p.speed}× | ${p.details ? "Open" : "Closed"} | ${fmt(avg(p.metrics.map((m) => m.fps)), 1)} | ${fmt(p.simulationSeconds / (p.realMs / 1000), 1)}× |\n`;
report +=
  "\nInspector-open and inspector-closed segments run consecutively, not as randomized repeated trials. Their differences cannot isolate inspector overhead from buffering, garbage collection, or JIT warmup. Functional browser tests independently check historical state after arbitrary seeks, paused values, forward 60× and reverse playback for all four providers.\n";
try {
  const trails = JSON.parse(
    await readFile("benchmarks/trails.json", "utf8"),
  ) as {
    trailRenderer: string;
    trail: string;
    initialMs: number;
    realMs: number;
    simulationSeconds: number;
    error?: string;
    metrics: { fps: number; trailMs: number }[];
    environment?: { userAgent: string };
  }[];
  report +=
    "\n## Trail comparison\n\n[Raw trail measurements](trails.json). Fixed 300-aircraft native provider, 30 minutes, seed 42; seek to minute 15, allow two seconds of upload/shader warmup, then measure five seconds at 10×. Full mode includes all 30 minutes, history includes the reached prefix, window uses five minutes. The sampled trail-hook time excludes callbacks invoked inside Cesium and internal/GPU work. Clock progression is recorded alongside FPS to expose unwanted clock stalls. Earlier results in `trails-before-clock-fix.json` are diagnostic only: asynchronous Entity Polyline rebuilding silently suspended the clock and invalidated that comparison.\n\n| Renderer | Mode | Initial ms | Mean FPS | Sampled hook ms | Actual rate |\n|---|---|---:|---:|---:|---:|\n";
  for (const t of trails)
    report += `| ${t.trailRenderer} | ${t.trail} | ${fmt(t.initialMs)} | ${fmt(avg(t.metrics?.map((m) => m.fps) ?? []), 1)} | ${fmt(avg(t.metrics?.map((m) => m.trailMs) ?? []), 3)} | ${fmt(t.simulationSeconds / (t.realMs / 1000), 1)}× |\n`;
  report += `\nTrail browser: ${trails[0]?.environment?.userAgent ?? "Not recorded"}. Each corrected trail case uses a fresh Edge process; the provider matrix used Chrome. Compare renderer variants within the trail experiment, not absolute FPS across browsers. The actual-rate ratios also have last-frame quantization error, especially at low FPS and short dwell times.\n`;
} catch {
  /* Optional separate experiment. */
}
await writeFile("benchmarks/RESULTS.md", report);
console.log("Wrote benchmarks/RESULTS.md");
