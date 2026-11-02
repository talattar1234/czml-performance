# VECTOR — Cesium historical simulation lab

A local React/TypeScript engineering POC with real CesiumJS rendering, a real Cesium Timeline, deterministic aircraft history, four delivery/rendering strategies, selectable historical entities, and measured benchmark exports. No Cesium ion token, map service, database, or external infrastructure is needed. The low-resolution Natural Earth imagery ships with Cesium.

## Run

Use Node.js 22.12+ (tested here with Node 26) and npm:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. This starts Vite and the HTTP historical API on port 3001. To run just the backend: `npm run server`. Alternatively, `docker compose up --build` starts the backend; start the frontend separately with `npx vite`. Do not start two backends on the same port.

`npm run build` type-checks and builds the frontend into `dist/`. Use a static server with an `/api` reverse proxy to port 3001 when testing the production bundle. Docker Compose is for the backend, not a production deployment of the whole application.

## Operate

### Live stream tab (no CZML)

Select **Live stream / No CZML** for a separate server-driven scenario. Choose **100 / 200 / 300** aircraft or enter **1–2,000**, then press **Play**. Playback supports **1× / 2× / 5× / 10×** and **Pause**, without a timeline. Changing count resets the scenario to a paused preview; switching tabs disposes the previous simulation.

`GET /api/live?count=300&speed=1&seconds=0` streams SSE frames at 10 Hz. The server generates continuous bounded routes and sends packed current/next geographic positions. Speed scales simulation time without increasing the update rate. Pause closes the connection; resume starts from the displayed simulation time. Disconnects freeze movement and expose a Play-to-reconnect message. Slow connections skip updates under backpressure instead of accumulating an unbounded server queue. Reverse proxies must disable buffering for this endpoint.

The client interpolates server samples into a `BillboardCollection`, using one shared atlas of individually colored and numbered aircraft icons that face their direction of travel. Aircraft move at jet speeds comparable to the historical lab. Matching colored `PolylineCollection` trails retain the last five simulated minutes of received history (at most 151 samples per aircraft). History is sampled every two simulated seconds; a separate short segment connects the history to the moving icon each frame. Trails grow from scenario start, freeze on pause, and clear on count changes. No CZML, entity positions, or timeline is used in this tab. Position buffers, trail history and the atlas are bounded by aircraft count and released when replacing a scenario. Rendering is requested during motion; React statistics update once per second. Actual FPS depends on the browser, GPU, viewport and aircraft count; the live panel reports rendered frame cadence.

Run `npx playwright test tests/browser/live.spec.ts` for streaming playback coverage.

Click an aircraft icon in the live tab to highlight it and open its details panel: aircraft ID, latitude, longitude, altitude in meters/feet, speed in m/s/knots, heading, playback state and elapsed simulation time. These values come from the displayed streamed position and current server samples, refresh with each aircraft movement frame, and freeze on pause. Close the panel or click empty map space to clear selection; changing aircraft count also clears it.

### Historical lab

- The default is 300 aircraft, 30 minutes, 1-second intervals: exactly **540,000 unique position samples**. Samples are at seconds 0–1799. The final sample is held to second 1800, so the actual timeline is exactly 10:00–10:30 UTC.
- Choose a preset or enter a custom count, duration, update interval, seed, strategy, geometry counts, labels, and trail settings. Click **Generate scenario**. Configuration changes apply together; previous entities, worker, primitives, event subscriptions, requests, and cached scenario data are released.
- The Cesium Timeline spans the complete metadata interval before data finishes loading. Drag it to any time. Wheel-zooming the native timeline is still available. Regeneration resets its visible interval to the full scenario.
- Use play/pause, stop, restart, reverse, and 1×/2×/5×/10×/30×/60×. The 5m/15m/27m buttons exercise direct seeking without sequential replay. Speed changes Cesium's simulation-time multiplier.
- Missing history pauses clock advancement with an explicit loading indicator. The requested range is fetched, trails are prepared, and playback resumes only if it was requested. Clock bounds never follow CZML data-source availability. Prefetch distance scales with multiplier and works in both directions.
- Click an aircraft, radar, zone, or volume. The right inspector stays open during playback and seeking. **Select AC-0001** provides a convenient alternative to map picking. Follow toggles Cesium's tracked entity; clear closes selection. Selected aircraft turn yellow and enlarge.
- Every inspector value is evaluated at `viewer.clock.currentTime`. Numeric state interpolates between recorded samples; heading wraps around north, discrete status/state holds the preceding sample. The panel refreshes from clock events at roughly 8 Hz, immediately on seek/selection, and uses no independent simulation timer. Paused time freezes values. Missing data shows a loading state.

## Strategies and trails

