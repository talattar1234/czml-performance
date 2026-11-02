import * as C from "cesium";
import {
  metadata,
  type Config,
  type Chunk,
  type Track,
  type Sample,
  resolve,
  serializedChunkBytes,
} from "../../shared/scenario";
export interface LoadMetric {
  start: number;
  end: number;
  fetchMs: number;
  processMs: number;
  bytes: number;
  samples: number;
}
export interface DataProvider {
  source: C.CzmlDataSource | C.CustomDataSource;
  config: Config;
  loaded: Set<number>;
  pending: Map<number, Promise<void>>;
  metrics: LoadMetric[];
  initialize(): Promise<void>;
  ensure(start: number, end: number): Promise<void>;
  has(start: number, end: number): boolean;
  state(id: string, t: number): Sample | undefined;
  track(id: string): Track | undefined;
  dispose(): void;
}
function discreteIntervals(
  samples: Sample[],
  key: "status" | "state",
  step: number,
  duration: number,
) {
  const intervals: { interval: string; string: string }[] = [];
  for (let i = 0; i < samples.length; ) {
    const first = samples[i];
    let j = i + 1;
    while (j < samples.length && samples[j][key] === first[key]) j++;
    const end =
      j < samples.length
        ? samples[j].t
        : Math.min(duration, samples[j - 1].t + step);
    intervals.push({
      interval: iso(first.t) + "/" + iso(end),
      string: first[key],
    });
    i = j;
  }
  return intervals;
}
export const iso = (s: number) =>
  new Date(
    Date.parse(metadata({ minutes: 30 } as Config).start) + s * 1000,
  ).toISOString();
