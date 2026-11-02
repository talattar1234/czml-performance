import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LiveEngine, type LiveState } from "../engine/LiveEngine";
import { LIVE_MAX } from "../../shared/live";

declare global { interface Window { liveSimulation?: LiveEngine } }

export function LiveTab() {
  const map = useRef<HTMLDivElement>(null);
  const engine = useRef<LiveEngine | undefined>(undefined);
  const [count, setCount] = useState("100");
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState("");
  const [state, setState] = useState<LiveState>({ status: "Connecting", count: 100, seconds: 0, fps: 0, frames: 0 });
  useEffect(() => {
    try {
      const e = new LiveEngine(map.current!, setState);
      engine.current = e;
      window.liveSimulation = e;
      return () => { e.dispose(); delete window.liveSimulation; };
    } catch (error) { setError(String(error)); }
  }, []);
  const apply = (value: string) => {
    try { engine.current?.configure(Number(value)); setError(""); }
    catch (error) { setError(String(error)); }
  };
  return <div className="app live-app">
    <header><a className="brand" href="#">VECTOR <small>LIVE AIRSPACE</small></a><span className="live-dot">SERVER STREAM</span></header>
    <main className={`with-config ${state.selected ? "with-right" : ""}`}>
      <div className="map" ref={map} />
      <aside className="left-panel">
        <div className="panel-title">Live aircraft</div>
        <p className="hint">Aircraft fly at jet speeds with matching history trails. Icons point in their direction of travel.</p>
        <p className="hint">Click an aircraft to inspect its live flight details.</p>
        <div className="section-label">AIRCRAFT COUNT</div>
        <div className="live-presets">{[100, 200, 300].map(n => <button key={n} className={state.count === n ? "active" : ""} onClick={() => { setCount(String(n)); apply(String(n)); }}>{n}</button>)}</div>
        <form onSubmit={event => { event.preventDefault(); apply(count); }}>
          <label className="field"><span>Manual aircraft count</span><input aria-label="Manual aircraft count" type="number" min="1" max={LIVE_MAX} step="1" required value={count} onChange={event => setCount(event.target.value)} /></label>
          <button type="submit">Apply count</button>
        </form>
        <p className="hint">1–{LIVE_MAX.toLocaleString()} aircraft. Changing count starts a new paused scenario.</p>
        <div className="section-label">LIVE PERFORMANCE</div>
        <dl className="stat-list">
          <div><dt>Aircraft</dt><dd>{state.count.toLocaleString()}</dd></div>
          <div><dt>Render FPS</dt><dd>{state.status === "Playing" ? state.fps.toFixed(0) : "—"}</dd></div>
          <div><dt>Received frames</dt><dd>{state.frames.toLocaleString()}</dd></div>
          <div><dt>Server update rate</dt><dd>10 Hz</dd></div>
          <div><dt>History trails</dt><dd>Last 5 minutes</dd></div>
        </dl>
        <button onClick={() => engine.current?.overview()}>Overview</button>
      </aside>
      <div className="map-top"><div className="eyebrow">LIVE / NO CZML</div><h1>Streaming airspace</h1><p>{state.count.toLocaleString()} aircraft · {speed}× speed</p></div>
      {state.selected && engine.current && <AircraftDetails engine={engine.current} />}
      {(error || state.error) && <div className="error-banner" role="alert">{error || state.error}</div>}
    </main>
    <footer><div className="playback">
      <button className="primary play" disabled={state.status === "Connecting" || !engine.current} onClick={() => state.status === "Playing" ? engine.current?.pause() : engine.current?.play()}>{state.status === "Playing" ? "Pause" : "Play"}</button>
      <label className="live-speed">Speed <select aria-label="Live playback speed" value={speed} onChange={event => { const n = Number(event.target.value); setSpeed(n); engine.current?.setSpeed(n); }}>{[1, 2, 5, 10].map(n => <option key={n} value={n}>{n}×</option>)}</select></label>
      <span className="state" role="status">{state.status}</span>
    </div></footer>
  </div>;
}

function AircraftDetails({ engine }: { engine: LiveEngine }) {
  const state = useSyncExternalStore(engine.subscribeDetails, engine.getDetails);
  if (!state.selected) return null;
  return <aside className="right-panel" aria-label="Aircraft details">
        <div className="panel-title">Aircraft details <button aria-label="Close aircraft details" onClick={() => engine.select()}>×</button></div>
        <div className="entity-heading"><span className="eyebrow">SELECTED AIRCRAFT</span><h2>Aircraft {state.selected.number}</h2><code>{state.selected.id}</code></div>
        <div className="section-label">LIVE FLIGHT DATA</div>
        <dl className="stat-list">
          <div><dt>Latitude</dt><dd data-testid="aircraft-latitude">{state.selected.latitude.toFixed(5)}°</dd></div>
          <div><dt>Longitude</dt><dd>{state.selected.longitude.toFixed(5)}°</dd></div>
          <div><dt>Altitude</dt><dd>{state.selected.altitude.toFixed(0)} m / {(state.selected.altitude * 3.28084).toFixed(0)} ft</dd></div>
          <div><dt>Speed</dt><dd>{state.selected.speed.toFixed(1)} m/s / {(state.selected.speed * 1.94384).toFixed(0)} kt</dd></div>
          <div><dt>Heading</dt><dd>{state.selected.heading.toFixed(1)}°</dd></div>
          <div><dt>Playback</dt><dd>{state.status}</dd></div>
          <div><dt>Simulation time</dt><dd>{state.seconds.toFixed(1)} s</dd></div>
        </dl>
        <p className="hint">Synthetic aircraft. Flight details follow the streamed position and update with each movement frame while playing. Speed is independent of the playback multiplier.</p>
      </aside>;
}
