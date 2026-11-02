export type Strategy = "full" | "chunked" | "streaming" | "native";
export interface Config {
  aircraft: number;
  minutes: number;
  step: number;
  chunk: number;
  seed: number;
  radars: number;
  radarRadius: number;
  polygons: number;
  geometries: number;
  strategy: Strategy;
  trail: "full" | "history" | "window" | "off";
  trailMinutes: number;
  trailRenderer: "path" | "polyline" | "collection";
  width: number;
  opacity: number;
  labels: boolean;
  labelInfo: "callsign" | "all";
}
export const defaults: Config = {
  aircraft: 300,
  minutes: 30,
  step: 1,
  chunk: 60,
  seed: 42,
  radars: 4,
  radarRadius: 100,
  polygons: 5,
  geometries: 8,
  strategy: "chunked",
  trail: "window",
  trailMinutes: 5,
  trailRenderer: "path",
  width: 1.5,
  opacity: 0.45,
  labels: true,
  labelInfo: "callsign",
};
export const START = "2026-01-01T10:00:00.000Z";
export const samplesPerAircraft = (c: Config) =>
  Math.ceil((c.minutes * 60) / c.step);
export function validateConfig(input: Partial<Config>): Config {
  const c = { ...defaults, ...input };
  for (const [key, min, max] of [
    ["aircraft", 1, 2000],
    ["minutes", 1, 60],
    ["step", 1, 10],
    ["chunk", 10, 300],
    ["radars", 0, 100],
    ["radarRadius", 10, 500],
    ["polygons", 0, 200],
    ["geometries", 0, 500],
    ["seed", 0, 2147483647],
  ] as const) {
    if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max)
      throw new Error(`Invalid ${key}: expected integer ${min}–${max}`);
  }
  if (!["full", "chunked", "streaming", "native"].includes(c.strategy))
    throw new Error("Invalid strategy");
  if (
    !["full", "history", "window", "off"].includes(c.trail) ||
    !["path", "polyline", "collection"].includes(c.trailRenderer)
  )
    throw new Error("Invalid trail configuration");
  if (
    !Number.isFinite(c.width) ||
    c.width < 1 ||
    c.width > 8 ||
    !Number.isFinite(c.opacity) ||
    c.opacity < 0 ||
    c.opacity > 1
  )
    throw new Error("Line width must be 1–8 and opacity 0–1");
  return c;
}
export function metadata(c: Config) {
  return {
    id: `scenario-${c.seed}-${c.aircraft}-${c.minutes}-${c.step}`,
    start: START,
    end: new Date(Date.parse(START) + c.minutes * 60000).toISOString(),
    duration: c.minutes * 60,
    samplesPerAircraft: samplesPerAircraft(c),
    totalSamples: c.aircraft * samplesPerAircraft(c),
    config: c,
  };
}
function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export interface Aircraft {
  id: string;
  callsign: string;
  type: string;
  model: string;
  registration: string;
  category: string;
  lon: number;
  lat: number;
  alt: number;
  bearing: number;
  speed: number;
  phase: number;
  turn: number;
  climb: number;
}
export function aircraft(c: Config, i: number): Aircraft {
  const r = random(c.seed + i * 7919);
  const category = ["Commercial", "Cargo", "Regional"][i % 3];
  return {
    id: `AC-${String(i + 1).padStart(4, "0")}`,
    callsign: ["VEC", "SKY", "AER", "NOVA"][i % 4] + String(100 + i),
    type: "Aircraft",
    model: ["Airbus A320", "Boeing 737-800", "Embraer E190"][i % 3],
    registration: `N${10000 + i}V`,
    category,
    lon: 24 + r() * 13,
    lat: 30 + r() * 10,
    alt: 5500 + r() * 6000,
    bearing: r() * Math.PI * 2,
    speed: 170 + r() * 90,
    phase: r() * Math.PI * 2,
    turn: i % 3 === 0 ? 0 : (r() - 0.5) * 0.00022,
    climb: (r() - 0.5) * 1.7,
  };
}
export interface Sample {
  t: number;
  lon: number;
  lat: number;
  alt: number;
  heading: number;
  speed: number;
  verticalSpeed: number;
  status: string;
  state: string;
}
export function sample(a: Aircraft, t: number): Sample {
  const w = a.turn,
    b = a.bearing;
  const distance =
    a.speed * t + 8 * 120 * (Math.cos(a.phase) - Math.cos(t / 120 + a.phase));
  const bearing = b + (w * t) / 2;
  const arc =
    Math.abs(w * t) > 1e-8 ? Math.sin((w * t) / 2) / ((w * t) / 2) : 1;
  const north = distance * Math.cos(bearing) * arc,
    east = distance * Math.sin(bearing) * arc;
  const lat = a.lat + north / 111320;
  const lon =
    a.lon + east / (111320 * Math.cos((((a.lat + lat) / 2) * Math.PI) / 180));
  const verticalSpeed = a.climb + 1.2 * Math.cos(t / 240 + a.phase);
  return {
    t,
    lon,
    lat,
    alt:
      a.alt +
      a.climb * t +
      288 * (Math.sin(t / 240 + a.phase) - Math.sin(a.phase)),
    heading: (((((b + w * t) * 180) / Math.PI) % 360) + 360) % 360,
    speed: a.speed + 8 * Math.sin(t / 120 + a.phase),
    verticalSpeed,
    status: a.id.endsWith("7") && t >= 900 && t < 1020 ? "Emergency" : "Active",
    state:
      verticalSpeed > 0.5
        ? "Climbing"
        : verticalSpeed < -0.5
          ? "Descending"
          : "Cruise",
  };
}
export interface Track {
  aircraft: Aircraft;
  samples: Sample[];
}
export interface Chunk {
  start: number;
  end: number;
  tracks: Track[];
}
// Exact JSON UTF-8 byte accounting without creating a >512 MB string for a full preload.
export function serializedChunkBytes(chunk: Chunk): number {
  const encoder = new TextEncoder();
  let bytes = encoder.encode(
    JSON.stringify({ ...chunk, tracks: [] }),
  ).byteLength;
  for (const track of chunk.tracks)
    bytes += encoder.encode(JSON.stringify(track)).byteLength;
  return bytes + Math.max(0, chunk.tracks.length - 1);
}
export function generateChunk(c: Config, start: number, end: number): Chunk {
  const first = Math.max(0, Math.floor(start / c.step) * c.step);
  const last = Math.min(
    (samplesPerAircraft(c) - 1) * c.step,
    Math.ceil(end / c.step) * c.step,
  );
  return {
    start,
    end,
    tracks: Array.from({ length: c.aircraft }, (_, i) => {
      const a = aircraft(c, i);
      const samples: Sample[] = [];
      for (let t = first; t <= last; t += c.step) samples.push(sample(a, t));
      return { aircraft: a, samples };
    }),
  };
}
export function resolve(
  samples: Sample[],
  seconds: number,
): Sample | undefined {
  if (!samples.length || seconds < samples[0].t) return;
  let lo = 0,
    hi = samples.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (samples[mid].t <= seconds) lo = mid;
    else hi = mid - 1;
  }
  const a = samples[lo],
    b = samples[lo + 1];
  if (!b) return { ...a };
  const f = (seconds - a.t) / (b.t - a.t);
  const blend = (k: "lon" | "lat" | "alt" | "speed" | "verticalSpeed") =>
    a[k] + (b[k] - a[k]) * f;
  return {
    ...a,
    lon: blend("lon"),
    lat: blend("lat"),
    alt: blend("alt"),
    speed: blend("speed"),
    verticalSpeed: blend("verticalSpeed"),
    heading:
      (a.heading + (((b.heading - a.heading + 540) % 360) - 180) * f + 360) %
      360,
  };
}
export interface GeometrySpec {
  id: string;
  kind: string;
  lon: number;
  lat: number;
  radius: number;
  index: number;
}
export function geometrySpecs(c: Config): GeometrySpec[] {
  const r = random(c.seed + 919);
  return [
    ...Array.from({ length: c.radars }, (_, i) => ({
      kind: "Radar",
      index: i,
    })),
    ...Array.from({ length: c.polygons }, (_, i) => ({
      kind: i % 2 ? "Dynamic polygon" : "Restricted airspace",
      index: i,
    })),
    ...Array.from({ length: c.geometries }, (_, i) => ({
      kind: ["Ellipse", "Sphere", "Cylinder", "Rectangle", "Link"][i % 5],
      index: i,
    })),
  ].map((g, i) => ({
    ...g,
    id: `${g.kind}-${i + 1}`,
    lon: 25 + r() * 13,
    lat: 31 + r() * 8,
    radius: g.kind === "Radar" ? c.radarRadius * 1000 : 60000 + r() * 90000,
  }));
}
