import express from "express";
import { installLiveStream } from "./live";
import {
  defaults,
  validateConfig,
  metadata,
  generateChunk,
  geometrySpecs,
  aircraft,
  sample,
  samplesPerAircraft,
  type Config,
} from "../shared/scenario";
const app = express();
app.use(express.json({ limit: "32kb" }));
installLiveStream(app);
const scenarios = new Map<string, Config>();
scenarios.set(metadata(defaults).id, defaults);
app.get("/api/scenarios", (_req, res) =>
  res.json([...scenarios.values()].map(metadata)),
);
app.post("/api/scenarios", (req, res) => {
  try {
    const c = validateConfig(req.body);
    const id = metadata(c).id + `-${c.radars}-${c.polygons}-${c.geometries}`;
    if (scenarios.size >= 20) scenarios.delete(scenarios.keys().next().value!);
    scenarios.set(id, c);
    res.json({ ...metadata(c), id });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});
app.get("/api/scenarios/:id/:resource", (req, res) => {
  const c = scenarios.get(req.params.id);
  if (!c) {
    res.status(404).json({ error: "Unknown scenario" });
    return;
  }
  switch (req.params.resource) {
    case "metadata":
      res.json({ ...metadata(c), id: req.params.id });
      break;
    case "geometries":
      res.json(geometrySpecs(c));
      break;
    case "chunks": {
      const start = Number(req.query.start ?? 0),
        end = Number(req.query.end ?? c.chunk);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < start ||
        end > c.minutes * 60 ||
        end - start > 300
      ) {
        res
          .status(400)
          .json({
            error: "Range must be within scenario and at most 300 seconds",
          });
        return;
      }
      res.json(generateChunk(c, start, end));
      break;
    }
    default:
      res.sendStatus(404);
  }
});
app.get("/api/scenarios/:id/aircraft/:aircraftId/history", (req, res) => {
  const c = scenarios.get(req.params.id);
  if (!c) {
    res.sendStatus(404);
    return;
  }
  const index = Number(req.params.aircraftId.replace("AC-", "")) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= c.aircraft) {
    res.sendStatus(404);
    return;
  }
  const start = Number(req.query.start ?? 0),
    end = Number(req.query.end ?? c.minutes * 60);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    end > c.minutes * 60
  ) {
    res.sendStatus(400);
    return;
  }
  const a = aircraft(c, index);
  const samples = [];
  for (
    let t = Math.floor(start / c.step) * c.step;
    t <=
    Math.min(
      (samplesPerAircraft(c) - 1) * c.step,
      Math.ceil(end / c.step) * c.step,
    );
    t += c.step
  )
    samples.push(sample(a, t));
  res.json({ aircraft: a, samples });
});
app.listen(3001, "0.0.0.0", () =>
  console.log("Historical data API: http://127.0.0.1:3001"),
);
