# Measured benchmark observations

Sources: [run-2026-11-01T07-55-53-750Z.json](run-2026-11-01T07-55-53-750Z.json), [run-2026-11-01T08-13-07-842Z.json](run-2026-11-01T08-13-07-842Z.json). Later files replace earlier results for the same count/strategy. These are short local Chrome headless screening runs, not sustained workstation or production capacity tests. Each configuration uses seed 42, 30 minutes, 1-second samples, 5-minute Entity Path trails, and a 1440×1000 viewport. The dwell target was 2.5 seconds per playback segment; actual durations are recorded. Reported JS heap is GC-sensitive and includes framework/raw history/Cesium; initialization heap is measured before far seeks. Runs are sequential, one fresh page per configuration. All timing values below come from the stored measurements.

GPU reported by Chrome: **ANGLE (Intel, Intel(R) HD Graphics 530 (0x00001912) Direct3D11 vs_5_0 ps_5_0, D3D11)**.

The 300/2,000-aircraft cases were rerun after bounded byte accounting and removal of unchanged trail-setting assignments. The 100/500/1,000 cases are from the earlier complete matrix. Compare strategies within each count; these are development experiments, not a single-version certified scaling curve. Earlier 2,000-aircraft preload failures remain in the original JSON and were superseded by the rerun.

| Aircraft | Strategy | Initial ms | Initial heap MB | Mean seek ms | Mean sampled FPS¹ | 60× achieved rate² |
|---:|---|---:|---:|---:|---:|---:|
| 100 | full | 1662 | 143.0 | 39.0 | 11.8 | 58.5× |
| 100 | chunked | 419 | 87.2 | 651.2 | 12.4 | 58.1× |
| 100 | streaming | 739 | 80.6 | 1418.9 | 13.8 | 57.9× |
| 100 | native | 1702 | 204.5 | 49.1 | 11.4 | 57.8× |
| 300 | full | 4922 | 421.2 | 118.7 | 5.4 | 56.7× |
| 300 | chunked | 625 | 93.1 | 1788.3 | 5.2 | 56.0× |
| 300 | streaming | 900 | 107.8 | 3610.0 | 5.2 | 56.3× |
| 300 | native | 2981 | 308.2 | 76.8 | 5.9 | 56.7× |
| 500 | full | 7021 | 848.1 | 219.2 | 3.1 | 53.9× |
| 500 | chunked | 904 | 127.3 | 2899.4 | 3.1 | 53.7× |
| 500 | streaming | 1258 | 146.0 | 6752.7 | 2.8 | 54.8× |
| 500 | native | 5768 | 649.8 | 151.0 | 2.5 | 52.4× |
| 1000 | full | 14863 | 905.1 | 228.2 | 1.3 | 50.3× |
| 1000 | chunked | 1317 | 206.8 | 5161.2 | 1.3 | 51.6× |
| 1000 | streaming | 1763 | 137.3 | 14220.3 | 1.4 | 51.3× |
| 1000 | native | 11515 | 1244.9 | 222.9 | 1.7 | 50.0× |
| 2000 | full | 28390 | 1840.9 | 561.6 | 0.8 | 46.8× |
| 2000 | chunked | 2515 | 257.9 | 10257.8 | 0.6 | 38.4× |
| 2000 | streaming | 2943 | 275.7 | 34051.4 | 0.7 | 43.7× |
| 2000 | native | 20562 | 1024.2 | 450.5 | 0.8 | 44.7× |

¹ Arithmetic mean of recorded approximately one-second FPS buckets during playback segments. Startup/loading contamination and short segments limit comparisons. ² Simulation seconds advanced divided by real elapsed seconds; buffering and render stalls reduce achieved throughput even though the configured multiplier is 60. A value below 60 is a limitation, not a substituted clock multiplier.

## Main scenario: inspector and playback

