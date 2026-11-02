import * as C from "cesium";
import type { DataProvider } from "../data/providers";
import { START, type Config } from "../../shared/scenario";

function bound(times: number[], value: number, inclusive: boolean) {
  let lo = 0,
    hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < value || (inclusive && times[mid] === value)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
export class TrailRenderer {
  private collection: C.PolylineCollection;
  private lines = new Map<string, C.Polyline>();
  private version = -1;
  private epoch = C.JulianDate.fromIso8601(START);
  private scratchTime = new C.JulianDate();
  private points = new Map<
    string,
    { length: number; positions: C.Cartesian3[]; times: number[] }
  >();
  constructor(
    private viewer: C.Viewer,
    private provider: DataProvider,
    private config: Config,
  ) {
    this.collection = viewer.scene.primitives.add(new C.PolylineCollection());
  }
  range(t: number): [number, number] {
    const c = this.config;
    return c.trail === "full"
      ? [0, c.minutes * 60]
      : [c.trail === "window" ? Math.max(0, t - c.trailMinutes * 60) : 0, t];
  }
  private positionsFor(entity: C.Entity, time: C.JulianDate): C.Cartesian3[] {
    const track = this.provider.track(entity.id);
    if (!track) return [];
    let cached = this.points.get(entity.id);
    if (!cached || cached.length !== track.samples.length) {
      cached = {
        length: track.samples.length,
        positions: track.samples.map((s) =>
          C.Cartesian3.fromDegrees(s.lon, s.lat, s.alt),
        ),
        times: track.samples.map((s) => s.t),
      };
      this.points.set(entity.id, cached);
    }
    if (this.config.trail === "full") return cached.positions;
    const t = C.JulianDate.secondsDifference(time, this.epoch),
      [start, end] = this.range(t);
    const first = bound(cached.times, start, false),
      last = bound(cached.times, end, true);
    const positions = cached.positions.slice(first, last);
    if (start > 0 && cached.times[first] !== start) {
      const p = entity.position?.getValue(
        C.JulianDate.addSeconds(this.epoch, start, this.scratchTime),
      );
      if (p) positions.unshift(p);
    }
    if (!last || cached.times[last - 1] !== end) {
      const p = entity.position?.getValue(time);
      if (p) positions.push(p);
    }
    return positions;
  }
  update(_seconds: number, _force = false) {
    const c = this.config,
      version = this.provider.loaded.size;
    if (c.trail === "off") return;
    if (
      version === this.version &&
      (c.trail === "full" || c.trailRenderer !== "collection")
    )
      return;
    this.version = version;
    for (const entity of this.provider.source.entities.values) {
      const color = C.Color.fromHsl(
        (Number(entity.id.slice(3)) * 0.618) % 1,
        0.7,
        0.6,
        c.opacity,
      );
      if (c.trailRenderer === "path") {
        if (!entity.path)
          entity.path = new C.PathGraphics({
            width: c.width,
            material: color,
            resolution: c.step,
            leadTime: c.trail === "full" ? c.minutes * 60 : 0,
            trailTime:
              c.trail === "window" ? c.trailMinutes * 60 : c.minutes * 60,
          });
      } else if (c.trailRenderer === "polyline") {
        if (!entity.polyline)
          entity.polyline = new C.PolylineGraphics({
            width: c.width,
            material: color,
            arcType: C.ArcType.NONE,
          });
        // Dynamic callbacks prevent repeated asynchronous static-geometry rebuilds and stale trails.
        entity.polyline.positions =
          c.trail === "full"
            ? new C.ConstantProperty(
                this.positionsFor(entity, this.viewer.clock.currentTime),
              )
            : new C.CallbackProperty(
                (time) => this.positionsFor(entity, time!),
                false,
              );
      } else {
        let line = this.lines.get(entity.id);
        if (!line) {
          line = this.collection.add({
            positions: [],
            width: c.width,
            material: C.Material.fromType("Color", { color }),
            id: entity,
          });
          this.lines.set(entity.id, line);
        }
        const positions = this.positionsFor(
          entity,
          this.viewer.clock.currentTime,
        );
        line.positions = positions;
        line.show = positions.length >= 2;
      }
    }
  }
  dispose() {
    this.viewer.scene.primitives.remove(this.collection);
    this.lines.clear();
    this.points.clear();
  }
}
