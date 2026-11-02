import { useEffect, useRef, useState, memo } from "react";
import {
  defaults,
  samplesPerAircraft,
  validateConfig,
  type Config,
} from "../../shared/scenario";
import { SimulationEngine, type Snapshot } from "../engine/SimulationEngine";
import type { Metrics } from "../engine/PerformanceMonitor";
import { LiveTab } from "./LiveTab";
declare global {
  interface Window {
    simulation?: SimulationEngine;
  }
}
const labels = {
  full: "A / Full CZML preload",
  chunked: "B / Chunked CZML",
  streaming: "C / HTTP historical streaming",
  native: "D / Native sampled positions",
};
const initial: Snapshot = {
  seconds: 0,
  timestamp: "2026-01-01T10:00:00Z",
  playing: false,
  buffering: true,
};
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
const Configuration = memo(function Configuration({
  generate,
  busy,
}: {
  generate: (c: Config) => void;
  busy: boolean;
}) {
  const [c, set] = useState(defaults);
  const [error, setError] = useState("");
  const change = <K extends keyof Config>(key: K, value: Config[K]) =>
    set((old) => ({ ...old, [key]: value }));
  const numeric = (key: keyof Config, label: string, min = 0, max = 2000) => (
    <Field label={label}>
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        value={c[key] as number}
        onChange={(e) => change(key, Number(e.target.value))}
      />
    </Field>
  );
  return (
    <>
      <div className="panel-title">
        <span>Scenario configuration</span>
        <span className="tag">REPRODUCIBLE</span>
      </div>
      <div className="section-label">01 / DATASET</div>
      <Field label="Benchmark preset">
        <select
          aria-label="Benchmark preset"
          onChange={(e) =>
            set({
              ...c,
              aircraft: Number(e.target.value),
              minutes: 30,
              step: 1,
            })
          }
          value={
            [100, 300, 500, 1000, 2000].includes(c.aircraft) ? c.aircraft : ""
          }
        >
          <option value="">Custom</option>
          {[100, 300, 500, 1000, 2000].map((n, i) => (
            <option key={n} value={n}>
              {["Baseline", "Main scenario", "Large", "Heavy", "Extreme"][i]} ·{" "}
              {n.toLocaleString()} aircraft
            </option>
          ))}
        </select>
      </Field>
      {numeric("aircraft", "Aircraft count", 1)}
      <div className="pair">
        <Field label="Duration">
          <select
            aria-label="Duration"
            value={c.minutes}
            onChange={(e) => change("minutes", +e.target.value)}
          >
            {[5, 10, 20, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} minutes
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sample interval">
          <select
            value={c.step}
            onChange={(e) => change("step", +e.target.value)}
          >
            {[1, 2, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n} second{n > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {numeric("seed", "Random seed", 0, 2147483647)}
      <div className="sample-estimate">
        <strong>{(c.aircraft * samplesPerAircraft(c)).toLocaleString()}</strong>
        <span>position samples</span>
        <small>
          {c.aircraft.toLocaleString()} aircraft ×{" "}
          {samplesPerAircraft(c).toLocaleString()} samples
        </small>
      </div>
      <div className="section-label">02 / DELIVERY & RENDERING</div>
      <Field label="Data strategy">
        <select
          aria-label="Data strategy"
          value={c.strategy}
          onChange={(e) =>
            change("strategy", e.target.value as Config["strategy"])
          }
        >
          {Object.entries(labels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Chunk duration">
        <select
          value={c.chunk}
          onChange={(e) => change("chunk", +e.target.value)}
        >
          {[30, 60, 300].map((n) => (
            <option key={n} value={n}>
              {n} seconds
            </option>
          ))}
        </select>
      </Field>
      <Field label="Trail mode">
        <select
          aria-label="Trail mode"
          value={c.trail}
          onChange={(e) => change("trail", e.target.value as Config["trail"])}
        >
          <option value="full">
            A · Complete trajectory (includes future)
          </option>
          <option value="history">B · History to current time</option>
          <option value="window">C · Rolling history window</option>
          <option value="off">Off · Aircraft only</option>
        </select>
      </Field>
      <div className="pair">
        <Field label="Trail window">
          <select
            value={c.trailMinutes}
            onChange={(e) => change("trailMinutes", +e.target.value)}
          >
            {[2, 5, 10, 60].map((n) => (
              <option key={n} value={n}>
                {n === 60 ? "Full history" : n + " min"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Implementation">
          <select
            value={c.trailRenderer}
            onChange={(e) =>
              change("trailRenderer", e.target.value as Config["trailRenderer"])
            }
          >
            <option value="path">Entity Path</option>
            <option value="polyline">Entity Polyline</option>
            <option value="collection">PolylineCollection</option>
          </select>
        </Field>
      </div>
      <div className="pair">
        {numeric("width", "Line width", 1, 8)}
        <Field label="Trail opacity">
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={c.opacity}
            onChange={(e) => change("opacity", +e.target.value)}
          />
        </Field>
      </div>
      <div className="section-label">03 / OPERATIONAL OBJECTS</div>
      <div className="pair">
        {numeric("radars", "Radars", 0, 100)}
        {numeric("polygons", "Polygons", 0, 200)}
      </div>
      {numeric("radarRadius", "Radar radius (km)", 10, 500)}
      {numeric("geometries", "Other geometries", 0, 500)}
      <Field label="Aircraft labels">
        <select
          value={!c.labels ? "off" : c.labelInfo}
          onChange={(e) =>
            set({
              ...c,
              labels: e.target.value !== "off",
              labelInfo: e.target.value === "all" ? "all" : "callsign",
            })
          }
        >
          <option value="off">Hidden</option>
          <option value="callsign">Callsign</option>
          <option value="all">Callsign + altitude + speed</option>
        </select>
      </Field>
      {error && <p className="error">{error}</p>}
      <button
        className="primary generate"
        disabled={busy}
        onClick={() => {
          try {
            generate(validateConfig(c));
            setError("");
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        {busy ? "Preparing scenario…" : "Generate scenario ↗"}
      </button>
      <p className="hint">
        Changing parameters applies on generation. Full trails request all
        history, including future chunks.
      </p>
    </>
  );
});
function Spark({
  values,
  color = "#60ded2",
}: {
  values: number[];
  color?: string;
}) {
  const max = Math.max(1, ...values),
    min = Math.min(0, ...values);
  const points = values
    .map(
      (v, i) =>
        `${(i / Math.max(1, values.length - 1)) * 220},${40 - ((v - min) / (max - min)) * 36}`,
    )
    .join(" ");
  return (
    <svg
      viewBox="0 0 220 44"
      className="spark"
      aria-label="Measured metric over time"
    >
      <path d="M0 40 H220" stroke="#293948" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}
const Dashboard = memo(function Dashboard({
  metrics,
  history,
  engine,
}: {
  metrics?: Metrics;
  history: Metrics[];
  engine?: SimulationEngine;
}) {
  const m = metrics;
  return (
    <>
      <div className="panel-title">
        Performance <span className="live-dot">● LIVE</span>
      </div>
      <div className="metric-grid">
        <div>
          <strong>{m?.fps.toFixed(0) ?? "—"}</strong>
          <span>FPS / current</span>
        </div>
        <div>
          <strong>{m?.frameMs.toFixed(1) ?? "—"}</strong>
          <span>ms / frame</span>
        </div>
        <div>
          <strong>{m?.heapMB?.toFixed(0) ?? "N/A"}</strong>
          <span>MB / reported JS heap</span>
        </div>
        <div>
          <strong>{m?.loadedSamples.toLocaleString() ?? "0"}</strong>
          <span>samples loaded</span>
        </div>
      </div>
      {(
        [
          ["FPS", "fps", "#65dfd2"],
          ["Reported JS heap · MB", "heapMB", "#ac9cf5"],
          ["Mean retrieval · ms", "loadMs", "#edbf7e"],
          ["Cumulative processing · ms", "processMs", "#f3989f"],
          ["Loaded samples", "loadedSamples", "#65b7f3"],
        ] as const
      ).map(([label, key, color]) => (
        <div className="chart" key={key}>
          <span>{label}</span>
          <Spark values={history.map((m) => m[key] ?? 0)} color={color} />
        </div>
      ))}
      <dl className="stat-list">
        {Object.entries({
          "Average / minimum FPS": m
            ? `${m.averageFps.toFixed(1)} / ${m.minFps.toFixed(1)}`
            : "—",
          "Position-available aircraft": m?.renderedAircraft ?? 0,
          "Shown geometry entities": m?.visibleGeometries ?? 0,
          "Active entities": m?.activeEntities ?? 0,
          "Serialized source MB": m ? (m.bytes / 1048576).toFixed(2) : "—",
          "Loaded chunks / pending": m
            ? `${m.loadedChunks} / ${m.pending}`
            : "—",
          "Initialization ms": m?.initialMs.toFixed(0) ?? "—",
          "First render ms": m?.firstRenderMs?.toFixed(0) ?? "—",
          "Processing wall ms": m?.processMs.toFixed(1) ?? "—",
          "Trail hook wall ms": m?.trailMs.toFixed(2) ?? "—",
          "Packed positions estimate MB": m
            ? ((m.loadedSamples * 32) / 1048576).toFixed(2)
            : "—",
          "OS CPU / position-only CPU": "Unavailable",
        }).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="pair">
        <button onClick={() => engine?.export("json")}>Export JSON ↓</button>
        <button onClick={() => engine?.export("csv")}>Export CSV ↓</button>
      </div>
      <p className="hint">
        Actual frame cadence and wall times. Heap is scope-dependent. Packed
        estimate excludes object overhead. Position availability is not a GPU
        draw count.
      </p>
    </>
  );
});
export function App() {
  const [tab, setTab] = useState("historical");
  return <div className="workspace">
    <nav className="workspace-tabs" role="tablist" aria-label="Simulation mode">
      <button role="tab" aria-selected={tab === "historical"} onClick={() => setTab("historical")}>Historical / CZML lab</button>
      <button role="tab" aria-selected={tab === "live"} onClick={() => setTab("live")}>Live stream / No CZML</button>
    </nav>
    <div role="tabpanel">{tab === "live" ? <LiveTab /> : <HistoricalApp />}</div>
  </div>;
}
function HistoricalApp() {
  const map = useRef<HTMLDivElement>(null);
  const engine = useRef<SimulationEngine | undefined>(undefined);
  const [snapshot, setSnapshot] = useState(initial);
  const [metrics, setMetrics] = useState<Metrics>();
  const [history, setHistory] = useState<Metrics[]>([]);
  const [config, setConfig] = useState(defaults);
  const [left, setLeft] = useState(true);
  const [perf, setPerf] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [direction, setDirection] = useState(1);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState("");
  useEffect(() => {
    try {
      const e = new SimulationEngine(map.current!, setSnapshot, (m) => {
        setMetrics(m);
        setHistory((h) => [...h.slice(-89), m]);
      });
      engine.current = e;
      window.simulation = e;
      setReady(true);
      void e.generate(defaults);
      return () => {
        e.dispose();
        delete window.simulation;
      };
    } catch (e) {
      setFatal(String(e));
    }
  }, []);
  const generate = (c: Config) => {
    setConfig(c);
    setHistory([]);
    setMetrics(undefined);
    setSpeed(1);
    setDirection(1);
    void engine.current?.generate(c);
  };
  return (
    <div className="app">
      <header>
        <a className="brand" href="#">
          <span className="brand-mark">⌁</span> VECTOR{" "}
          <small>SIMULATION LAB</small>
        </a>
        <div className="header-center">
          <span className="live-dot">●</span> SYNTHETIC AIRSPACE{" "}
          <span className="divider">/</span> EASTERN MEDITERRANEAN
        </div>
        <div className="header-actions">
          <button
            className={left ? "active" : ""}
            onClick={() => setLeft(!left)}
          >
            ☷ Configure
          </button>
          <button
            className={perf ? "active" : ""}
            onClick={() => setPerf(!perf)}
          >
            ▥ Metrics
          </button>
        </div>
      </header>
      <main
        className={`${left ? "with-config" : ""} ${perf || snapshot.selected ? "with-right" : ""}`}
      >
        <div className="map" ref={map} />
        {left && (
          <aside className="left-panel">
            <Configuration generate={generate} busy={snapshot.buffering} />
          </aside>
        )}
        <div className="map-top">
          <div className="eyebrow">
            PERFORMANCE EXPERIMENT / {config.strategy.toUpperCase()}
          </div>
          <h1>Airspace observatory</h1>
          <p>
            {config.aircraft.toLocaleString()} aircraft <span>·</span>{" "}
            {config.minutes} min <span>·</span> {config.step}s resolution
          </p>
        </div>
        <div className="map-tools">
          <button
            title="Reset camera"
            onClick={() => engine.current?.overview()}
          >
            ◎ Overview
          </button>
          <button onClick={() => engine.current?.select("AC-0001")}>
            Select AC-0001
          </button>
        </div>
        <div className="map-legend">
          <span className="cyan">✈</span> Aircraft{" "}
          <span className="cyan">◉</span> Radar <span className="amber">▱</span>{" "}
          Airspace
        </div>
        {(perf || snapshot.selected) && (
          <aside className="right-panel">
            {snapshot.selected ? (
              <>
                <div className="panel-title">
                  Entity inspector{" "}
                  <button
                    aria-label="Clear selection"
                    onClick={() => engine.current?.select()}
                  >
                    ×
                  </button>
                </div>
                <div className="entity-heading">
                  <span className="eyebrow">SELECTED ENTITY</span>
                  <h2>{snapshot.selected.name}</h2>
                  <code>{snapshot.selected.id}</code>
                </div>
                <div className="clock-badge">
                  ◷ {snapshot.timestamp.slice(11, 19)} UTC · simulation time
                </div>
                <div className="pair">
                  <button onClick={() => engine.current?.follow()}>
                    Toggle camera follow
                  </button>
                  <button onClick={() => engine.current?.select()}>
                    Clear
                  </button>
                </div>
                {Object.entries(snapshot.selected.sections).map(
                  ([section, rows]) => (
                    <section key={section}>
                      <div className="section-label">{section}</div>
                      <dl className="stat-list">
                        {Object.entries(rows).map(([key, v]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ),
                )}
                {perf && (
                  <details>
                    <summary>Performance metrics</summary>
                    <Dashboard
                      metrics={metrics}
                      history={history}
                      engine={engine.current}
                    />
                  </details>
                )}
              </>
            ) : (
              <Dashboard
                metrics={metrics}
                history={history}
                engine={engine.current}
              />
            )}
          </aside>
        )}
        {snapshot.buffering && (
          <div className="loading">
            <span className="spinner" /> Loading historical range{" "}
            <small>Full timeline remains available</small>
          </div>
        )}
        {(snapshot.error || fatal) && (
          <div className="error-banner">{snapshot.error || fatal}</div>
        )}
      </main>
      <footer>
        <div className="playback">
          <button
            title="Stop and reset"
            disabled={!ready}
            onClick={() => engine.current?.stop()}
          >
            ■
          </button>
          <button title="Restart" onClick={() => engine.current?.restart()}>
            ↺
          </button>
          <button
            className="play primary"
            aria-label={snapshot.playing ? "Pause" : "Play"}
            onClick={() =>
              snapshot.playing
                ? engine.current?.pause()
                : engine.current?.play()
            }
          >
            {snapshot.playing ? "Ⅱ" : "▶"}
          </button>
          <button
            className={direction < 0 ? "active" : ""}
            title="Reverse playback"
            onClick={() => {
              setDirection(-direction);
              engine.current?.speed(-direction * speed);
            }}
          >
            ⇄
          </button>
          <select
            aria-label="Playback speed"
            value={speed}
            onChange={(e) => {
              setSpeed(+e.target.value);
              engine.current?.speed(+e.target.value * direction);
            }}
          >
            {[1, 2, 5, 10, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
          <span className="timestamp">
            {snapshot.timestamp.slice(11, 19)} <small>UTC</small>
          </span>
          <span className="state">
            {snapshot.buffering
              ? "BUFFERING"
              : snapshot.playing
                ? direction < 0
                  ? "REVERSE"
                  : "PLAYING"
                : "PAUSED"}
          </span>
        </div>
        <div className="jump">
          <span>SEEK</span>
          {[5, 15, 27]
            .filter((n) => n <= config.minutes)
            .map((n) => (
              <button key={n} onClick={() => void engine.current?.seek(n * 60)}>
                {n}m
              </button>
            ))}
        </div>
        <div className="interval">
          <span>
            10:00:00 —{" "}
            {new Date(
              Date.parse("2026-01-01T10:00:00Z") + config.minutes * 60000,
            )
              .toISOString()
              .slice(11, 19)}{" "}
            UTC
          </span>
          <small>FULL SCENARIO INTERVAL · {config.minutes}:00</small>
        </div>
      </footer>
    </div>
  );
}