| Strategy | Generation / delivery | Cesium storage |
|---|---|---|
| A — full CZML | Complete scenario generated in a worker, processed in one batch | CZML sampled positions and numeric/discrete properties |
| B — chunked CZML | Worker generates requested historical chunks | Incremental `CzmlDataSource.process`, stable IDs, overlapping boundary samples |
| C — HTTP streaming | Backend metadata followed by historical HTTP range requests | Same incremental CZML consumer as B, isolating transport/generation cost |
| D — native | Complete history from worker | `SampledPositionProperty` + `CustomDataSource`, bypassing CZML parsing |

The native comparison keeps non-position history in the common state store rather than duplicating it into Cesium properties. This is an intentional architectural difference; memory comparisons include it. Aircraft positions use Cesium sampled properties, not manual per-frame movement. Billboard heading and optional detailed labels evaluate recorded state at clock time.

Trail mode A shows the full trajectory (including future data), B shows all reached history, and C uses 2/5/10 minutes or full history. Compare **Entity Path**, **Entity Polyline**, and **PolylineCollection**. Complete trails necessarily fetch all future chunks before becoming complete. All-reached-history trails fetch preceding ranges on a far-forward seek. A rolling window only needs its own historical ranges. Dynamic Entity Polylines evaluate positions directly at clock time, while PolylineCollection updates on clock ticks. Both reuse cached Cartesian samples and interpolate the current tip. Full polylines remain static until new history arrives; Entity Path uses Cesium's time-dynamic path visualizer.

Radar sweep, moving polygons, and changing cylinder material derive from the same clock. Static circles/ellipses, spheres, cylinders, rectangles, connecting lines and restricted volumes are configurable. Radar radius is generated deterministically per station (60–150 km), shown in the inspector.

## Architecture and deliberate choices

- `shared/scenario.ts`: deterministic random-access generator, metadata, validation, types, state interpolation. Backend and worker use the identical generator. Movement is a smooth regional kinematic approximation, not certified navigation or flight dynamics.
- `src/data/providers.ts`: common provider contract, deduplicated requests, serialized ingestion, stable entity IDs, merged overlap samples. `generator.worker.ts` isolates generation from UI.
- `src/engine/SimulationEngine.ts`: viewer lifecycle, full clock ownership, timeline seeking, buffering/prefetch, selection and historical inspector model. Cesium data-source clock tracking is explicitly disabled.
- `src/render`: independent geometry and trail renderers.
- `src/engine/PerformanceMonitor.ts`: post-render frame cadence and once-per-second measurements. React receives throttled snapshots, not per-aircraft frame updates.
- `src/ui`: configuration, dashboard, playback and inspector.
- `server/index.ts`: in-memory scenario registry and HTTP historical queries. It regenerates requested ranges deterministically instead of retaining millions of JS objects server-side.

