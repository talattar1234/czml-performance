import * as C from "cesium";
import {
  metadata,
  samplesPerAircraft,
  type Config,
} from "../../shared/scenario";
import { ScenarioProvider, type DataProvider } from "../data/providers";
import { PerformanceMonitor, type Metrics } from "./PerformanceMonitor";
import { TrailRenderer } from "../render/TrailRenderer";
import { renderGeometries } from "../render/GeometryRenderer";
export interface Snapshot {
  seconds: number;
  timestamp: string;
  playing: boolean;
  buffering: boolean;
  selected?: {
    id: string;
    name: string;
    sections: Record<string, Record<string, string | number>>;
  };
  error?: string;
}
const icon =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="white" stroke="#0b1825" stroke-width="1" d="M16 2 L19 12 L29 19 L29 22 L19 19 L19 25 L23 28 L23 30 L16 28 L9 30 L9 28 L13 25 L13 19 L3 22 L3 19 L13 12 Z"/></svg>',
  );
export class SimulationEngine {
  viewer: C.Viewer;
  provider!: DataProvider;
  monitor!: PerformanceMonitor;
  trails!: TrailRenderer;
  config!: Config;
  private start = C.JulianDate.fromIso8601(
    metadata({ minutes: 30 } as Config).start,
  );
  private removeTick: () => void;
  private removeSelect: () => void;
  private lastUI = 0;
  private revision = 0;
  private disposed = false;
  private waiting = false;
  private wantPlay = false;
  private error?: string;
  private lastGood = 0;
  private decorated = new Set<string>();
  private prevSelected?: C.Entity;
  private selected?: C.Entity;
  constructor(
    container: HTMLElement,
    private onState: (s: Snapshot) => void,
    private onMetrics: (m: Metrics) => void,
  ) {
    this.viewer = new C.Viewer(container, {
      animation: false,
      timeline: true,
      baseLayerPicker: false,
      baseLayer: false,
      geocoder: false,
      homeButton: true,
      sceneModePicker: true,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: true,
      shouldAnimate: false,
      automaticallyTrackDataSourceClocks: false,
      terrainProvider: new C.EllipsoidTerrainProvider(),
    });
    // Only this engine's explicit buffering may stop simulation time, not asynchronous graphics.
    this.viewer.allowDataSourcesToSuspendAnimation = false;
    void C.TileMapServiceImageryProvider.fromUrl(
      C.buildModuleUrl("Assets/Textures/NaturalEarthII"),
    ).then((p) => {
      if (!this.disposed) this.viewer.imageryLayers.addImageryProvider(p);
    });
    this.viewer.scene.globe.baseColor = C.Color.fromCssColorString("#152c3c");
    this.viewer.scene.backgroundColor = C.Color.fromCssColorString("#080e18");
    this.viewer.scene.globe.enableLighting = false;
    this.viewer.scene.fog.enabled = false;
    this.viewer.resolutionScale = Math.min(window.devicePixelRatio, 1.5);
    this.overview();
    this.removeTick = this.viewer.clock.onTick.addEventListener(() =>
      this.tick(),
    );
    this.removeSelect = this.viewer.selectedEntityChanged.addEventListener(
      (e) => {
        this.selected = e;
        this.highlight();
        this.publish();
      },
    );
    this.viewer.timeline.container.addEventListener(
      "settime",
      () => {
        if (this.config) this.seek(this.seconds());
      },
      false,
    );
  }
  seconds(t = this.viewer.clock.currentTime) {
    return C.JulianDate.secondsDifference(t, this.start);
  }
  overview() {
    this.viewer.camera.setView({
      destination: C.Cartesian3.fromDegrees(32, 35, 2300000),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
  }
  async generate(config: Config) {
    const revision = ++this.revision;
    this.wantPlay = false;
    this.waiting = true;
    this.error = undefined;
    this.viewer.clock.shouldAnimate = false;
    this.selected = undefined;
    this.viewer.selectedEntity = undefined;
    this.viewer.trackedEntity = undefined;
    this.monitor?.dispose();
    this.trails?.dispose();
    this.provider?.dispose();
    this.viewer.dataSources.removeAll(true);
    this.viewer.entities.removeAll();
    this.decorated.clear();
    this.config = { ...config };
    this.lastGood = 0;
    const clock = this.viewer.clock;
    clock.startTime = C.JulianDate.clone(this.start);
    clock.stopTime = C.JulianDate.addSeconds(
      this.start,
      config.minutes * 60,
      new C.JulianDate(),
    );
    clock.currentTime = C.JulianDate.clone(this.start);
    clock.clockRange = C.ClockRange.CLAMPED;
    clock.clockStep = C.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
    clock.multiplier = 1;
    clock.canAnimate = true;
    this.viewer.timeline.zoomTo(clock.startTime, clock.stopTime);
    this.provider = new ScenarioProvider(config);
    await this.viewer.dataSources.add(this.provider.source);
    this.trails = new TrailRenderer(this.viewer, this.provider, config);
    renderGeometries(this.viewer, config, (t) => this.seconds(t));
    this.monitor = new PerformanceMonitor(
      this.viewer,
      this.provider,
      this.onMetrics,
    );
    this.publish();
    try {
      await this.provider.initialize();
      if (revision !== this.revision || this.disposed) return;
      this.decorate();
      await this.ensureAt(0);
      if (revision !== this.revision) return;
      this.monitor.initialMs = performance.now() - this.monitor.start;
      this.trails.update(0, true);
      this.viewer.clock.tick();
      this.waiting = false;
      this.viewer.clock.shouldAnimate = this.wantPlay;
      this.publish();
    } catch (e) {
      if (revision === this.revision) this.fail(e);
    }
  }
  private required(t: number): [number, number] {
    if (this.config.trail === "full") return [0, this.config.minutes * 60];
    if (this.config.trail === "history") return [0, t];
    return [
      this.config.trail === "window"
        ? Math.max(0, t - this.config.trailMinutes * 60)
        : t,
      t,
    ];
  }
  private async ensureAt(t: number) {
    const [a, b] = this.required(t);
    await this.provider.ensure(a, b);
    this.decorate();
  }
  private decorate() {
    for (const e of this.provider.source.entities.values) {
      if (this.decorated.has(e.id)) continue;
      this.decorated.add(e.id);
      e.billboard = new C.BillboardGraphics({
        image: icon,
        width: 24,
        height: 24,
        color: C.Color.fromCssColorString("#6ce9e1"),
        alignedAxis: C.Cartesian3.UNIT_Z,
        rotation: new C.CallbackProperty(
          (t) =>
            (-(this.provider.state(e.id, this.seconds(t))?.heading ?? 0) *
              Math.PI) /
            180,
          false,
        ),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      e.label = new C.LabelGraphics({
        text:
          this.config.labelInfo === "all"
            ? new C.CallbackProperty((t) => {
                const s = this.provider.state(e.id, this.seconds(t));
                return `${e.name}  ${s ? Math.round(s.alt) + "m · " + Math.round(s.speed * 1.94384) + "kt" : ""}`;
              }, false)
            : e.name,
        font: "11px monospace",
        fillColor: C.Color.fromCssColorString("#a4c9cc"),
        show: this.config.labels,
        pixelOffset: new C.Cartesian2(13, -13),
        horizontalOrigin: C.HorizontalOrigin.LEFT,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 2400000),
      });
    }
  }
  private tick() {
    if (!this.provider || !this.config || this.disposed || this.error) return;
    const t = Math.max(0, Math.min(this.config.minutes * 60, this.seconds()));
    const [a, b] = this.required(t);
    if (!this.waiting && !this.provider.has(a, b)) {
      this.viewer.clock.currentTime = C.JulianDate.addSeconds(
        this.start,
        this.lastGood,
        new C.JulianDate(),
      );
      void this.seek(t);
      return;
    }
    if (!this.waiting) {
      this.lastGood = t;
      const begin = performance.now();
      this.trails.update(t);
      this.monitor.trailMs = performance.now() - begin;
      if (
        this.wantPlay &&
        ((t >= this.config.minutes * 60 && this.viewer.clock.multiplier > 0) ||
          (t <= 0 && this.viewer.clock.multiplier < 0))
      ) {
        this.wantPlay = false;
        this.viewer.clock.shouldAnimate = false;
      }
      if (this.wantPlay) this.prefetch(t);
    }
    if (performance.now() - this.lastUI > 120) {
      this.publish();
      this.lastUI = performance.now();
    }
  }
  private prefetch(t: number) {
    if (!this.provider || this.waiting || this.provider.pending.size) return;
    const provider = this.provider;
    const ahead = Math.max(
      0,
      Math.min(
        this.config.minutes * 60,
        t +
          Math.sign(this.viewer.clock.multiplier) *
            Math.max(this.config.chunk, Math.abs(this.viewer.clock.multiplier) * 3),
      ),
    );
    const [a, b] = this.required(t);
    const [nextA, nextB] = this.required(ahead);
    // Load every intervening chunk, including when trails are off or playing backwards.
    const pa = Math.min(a, nextA),
      pb = Math.max(b, nextB);
    if (!provider.has(pa, pb))
      void provider
        .ensure(pa, pb)
        .then(() => {
          if (this.provider === provider && !this.disposed) this.decorate();
        })
        .catch((e) => {
          if (this.provider === provider && !this.disposed) this.fail(e);
        });
  }
  async seek(seconds: number) {
    if (!this.config) return;
    this.error = undefined;
    const token = ++this.revision;
    const target = Math.max(0, Math.min(seconds, this.config.minutes * 60));
    this.waiting = true;
    this.viewer.clock.shouldAnimate = false;
    this.provider.source.show = false;
    this.viewer.clock.currentTime = C.JulianDate.addSeconds(
      this.start,
      target,
      new C.JulianDate(),
    );
    this.publish();
    try {
      await this.ensureAt(target);
      if (token !== this.revision || this.disposed) return;
      this.lastGood = target;
      this.provider.source.show = true;
      this.trails.update(target, true);
      this.viewer.clock.tick();
      this.waiting = false;
      this.viewer.clock.shouldAnimate = this.wantPlay;
      this.publish();
    } catch (e) {
      if (token === this.revision) this.fail(e);
    }
  }
  play() {
    if (this.error) {
      this.wantPlay = true;
      void this.seek(this.seconds());
      return;
    }
    this.viewer.clock.shouldAnimate = false;
    this.viewer.clock.tick();
    this.wantPlay = true;
    if (!this.waiting) this.viewer.clock.shouldAnimate = true;
    this.prefetch(this.seconds());
    this.publish();
  }
  pause() {
    this.wantPlay = false;
    this.viewer.clock.shouldAnimate = false;
    this.publish();
  }
  stop() {
    this.pause();
    void this.seek(0);
  }
  restart() {
    this.wantPlay = true;
    void this.seek(
      this.viewer.clock.multiplier < 0 ? this.config.minutes * 60 : 0,
    );
  }
  speed(value: number) {
    this.viewer.clock.multiplier = value;
    if (this.wantPlay) this.prefetch(this.seconds());
    this.publish();
  }
  select(id?: string) {
    this.viewer.selectedEntity = id
      ? (this.provider.source.entities.getById(id) ??
        this.viewer.entities.getById(id))
      : undefined;
  }
  follow() {
    this.viewer.trackedEntity = this.viewer.trackedEntity
      ? undefined
      : this.selected;
  }
  private highlight() {
    if (this.prevSelected?.billboard) {
      this.prevSelected.billboard.color = new C.ConstantProperty(
        C.Color.fromCssColorString("#6ce9e1"),
      );
      this.prevSelected.billboard.scale = new C.ConstantProperty(1);
    }
    if (this.selected?.billboard) {
      this.selected.billboard.color = new C.ConstantProperty(C.Color.YELLOW);
      this.selected.billboard.scale = new C.ConstantProperty(1.5);
    }
    this.prevSelected = this.selected;
  }
  private publish() {
    if (!this.config) return;
    const seconds = this.seconds();
    const result: Snapshot = {
      seconds,
      timestamp: C.JulianDate.toIso8601(this.viewer.clock.currentTime, 0),
      playing: this.wantPlay,
      buffering: this.waiting,
      error: this.error,
    };
    if (this.selected) {
      const e = this.selected,
        tr = this.provider.track(e.id);
      const sections: Record<string, Record<string, string | number>> = {};
      if (tr) {
        const a = tr.aircraft,
          s = this.waiting ? undefined : this.provider.state(e.id, seconds);
        sections.Identification = {
          "Entity ID": a.id,
          Callsign: a.callsign,
          Type: a.type,
          Model: a.model,
          Registration: a.registration,
          Category: a.category,
        };
        sections["Position at clock time"] = s
          ? {
              Latitude: s.lat.toFixed(5) + "°",
              Longitude: s.lon.toFixed(5) + "°",
              Altitude: Math.round(s.alt) + " m",
              Heading: s.heading.toFixed(1) + "°",
              "Ground speed": (s.speed * 1.94384).toFixed(1) + " kt",
              "Vertical speed": s.verticalSpeed.toFixed(2) + " m/s",
            }
          : { Availability: "Loading requested historical range…" };
        sections.Operations = s
          ? {
              Status: s.status,
              State: s.state,
              "Last sample": new Date(
                Date.parse(metadata(this.config).start) + s.t * 1000,
              ).toISOString(),
              "Data source": this.config.strategy,
              "Random seed": this.config.seed,
            }
          : { Status: "Unavailable" };
        sections.Trajectory = {
          "Total samples": samplesPerAircraft(this.config),
          "Loaded samples": tr.samples.length,
          "First recorded": metadata(this.config).start,
          "Last recorded": new Date(
            Date.parse(metadata(this.config).start) +
              (samplesPerAircraft(this.config) - 1) * this.config.step * 1000,
          ).toISOString(),
          Duration: this.config.minutes + " min",
          Trail:
            this.config.trail === "window"
              ? this.config.trailMinutes + " min"
              : this.config.trail,
        };
      } else {
        const time = this.viewer.clock.currentTime;
        const kind = e.properties?.getValue(time)?.kind ?? "Geometry";
        sections.Geometry = {
          "Entity ID": e.id,
          Type: kind,
          Visible: e.isShowing ? "Yes" : "No",
          "Simulation time": result.timestamp,
        };
        const shape: Record<string, string | number> = {};
        const meters = (value: number) =>
          Math.round(value).toLocaleString() + " m";
        const position = e.position?.getValue(time);
        if (position) {
          const p = C.Cartographic.fromCartesian(position);
          shape["Anchor latitude"] =
            C.Math.toDegrees(p.latitude).toFixed(5) + "°";
          shape["Anchor longitude"] =
            C.Math.toDegrees(p.longitude).toFixed(5) + "°";
          shape["Anchor altitude"] = meters(p.height);
        }
        if (e.ellipse) {
          shape["Semi-major axis"] = meters(
            e.ellipse.semiMajorAxis!.getValue(time),
          );
          shape["Semi-minor axis"] = meters(
            e.ellipse.semiMinorAxis!.getValue(time),
          );
        }
        if (e.ellipsoid) {
          const r = e.ellipsoid.radii!.getValue(time);
          shape.Radius = meters(r.x);
        }
        if (e.cylinder) {
          shape.Radius = meters(e.cylinder.topRadius!.getValue(time));
          shape.Length = meters(e.cylinder.length!.getValue(time));
          const material = e.cylinder.material?.getValue(time);
          if (material?.color)
            shape["Fill opacity"] =
              (material.color.alpha * 100).toFixed(1) + "%";
        }
        if (e.polygon) {
          shape["Floor altitude"] = meters(e.polygon.height!.getValue(time));
          shape["Ceiling altitude"] = meters(
            e.polygon.extrudedHeight!.getValue(time),
          );
          shape.Vertices = e.polygon.hierarchy!.getValue(time).positions.length;
        }
        if (e.rectangle) {
          const r = e.rectangle.coordinates!.getValue(time);
          shape.Bounds = [r.west, r.south, r.east, r.north]
            .map((n) => C.Math.toDegrees(n).toFixed(3))
            .join(", ");
        }
        if (kind === "Radar")
          shape["Sweep angle"] =
            ((((seconds * 12) % 360) + 360) % 360).toFixed(1) + "°";
        if (kind === "Dynamic polygon")
          shape["Longitude offset"] =
            (0.15 * Math.sin(seconds / 120)).toFixed(4) + "°";
        sections["Shape at clock time"] = shape;
      }
      result.selected = { id: e.id, name: e.name ?? e.id, sections };
    }
    this.onState(result);
  }
  private fail(e: unknown) {
    this.error = String(e);
    this.waiting = false;
    this.pause();
  }
  export(format: "json" | "csv") {
    const history = this.monitor.history;
    const report = {
      config: this.config,
      metadata: metadata(this.config),
      environment: {
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        viewport: [innerWidth, innerHeight],
        hardwareConcurrency: navigator.hardwareConcurrency,
      },
      notes: {
        heap: "Scope-dependent JS heap when supported, not isolated scenario memory.",
        fps: "postRender frame cadence; includes startup and stalls.",
        bytes:
          "Serialized source JSON UTF-8 bytes; excludes HTTP compression and CZML expansion.",
        cpu: "Wall durations only; OS CPU utilization unavailable.",
      },
      loads: this.provider.metrics,
      history,
    };
    const body =
      format === "json"
        ? JSON.stringify(report, null, 2)
        : history.length
          ? [
              Object.keys(history[0]).join(","),
              ...history.map((m) =>
                Object.values(m)
                  .map((v) => v ?? "")
                  .join(","),
              ),
            ].join("\n")
          : "";
    const url = URL.createObjectURL(
      new Blob([body], {
        type: format === "json" ? "application/json" : "text/csv",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `vector-${this.config.strategy}-${Date.now()}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  dispose() {
    this.disposed = true;
    this.revision++;
    this.removeTick();
    this.removeSelect();
    this.monitor?.dispose();
    this.trails?.dispose();
    this.provider?.dispose();
    this.viewer.destroy();
  }
}
