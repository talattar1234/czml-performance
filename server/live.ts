import type { Express } from "express";
import { LIVE_INTERVAL, liveOptions, livePositions, type LiveFrame } from "../shared/live";

export function installLiveStream(app: Express) {
  app.get("/api/live", (req, res) => {
    let options;
    try {
      options = liveOptions(Number(req.query.count), Number(req.query.speed), Number(req.query.seconds ?? 0));
    } catch (error) {
      res.status(400).json({ error: String(error) });
      return;
    }
    const { count, speed, seconds } = options;
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const started = performance.now();
    let blocked = false;
    const send = () => {
      if (blocked || res.destroyed) return;
      const t = seconds + (performance.now() - started) * speed / 1000;
      const step = LIVE_INTERVAL * speed / 1000;
      const frame: LiveFrame = { seconds: t, step, positions: livePositions(count, t), next: livePositions(count, t + step) };
      blocked = !res.write(`data: ${JSON.stringify(frame)}\n\n`);
    };
    res.on("drain", () => { blocked = false; });
    send();
    const timer = setInterval(send, LIVE_INTERVAL);
    res.on("close", () => clearInterval(timer));
  });
}