The per-scenario cache retains all fetched samples, including Cesium samples, until regeneration. It is deduplicated and bounded by configured scenario size (2,000 aircraft / 60 minutes), **not** an LRU memory budget. This makes repeated seeks fast but exposes memory growth during long sessions. Production needs range eviction from both raw and Cesium storage, not merely deleting HTTP response objects. CZML merging behavior follows the [Cesium CzmlDataSource API](https://cesium.com/learn/cesiumjs/ref-doc/CzmlDataSource.html).

`viewer.allowDataSourcesToSuspendAnimation` is disabled: asynchronous geometry readiness must not silently pause the simulation clock. Only the engine's explicit missing-data buffering pauses playback. Aircraft are hidden while a requested range is unavailable, preventing Cesium from drawing interpolated positions across unloaded gaps. A regression test checks actual clock progression for every trail renderer and verifies the dynamic polyline tip against the aircraft's position at fractional timestamps.

## API

```text
GET  /api/scenarios
POST /api/scenarios                          JSON: scenario configuration
GET  /api/scenarios/:id/metadata
GET  /api/scenarios/:id/chunks?start=0&end=60
GET  /api/scenarios/:id/aircraft/AC-0001/history?start=0&end=1800
GET  /api/scenarios/:id/geometries
```

Ranges use seconds relative to metadata start. Chunk requests are limited to 300 seconds. Aircraft history supports the entire configured duration. The registry retains up to 20 scenario configurations. HTTP pull streaming was chosen because arbitrary historical seeking is central; WebSockets are optional and not implemented.

## Verification and benchmarking

```sh
npm test
npm run test:browser
npm run benchmark
```

Browser scripts use installed Google Chrome (`channel: 'chrome'`). The browser tests start the dev server when absent. Benchmarks require `npm run dev` to be running already. Close unrelated browser workloads and keep the viewport/GPU/power settings fixed. Use `HEADED=1` for a visible benchmark browser; headless and headed results should not be compared directly.

The benchmark runs the five required counts (100/300/500/1,000/2,000), all four strategies, the same camera/seed/geometry/trail settings, direct 15m/5m/27m seeks, and 1×/60× playback. At 300 aircraft it additionally tests 5×/10×/30×, reverse, and inspector open/closed. Results are written after each configuration to `benchmarks/run-*.json`, including errors rather than invented measurements. Override `COUNTS`, `STRATEGIES`, and `DWELL_MS` to narrow or lengthen experiments. Example in PowerShell:

```powershell
$env:COUNTS='300'
$env:DWELL_MS='30000'
npm run benchmark
```

The dashboard exports JSON (configuration, environment, chunk timings, metric history) and CSV (metric time series). It retains at most one hour of once-per-second history and charts only the latest 90 records. Download separate runs for trail implementation comparisons. For reliable production decisions, repeat runs, discard warmup consistently, and test long continuous playback including the final boundary.

Measurements are deliberately labeled:

Displayed memory/size figures labeled MB use 1,048,576 bytes (MiB); exported byte counts remain exact integers.

- FPS and mean frame duration: actual Cesium `postRender` cadence; includes startup and stalls. Minimum is the lowest measured one-second bucket.
- Initialization: elapsed wall time until initial data and the required trail history are fetched/ingested; subsequent geometry construction/upload is excluded. First render: first post-render after initial samples are available; not a GPU timestamp or pixel-visibility measurement.
- Retrieval: worker generation/transfer or HTTP round-trip plus JSON decode. Processing: packet construction, Cesium ingestion and state merging wall duration. Neither is OS CPU utilization.
- Bytes: UTF-8 serialized source records, including chunk overlap; excludes CZML packet expansion and HTTP compression. It is loaded data, not total unrequested history. An export includes the exact planned total sample count.
- Reported JS heap: `performance.memory` only when supported; scope-dependent, sensitive to GC. Packed-position memory is an estimate of 32 bytes per unique loaded position, not total dataset heap.
- Position-available aircraft and shown geometries count entities, not GPU-visible draw calls or frustum intersections.
- Trail timing measures application-side update cost only; internal Cesium path/position work is reflected in frame time, not isolated CPU counters.

Heap values come from the legacy Chromium `performance.memory` API. Its scope is unreliable and can exclude worker heaps or include shared heaps; it is **not total browser or GPU memory**. See [MDN's API limitations](https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory). Treat these values as diagnostic observations, not precise process-memory attribution. Exact source-byte accounting serializes one aircraft at a time; its overhead is included in initialization duration. It avoids the giant temporary JSON string that prevented the first extreme preload experiments from completing.

The trail-hook metric excludes callback work invoked inside Cesium and GPU processing. A near-zero hook time does not mean that trails are free; use the frame-rate comparison as well.

## Known limits and interpretation

CZML processing and JSON packet construction still happen on the main thread and can block the UI on large preloads. History is represented both in raw records and Cesium sampled properties; object overhead and duplicate position/numeric storage can dominate heap. Discrete state intervals are coalesced while preserving transition times. Full trail requests remove the startup advantage of progressive loading. Entity Path can become expensive as history and aircraft count grow. No claim is made that supporting a 2,000-aircraft configuration guarantees acceptable frame rate on a given GPU.

Native sampled positions are an alternative to CZML ingestion, not a fully batched billboard renderer. `PolylineCollection` supplies a batched trail comparison. No GPU memory/OS CPU or per-aircraft internal Cesium position time is fabricated. Docker runtime verification depends on local Docker availability. The included benchmark report states what was actually run and its limits.

## Measured technical summary

See [all measurements and comparison tables](benchmarks/RESULTS.md), including links to raw JSON. The complete five-count/four-strategy matrix was run, followed by 300/2,000-aircraft reruns after fixes. The provider matrix used headless Chrome on Intel HD Graphics 530. The corrected trail-only experiment uses headless Edge because Chrome later stopped launching; its browser identity is recorded separately. These short screening runs are not repeated statistical trials or a 30-minute wall-time soak test.

The final **300-aircraft, 30-minute, one-second** provider measurements used five-minute Entity Path trails:

| Approach | Initial loading | Initial reported JS heap | Mean measured FPS | Mean direct seek |
|---|---:|---:|---:|---:|
| Full CZML | 4.92 s | 421 MB | 5.4 | 119 ms |
| Chunked CZML | 0.63 s | 93 MB | 5.2 | 1,788 ms |
| HTTP streaming | 0.90 s | 108 MB | 5.2 | 3,610 ms |
| Native sampled positions | 2.98 s | 308 MB | 5.9 | 77 ms |

- **Best startup:** chunked CZML in this run. It also had the lowest observed initial heap, but it had loaded only an initial range. This is not a full-dataset memory comparison.
- **Best preload:** native sampled positions loaded faster and had lower reported initial heap than full CZML. Native retains non-position properties only in the common history store; CZML also stores them in Cesium, so this compares architectures rather than only parser speed.
- **Smoothest provider playback:** native had the highest recorded mean, but all four Path-based configurations were slow. The small FPS differences do not establish a reliable rendering winner. Changing the data format alone did not solve rendering cost.
- **Seeking:** preloaded data sought quickly; unloaded progressive ranges incurred seconds of generation/transfer/ingestion. Repeated seeks use the cache, and tests verify that already retrieved chunks are not fetched again. At 2,000 aircraft, HTTP seeks averaged about 34 seconds with a five-minute history window—clearly unsuitable for responsive interaction in this implementation.
- **60× playback:** a browser test played the complete 30-minute, 300-aircraft native scenario through the final timestamp at 60×, with the inspector open. The short provider trials recorded approximately 56–57 simulation seconds per real second at 300 aircraft. Those ratios include last-frame sampling quantization and stalls; they are not a substituted multiplier. Reverse and varied speeds were exercised. Low FPS limits how smoothly a correct clock can be displayed.
- **Inspector synchronization and overhead:** historical state, pause, seek, high-speed playback, and map selection passed browser checks across all providers. The open/closed timing pairs are exported, but their order and short duration confound overhead with GC, prefetch, and warmup. No statistically isolated inspector penalty is claimed.
- **Extreme scale:** all four strategies completed the 2,000-aircraft rerun. Full CZML took 28.39 s and reported 1,841 MB of initial JS heap; native took 20.56 s and reported 1,024 MB. Path-based playback was below 1 FPS. Functional support does not imply acceptable performance.
- **Bottlenecks and fixes:** large object histories, worker transfer, byte serialization, CZML packet processing, duplicate history storage, and path resampling are material costs. Coalesced discrete intervals reduced one earlier 300-aircraft preload from about 17.6 s to about 4.9 s. Bounded byte accounting removed an extreme-size failure. Visual QA also exposed Cesium's automatic clock suspension during static-polyline rebuilding; that was disabled and dynamic polylines now use clock-evaluated properties. The invalid pre-fix trail figures are retained only as diagnostic artifacts, not final results.

**CZML suitability:** CZML works functionally for the target data, incremental merging, replay and arbitrary seeking. These results do not justify a monolithic full-CZML production design at 3.6 million samples on the tested machine. Rendering and cache retention are at least as important as format choice. Static full trajectories and dynamic rolling trajectories have different costs; use the corrected trail table rather than assuming Path or a collection is always faster.

The corrected Edge trail experiment measured **25.0 FPS for a static full Entity Polyline versus 1.3 FPS for full Entity Path**. For a moving five-minute window, the corresponding results were **6.8 and 5.4 FPS**, with PolylineCollection at **6.7 FPS**. The previously higher dynamic-polyline figures were invalid because the clock was being suspended. All corrected cases kept `canAnimate=true` and recorded actual simulation advance alongside FPS. Static future-inclusive trails were the clearest rendering improvement; they do not replace a correctly time-filtered historical trail.

**Production recommendation:** retain the independent metadata-owned clock, historical range API, deterministic tests and common timestamp-based inspector. Evaluate bounded client caches with actual sample eviction, compact typed/binary histories, worker-side preprocessing, native/batched aircraft rendering, and cached/decimated or GPU-time-filtered trails. Use CZML where its declarative geometry and interoperability are valuable. Eliminate duplicate full histories, then repeat long-duration profiling on target hardware with representative data before choosing the final transport and renderer.

Verification completed: TypeScript/production build, seven data tests, six core browser tests in Chrome plus a geometry-inspector browser check in Edge, HTTP metadata/history smoke checks, the five-count provider matrix, main/extreme reruns, and the separate trail experiment. Docker Compose is provided but was not executed because Docker was unavailable here. The build reports a large Cesium JavaScript bundle; delivery-size optimization remains separate from simulation scalability.

To repeat the trail experiment: `npx tsx scripts/trail-benchmark.ts`. Set `BROWSER_CHANNEL=msedge` to use Edge instead of the default installed Chrome. The same environment variable applies to browser tests and the provider benchmark. Generate the combined report with `npx tsx scripts/summarize.ts <earlier-run.json> <later-run.json>`; later records replace matching count/strategy records. Files from interrupted early experiments and `trails-before-clock-fix.json` are diagnostic, not the final comparison.
