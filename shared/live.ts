export const LIVE_INTERVAL = 100;
export const LIVE_MAX = 2000;
export interface LiveFrame {
  seconds: number;
  step: number;
  // Packed lon, lat, altitude for the current and next server samples.
  positions: number[];
  next: number[];
}
export function liveOptions(count: number, speed: number, seconds: number) {
  if (!Number.isInteger(count) || count < 1 || count > LIVE_MAX)
    throw new Error(`Aircraft count must be an integer from 1 to ${LIVE_MAX}.`);
  if (![1, 2, 5, 10].includes(speed)) throw new Error("Invalid speed.");
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1e9)
    throw new Error("Invalid start time.");
  return { count, speed, seconds };
}
export function livePositions(count: number, seconds: number): number[] {
  const positions = new Array<number>(count * 3);
  for (let i = 0; i < count; i++) {
    const radius = 0.5 + (i % 73) / 18;
    // Match the historical scenario's jet speeds (170–260 m/s), independent
    // of orbit radius. Previously the innermost aircraft moved at walking speed.
    const angularSpeed = (170 + (i % 19) * 5) / (radius * 111320);
    const phase = i * 2.3999632297 + seconds * angularSpeed;
    positions[i * 3] = 30.5 + radius * Math.cos(phase) * 1.4;
    positions[i * 3 + 1] = 35 + radius * Math.sin(phase);
    positions[i * 3 + 2] = 6000 + (i % 40) * 150;
  }
  return positions;
}
