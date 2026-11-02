import * as C from "cesium";
import { LIVE_INTERVAL, liveOptions, type LiveFrame } from "../../shared/live";

export interface LiveState {
  status: "Connecting" | "Playing" | "Paused" | "Disconnected";
  count: number;
  seconds: number;
  fps: number;
  frames: number;
  error?: string;
  selected?: LiveAircraftDetails;
}

export interface LiveAircraftDetails {
  id: string;
  number: number;
  longitude: number;
  latitude: number;
  altitude: number;
  speed: number;
  heading: number;
}

export class LiveEngine {
  readonly viewer: C.Viewer;
  billboards: C.BillboardCollection;
  trails: C.PolylineCollection;
  private tips: C.PolylineCollection;
  private history: { seconds: number; positions: C.Cartesian3[] }[] = [];
  private tipPositions: C.Cartesian3[][] = [];
  private source?: EventSource;
  private frame?: LiveFrame;
  private received = 0;
  private starts: C.Cartesian3[] = [];
  private ends: C.Cartesian3[] = [];
  private scratch = new C.Cartesian3();
  private removeRender: () => void;
  private lastReport = performance.now();
  private renders = 0;
  private speed = 1;
  private disposed = false;
  private selectedIndex?: number;
  private detailListeners = new Set<() => void>();
  private details: Pick<LiveState, "selected" | "seconds" | "status"> = { seconds: 0, status: "Paused" };
  getDetails = () => this.details;
  subscribeDetails = (listener: () => void) => {
    this.detailListeners.add(listener);
    return () => { this.detailListeners.delete(listener); };
  };
  private picking: C.ScreenSpaceEventHandler;
  state: LiveState = { status: "Paused", count: 100, seconds: 0, fps: 0, frames: 0 };

  constructor(container: HTMLElement, private publish: (state: LiveState) => void) {
    this.viewer = new C.Viewer(container, {
      animation: false, timeline: false, baseLayerPicker: false, baseLayer: false,
      geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, fullscreenButton: false, infoBox: false,
      selectionIndicator: false, shouldAnimate: false,
      requestRenderMode: true, maximumRenderTimeChange: Infinity,
      terrainProvider: new C.EllipsoidTerrainProvider(),
    });
    this.viewer.resolutionScale = 1;
    this.viewer.scene.fog.enabled = false;
    this.viewer.scene.globe.baseColor = C.Color.fromCssColorString("#152c3c");
    void C.TileMapServiceImageryProvider.fromUrl(C.buildModuleUrl("Assets/Textures/NaturalEarthII")).then(p => {
      if (!this.disposed) this.viewer.imageryLayers.addImageryProvider(p);
    }).catch(() => {});
    this.billboards = this.viewer.scene.primitives.add(new C.BillboardCollection({ scene: this.viewer.scene }));
    this.trails = this.viewer.scene.primitives.add(new C.PolylineCollection());
    this.tips = this.viewer.scene.primitives.add(new C.PolylineCollection());
    this.picking = new C.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.picking.setInputAction((event: { position: C.Cartesian2 }) => {
      const picked = this.viewer.scene.pick(event.position);
      const match = typeof picked?.id === "string" ? /^LIVE-(\d+)$/.exec(picked.id) : null;
      this.select(match ? Number(match[1]) - 1 : undefined);
    }, C.ScreenSpaceEventType.LEFT_CLICK);
    this.overview();
    const removeUpdate = this.viewer.scene.preUpdate.addEventListener(() => this.update());
    const removePost = this.viewer.scene.postRender.addEventListener(() => { this.renders++; });
    this.removeRender = () => { removeUpdate(); removePost(); };
    this.configure(100);
  }