export class ScenarioProvider implements DataProvider {
  source: C.CzmlDataSource | C.CustomDataSource;
  loaded = new Set<number>();
  pending = new Map<number, Promise<void>>();
  metrics: LoadMetric[] = [];
  tracks = new Map<string, Track>();
  private worker?: Worker;
  private jobs = new Map<
    number,
    { resolve: (c: Chunk) => void; reject: (e: Error) => void }
  >();
  private sequence = 0;
  private remoteId = "";
  private metadataReady?: Promise<void>;
  private dead = false;
  private abort = new AbortController();
  private serial = Promise.resolve();
  constructor(public config: Config) {
    this.source =
      config.strategy === "native"
        ? new C.CustomDataSource("Native sampled positions")
        : new C.CzmlDataSource("CZML aircraft");
    if (config.strategy !== "streaming") {
      this.worker = new Worker(
        new URL("./generator.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = ({ data }) => {
        const job = this.jobs.get(data.id);
        if (data.error) job?.reject(new Error(data.error));
        else job?.resolve(data.chunk);
        this.jobs.delete(data.id);
      };
      this.worker.onerror = (e) => {
        for (const j of this.jobs.values()) j.reject(new Error(e.message));
        this.jobs.clear();
      };
    }
  }
  private prepareMetadata() {
    if (this.config.strategy !== "streaming") return Promise.resolve();
    if (!this.metadataReady)
      this.metadataReady = (async () => {
        const r = await fetch("/api/scenarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.config),
          signal: this.abort.signal,
        });
        if (!r.ok) throw new Error("Backend scenario creation failed");
        this.remoteId = (await r.json()).id;
      })();
    return this.metadataReady;
  }
  async initialize() {
    await this.prepareMetadata();
    if (this.config.strategy === "full" || this.config.strategy === "native")
      await this.load(-1);
    else await this.ensure(0, this.config.chunk);
  }
  private async retrieve(start: number, end: number): Promise<Chunk> {
    if (this.config.strategy === "streaming") {
      const r = await fetch(
        `/api/scenarios/${this.remoteId}/chunks?start=${start}&end=${end}`,
        { signal: this.abort.signal },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status} loading historical range`);
      return r.json();
    }
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.jobs.set(id, { resolve, reject });
      this.worker!.postMessage({ id, config: this.config, start, end });
    });
  }
  keys(start: number, end: number) {
    const last = Math.ceil((this.config.minutes * 60) / this.config.chunk) - 1;
    const a = Math.min(
        last,
        Math.max(0, Math.floor(start / this.config.chunk)),
      ),
      b = Math.min(last, Math.floor(end / this.config.chunk));
    return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
  }
  has(start: number, end: number) {
    return (
      this.loaded.has(-1) ||
      this.keys(start, end).every((k) => this.loaded.has(k))
    );
  }
  async ensure(start: number, end: number) {
    await this.prepareMetadata();
    if (this.dead || this.loaded.has(-1)) return;
    for (const k of this.keys(start, end)) await this.load(k);
  }
  private load(key: number): Promise<void> {
    if (this.loaded.has(key) || this.dead) return Promise.resolve();
    const old = this.pending.get(key);
    if (old) return old;
    const task = this.serial
      .then(async () => {
        if (this.dead || this.loaded.has(-1)) return;
        const start = key < 0 ? 0 : key * this.config.chunk,
          end =
            key < 0
              ? this.config.minutes * 60
              : Math.min(this.config.minutes * 60, start + this.config.chunk);
        const t = performance.now();
        const chunk = await this.retrieve(start, end);
        if (this.dead) return;
        const fetchMs = performance.now() - t;
        const bytes = serializedChunkBytes(chunk);
        const p = performance.now();
        await this.ingest(chunk);
        if (this.dead) return;
        this.loaded.add(key);
        this.metrics.push({
          start,
          end,
          fetchMs,
          processMs: performance.now() - p,
          bytes,
          samples: chunk.tracks.reduce((n, t) => n + t.samples.length, 0),
        });
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    this.serial = task.catch(() => {});
    return task;
  }
  private async ingest(chunk: Chunk) {
    const epoch = C.JulianDate.fromIso8601(iso(0));
    if (this.source instanceof C.CzmlDataSource) {
      const packets: object[] = [
        {
          id: "document",
          version: "1.0",
          name: "VECTOR deterministic scenario",
        },
      ];
      for (const track of chunk.tracks) {
        const numeric = (key: keyof Sample) => ({
          epoch: iso(0),
          number: track.samples.flatMap((s) => [s.t, s[key]]),
          interpolationAlgorithm: "LINEAR",
          forwardExtrapolationType: "HOLD",
          forwardExtrapolationDuration: this.config.step,
        });
        packets.push({
          id: track.aircraft.id,
          name: track.aircraft.callsign,
          availability: `${iso(0)}/${iso(this.config.minutes * 60)}`,
          position: {
            epoch: iso(0),
            cartographicDegrees: track.samples.flatMap((s) => [
              s.t,
              s.lon,
              s.lat,
              s.alt,
            ]),
            interpolationAlgorithm: "LINEAR",
            forwardExtrapolationType: "HOLD",
            forwardExtrapolationDuration: this.config.step,
          },
          properties: {
            heading: numeric("heading"),
            speed: numeric("speed"),
            verticalSpeed: numeric("verticalSpeed"),
            status: discreteIntervals(
              track.samples,
              "status",
              this.config.step,
              this.config.minutes * 60,
            ),
            state: discreteIntervals(
              track.samples,
              "state",
              this.config.step,
              this.config.minutes * 60,
            ),
          },
        });
      }
      await this.source.process(packets);
    } else {
      this.source.entities.suspendEvents();
      try {
        for (const track of chunk.tracks) {
          let entity = this.source.entities.getById(track.aircraft.id);
          if (!entity) {
            const position = new C.SampledPositionProperty();
            position.forwardExtrapolationType = C.ExtrapolationType.HOLD;
            position.forwardExtrapolationDuration = this.config.step;
            entity = this.source.entities.add({
              id: track.aircraft.id,
              name: track.aircraft.callsign,
              position,
            });
          }
          (entity.position as C.SampledPositionProperty).addSamplesPackedArray(
            track.samples.flatMap((s) => {
              const p = C.Cartesian3.fromDegrees(s.lon, s.lat, s.alt);
              return [s.t, p.x, p.y, p.z];
            }),
            epoch,
          );
        }
      } finally {
        this.source.entities.resumeEvents();
      }
    }
    for (const tr of chunk.tracks) {
      const previous = this.tracks.get(tr.aircraft.id);
      if (!previous) {
        this.tracks.set(tr.aircraft.id, tr);
        continue;
      }
      const merged = new Map(previous.samples.map((s) => [s.t, s]));
      for (const s of tr.samples) merged.set(s.t, s);
      previous.samples = [...merged.values()].sort((a, b) => a.t - b.t);
    }
  }
  state(id: string, t: number) {
    if (!this.has(t, t)) return;
    const tr = this.tracks.get(id);
    return tr ? resolve(tr.samples, t) : undefined;
  }
  track(id: string) {
    return this.tracks.get(id);
  }
  dispose() {
    this.dead = true;
    this.abort.abort();
    this.worker?.terminate();
    for (const j of this.jobs.values())
      j.reject(new Error("Scenario disposed"));
    this.jobs.clear();
    this.tracks.clear();
    this.loaded.clear();
  }
}
