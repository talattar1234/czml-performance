import type { Viewer } from "cesium";
import type { DataProvider } from "../data/providers";
export interface Metrics {
  elapsed: number;
  fps: number;
  averageFps: number;
  minFps: number;
  frameMs: number;
  heapMB: number | null;
  loadedSamples: number;
  loadedChunks: number;
  pending: number;
  bytes: number;
  processMs: number;
  loadMs: number;
  trailMs: number;
  activeEntities: number;
  renderedAircraft: number;
  visibleGeometries: number;
  initialMs: number;
  firstRenderMs: number | null;
}
export class PerformanceMonitor {
  history: Metrics[] = [];
  initialMs = 0;
  firstRenderMs: number | null = null;
  trailMs = 0;
  start = performance.now();
  private last = this.start;
  private bucket = this.start;
  private frames = 0;
  private totalFrames = 0;
  private min = Infinity;
  private remove: () => void;
  constructor(
    private viewer: Viewer,
    private provider: DataProvider,
    private emit: (m: Metrics) => void,
  ) {
    this.remove = viewer.scene.postRender.addEventListener(() => this.frame());
  }
  private frame() {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    if (
      this.firstRenderMs === null &&
      this.provider.source.entities.values.length &&
      this.provider.has(0, 0)
    )
      this.firstRenderMs = now - this.start;
    this.frames++;
    this.totalFrames++;
    if (now - this.bucket < 1000) return;
    const fps = (this.frames * 1000) / (now - this.bucket);
    this.min = Math.min(this.min, fps);
    const metrics = this.provider.metrics;
    const memory = (
      performance as Performance & { memory?: { usedJSHeapSize: number } }
    ).memory;
    const entities = this.provider.source.entities.values;
    const m: Metrics = {
      elapsed: (now - this.start) / 1000,
      fps,
      averageFps: (this.totalFrames * 1000) / (now - this.start),
      minFps: this.min,
      frameMs: 1000 / fps,
      heapMB: memory ? memory.usedJSHeapSize / 1048576 : null,
      loadedSamples:
        (this.provider.track("AC-0001")?.samples.length ?? 0) *
        this.provider.config.aircraft,
      loadedChunks: this.provider.loaded.size,
      pending: this.provider.pending.size,
      bytes: metrics.reduce((n, m) => n + m.bytes, 0),
      processMs: metrics.reduce((n, m) => n + m.processMs, 0),
      loadMs: metrics.length
        ? metrics.reduce((n, m) => n + m.fetchMs, 0) / metrics.length
        : 0,
      trailMs: this.trailMs,
      activeEntities: entities.length + this.viewer.entities.values.length,
      renderedAircraft: entities.filter((e) =>
        e.position?.getValue(this.viewer.clock.currentTime),
      ).length,
      visibleGeometries: this.viewer.entities.values.filter((e) => e.isShowing)
        .length,
      initialMs: this.initialMs,
      firstRenderMs: this.firstRenderMs,
    };
    void dt;
    this.history.push(m);
    if (this.history.length > 3600) this.history.shift();
    this.emit(m);
    this.frames = 0;
    this.bucket = now;
  }
  dispose() {
    this.remove();
  }
}