| Strategy | Speed | Inspector | FPS buckets mean | Actual rate |
|---|---:|---|---:|---:|
| full | 1× | Closed | 4.4 | 0.9× |
| full | 1× | Open | 5.1 | 0.9× |
| full | 5× | Closed | 5.0 | 4.7× |
| full | 5× | Open | 5.1 | 4.7× |
| full | 10× | Closed | 5.4 | 9.4× |
| full | 10× | Open | 5.7 | 9.4× |
| full | 30× | Closed | 5.9 | 28.0× |
| full | 30× | Open | 5.4 | 28.1× |
| full | 60× | Closed | 5.4 | 56.7× |
| full | 60× | Open | 5.5 | 56.7× |
| full | -60× | Closed | 5.3 | -56.9× |
| full | -60× | Open | 6.1 | -55.2× |
| chunked | 1× | Closed | 4.7 | 0.9× |
| chunked | 1× | Open | 5.5 | 0.9× |
| chunked | 5× | Closed | 4.8 | 4.7× |
| chunked | 5× | Open | 5.0 | 4.7× |
| chunked | 10× | Closed | 5.1 | 9.4× |
| chunked | 10× | Open | 5.5 | 9.4× |
| chunked | 30× | Closed | 5.6 | 28.3× |
| chunked | 30× | Open | 5.5 | 27.9× |
| chunked | 60× | Closed | 4.5 | 56.0× |
| chunked | 60× | Open | 5.0 | 56.3× |
| chunked | -60× | Closed | 5.5 | -56.8× |
| chunked | -60× | Open | 6.2 | -55.8× |
| streaming | 1× | Closed | 4.8 | 0.9× |
| streaming | 1× | Open | 4.9 | 0.9× |
| streaming | 5× | Closed | 5.4 | 4.7× |
| streaming | 5× | Open | 6.0 | 4.7× |
| streaming | 10× | Closed | 4.8 | 9.4× |
| streaming | 10× | Open | 5.5 | 9.5× |
| streaming | 30× | Closed | 5.5 | 28.3× |
| streaming | 30× | Open | 4.4 | 28.3× |
| streaming | 60× | Closed | 5.9 | 56.3× |
| streaming | 60× | Open | 4.7 | 54.3× |
| streaming | -60× | Closed | 4.6 | -56.4× |
| streaming | -60× | Open | 5.2 | -55.9× |
| native | 1× | Closed | 5.3 | 0.9× |
| native | 1× | Open | 5.8 | 0.9× |
| native | 5× | Closed | 5.6 | 4.7× |
| native | 5× | Open | 6.3 | 4.7× |
| native | 10× | Closed | 6.4 | 9.4× |
| native | 10× | Open | 6.2 | 9.4× |
| native | 30× | Closed | 5.9 | 28.3× |
| native | 30× | Open | 5.9 | 28.2× |
| native | 60× | Closed | 5.7 | 56.7× |
| native | 60× | Open | 6.4 | 57.0× |
| native | -60× | Closed | 6.0 | -56.5× |
| native | -60× | Open | 5.0 | -55.9× |

Inspector-open and inspector-closed segments run consecutively, not as randomized repeated trials. Their differences cannot isolate inspector overhead from buffering, garbage collection, or JIT warmup. Functional browser tests independently check historical state after arbitrary seeks, paused values, forward 60× and reverse playback for all four providers.

## Trail comparison

[Raw trail measurements](trails.json). Fixed 300-aircraft native provider, 30 minutes, seed 42; seek to minute 15, allow two seconds of upload/shader warmup, then measure five seconds at 10×. Full mode includes all 30 minutes, history includes the reached prefix, window uses five minutes. The sampled trail-hook time excludes callbacks invoked inside Cesium and internal/GPU work. Clock progression is recorded alongside FPS to expose unwanted clock stalls. Earlier results in `trails-before-clock-fix.json` are diagnostic only: asynchronous Entity Polyline rebuilding silently suspended the clock and invalidated that comparison.

| Renderer | Mode | Initial ms | Mean FPS | Sampled hook ms | Actual rate |
|---|---|---:|---:|---:|---:|
| path | full | 3441 | 1.3 | 0.000 | 9.2× |
| path | history | 2840 | 1.6 | 0.000 | 9.0× |
| path | window | 3299 | 5.4 | 0.000 | 9.8× |
| polyline | full | 2995 | 25.0 | 0.000 | 9.8× |
| polyline | history | 3458 | 1.8 | 0.000 | 9.1× |
| polyline | window | 3064 | 6.8 | 0.000 | 9.7× |
| collection | full | 3125 | 11.6 | 0.000 | 9.9× |
| collection | history | 3306 | 1.7 | 102.300 | 9.0× |
| collection | window | 3513 | 6.7 | 39.660 | 9.9× |

Trail browser: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0. Each corrected trail case uses a fresh Edge process; the provider matrix used Chrome. Compare renderer variants within the trail experiment, not absolute FPS across browsers. The actual-rate ratios also have last-frame quantization error, especially at low FPS and short dwell times.