  overview() {
    this.viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(30.5, 35, 2300000) });
  }

  configure(count: number) {
    liveOptions(count, this.speed, 0);
    this.select();
    this.pause();
    this.frame = undefined;
    this.viewer.scene.primitives.remove(this.billboards);
    this.billboards = this.viewer.scene.primitives.add(new C.BillboardCollection({ scene: this.viewer.scene }));
    this.trails.removeAll();
    this.tips.removeAll();
    this.history = [];
    this.tipPositions = Array.from({ length: count }, () => [new C.Cartesian3(), new C.Cartesian3()]);
    this.starts = Array.from({ length: count }, () => new C.Cartesian3());
    this.ends = Array.from({ length: count }, () => new C.Cartesian3());
    // All distinct icons share one texture atlas, uploaded once per scenario.
    const size = 48, columns = 32, rows = Math.ceil(count / columns);
    const atlas = document.createElement("canvas");
    atlas.width = columns * size;
    atlas.height = rows * size;
    const ctx = atlas.getContext("2d")!;
    for (let i = 0; i < count; i++) {
      const x = (i % columns) * size, y = Math.floor(i / columns) * size;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = `hsl(${i * 137.508 % 360} 85% 70%)`;
      ctx.strokeStyle = "#081421";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(24, 2); ctx.lineTo(28, 14); ctx.lineTo(43, 25);
      ctx.lineTo(43, 29); ctx.lineTo(28, 24); ctx.lineTo(28, 30);
      ctx.lineTo(34, 34); ctx.lineTo(14, 34); ctx.lineTo(20, 30);
      ctx.lineTo(20, 24); ctx.lineTo(5, 29); ctx.lineTo(5, 25);
      ctx.lineTo(20, 14); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#081421"; ctx.fillRect(6, 34, 36, 14);
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center"; ctx.fillText(String(i + 1), 24, 45);
      ctx.restore();
    }
    const atlasId = `live-atlas-${count}-${performance.now()}`;
    for (let i = 0; i < count; i++) {
      const billboard = this.billboards.add({
        id: `LIVE-${i + 1}`, position: C.Cartesian3.ZERO,
        width: 32, height: 32, show: false, disableDepthTestDistance: Infinity,
        alignedAxis: C.Cartesian3.UNIT_Z,
      });
      billboard.setImage(atlasId, atlas);
      billboard.setImageSubRegion(atlasId, new C.BoundingRectangle((i % columns) * size, atlas.height - (Math.floor(i / columns) + 1) * size, size, size));
      const color = C.Color.fromHsl((i * 137.508 % 360) / 360, 0.85, 0.7, 0.65);
      this.trails.add({ positions: [], width: 1.5, material: C.Material.fromType("Color", { color }) });
      this.tips.add({ positions: [], width: 1.5, material: C.Material.fromType("Color", { color }) });
    }
    this.state = { ...this.state, count, seconds: 0, frames: 0, error: undefined };
    this.connect(true);
  }

  private connect(preview = false) {
    this.source?.close();
    this.state.status = "Connecting";
    this.state.error = undefined;
    this.emit();
    const source = new EventSource(`/api/live?count=${this.state.count}&speed=${this.speed}&seconds=${this.state.seconds}`);
    this.source = source;
    source.onmessage = event => {
      if (this.source !== source) return;
      const frame = JSON.parse(event.data) as LiveFrame;
      this.frame = frame;
      this.received = performance.now();
      for (let i = 0; i < this.state.count; i++) {
        const j = i * 3;
        C.Cartesian3.fromDegrees(frame.positions[j], frame.positions[j + 1], frame.positions[j + 2], undefined, this.starts[i]);
        C.Cartesian3.fromDegrees(frame.next[j], frame.next[j + 1], frame.next[j + 2], undefined, this.ends[i]);
        const b = this.billboards.get(i);
        b.position = this.starts[i]; b.show = true;
        const east = (frame.next[j] - frame.positions[j]) * Math.cos(C.Math.toRadians(frame.positions[j + 1]));
        const north = frame.next[j + 1] - frame.positions[j + 1];
        b.rotation = -Math.atan2(east, north);
      }
      this.recordHistory(frame.seconds);
      this.state.frames++;
      this.state.seconds = frame.seconds;
      const changed = this.state.status !== "Playing";
      this.state.status = preview ? "Paused" : "Playing";
      if (preview) { source.close(); this.source = undefined; }
      this.viewer.scene.requestRender();
      if (changed) this.emit();
    };
    source.onerror = () => {
      if (this.source !== source) return;
      source.close(); this.source = undefined;
      this.state.status = "Disconnected";
      this.state.error = "Stream disconnected. Press Play to reconnect.";
      this.emit();
    };
  }

  play() { this.connect(); }
  select(index?: number) {
    if (this.selectedIndex !== undefined) {
      this.billboards.get(this.selectedIndex).scale = 1;
      this.trails.get(this.selectedIndex).width = 1.5;
      this.tips.get(this.selectedIndex).width = 1.5;
    }
    this.selectedIndex = index !== undefined && Number.isInteger(index) && index >= 0 && index < this.billboards.length && this.billboards.get(index).show ? index : undefined;
    if (this.selectedIndex !== undefined) {
      this.billboards.get(this.selectedIndex).scale = 1.4;
      this.trails.get(this.selectedIndex).width = 3;
      this.tips.get(this.selectedIndex).width = 3;
    }
    this.viewer.scene.requestRender();
    this.emit();
  }
  pause() {
    this.source?.close(); this.source = undefined;
    this.state.status = "Paused";
    this.emit();
  }
  setSpeed(speed: number) {
    liveOptions(this.state.count, speed, this.state.seconds);
    this.speed = speed;
    if (this.source) this.connect(this.state.status === "Connecting" && this.state.frames === 0);
  }
  private recordHistory(seconds: number) {
    const last = this.history.at(-1);
    // Five simulated minutes, sampled every two simulated seconds. Older
    // geometry changes only at this cadence; just the short tip moves per frame.
    if (last && seconds - last.seconds < 2) return;
    this.history.push({ seconds, positions: this.starts.map(p => C.Cartesian3.clone(p)) });
    while (this.history.length > 151 || this.history[0].seconds < seconds - 300)
      this.history.shift();
    for (let i = 0; i < this.state.count; i++) {
      this.trails.get(i).positions = this.history.map(frame => frame.positions[i]);
      C.Cartesian3.clone(this.history.at(-1)!.positions[i], this.tipPositions[i][0]);
    }
  }
  private update() {
    const now = performance.now();
    if (this.frame && this.state.status === "Playing") {
      const alpha = Math.min(1, (now - this.received) / LIVE_INTERVAL);
      this.state.seconds = this.frame.seconds + this.frame.step * alpha;
      for (let i = 0; i < this.state.count; i++) {
        C.Cartesian3.lerp(this.starts[i], this.ends[i], alpha, this.scratch);
        this.billboards.get(i).position = this.scratch;
        C.Cartesian3.clone(this.scratch, this.tipPositions[i][1]);
        this.tips.get(i).positions = this.tipPositions[i];
      }
      if (alpha < 1) this.viewer.scene.requestRender();
      if (this.selectedIndex !== undefined) this.refreshDetails();
    }
    if (now - this.lastReport >= 1000) {
      this.state.fps = this.state.status === "Playing" ? this.renders * 1000 / (now - this.lastReport) : 0;
      this.renders = 0; this.lastReport = now; this.emit();
    }
  }
  private refreshDetails() {
    const index = this.selectedIndex;
    if (index !== undefined && this.frame) {
      const billboard = this.billboards.get(index);
      const position = C.Cartographic.fromCartesian(billboard.position);
      this.state.selected = {
        id: billboard.id,
        number: index + 1,
        longitude: C.Math.toDegrees(position.longitude),
        latitude: C.Math.toDegrees(position.latitude),
        altitude: position.height,
        speed: C.Cartesian3.distance(this.starts[index], this.ends[index]) / this.frame.step,
        heading: (C.Math.toDegrees(-billboard.rotation) + 360) % 360,
      };
    } else this.state.selected = undefined;
    this.details = { selected: this.state.selected, seconds: this.state.seconds, status: this.state.status };
    for (const listener of this.detailListeners) listener();
  }
  private emit() {
    this.refreshDetails();
    this.publish({ ...this.state });
  }
  dispose() {
    this.disposed = true;
    this.source?.close();
    this.picking.destroy();
    this.detailListeners.clear();
    this.removeRender();
    this.viewer.destroy();
  }
}
