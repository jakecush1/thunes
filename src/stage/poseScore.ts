/**
 * Choosing the most characteristic frame of a dance (pure).
 *
 * A clip is sampled at evenly spaced times; for each sample the positions of a
 * few landmark joints are recorded. The winner is the pose that stands out most
 * from the dance's average pose, with a preference for big, open silhouettes
 * that face the viewer.
 */

export interface FrameScoreOptions {
  /** Character height, metres: makes the score independent of size. */
  height: number;
  /** Optional per-frame facing, 1 = toward the viewer … -1 = away. */
  facing?: ArrayLike<number>;
  /** Weight of the silhouette-size term (default 0.5). */
  openness?: number;
}

/**
 * Score every frame. `positions` holds frames × points × 3 numbers (x, y, z per
 * landmark, frame after frame). Higher is more expressive.
 */
export function scoreFrames(positions: ArrayLike<number>, frames: number, points: number, options: FrameScoreOptions): Float64Array {
  const scores = new Float64Array(frames);
  if (frames <= 0 || points <= 0) return scores;
  const h = options.height > 0 ? options.height : 1;
  const openness = options.openness ?? 0.5;
  const mean = new Float64Array(points * 3);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < points * 3; k++) mean[k] = mean[k]! + positions[f * points * 3 + k]! / frames;
  }
  for (let f = 0; f < frames; f++) {
    let deviation = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let p = 0; p < points; p++) {
      const at = (f * points + p) * 3;
      const x = positions[at]!;
      const y = positions[at + 1]!;
      const z = positions[at + 2]!;
      const dx = x - mean[p * 3]!;
      const dy = y - mean[p * 3 + 1]!;
      const dz = z - mean[p * 3 + 2]!;
      deviation += dx * dx + dy * dy + dz * dz;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const spread = Math.sqrt(deviation / points) / h;
    const silhouette = ((maxX - minX) * (maxY - minY)) / (h * h);
    const facing = options.facing ? Math.max(0, Math.min(1, options.facing[f]!)) : 1;
    scores[f] = (spread + openness * silhouette) * (0.4 + 0.6 * facing);
  }
  return scores;
}

/** Index of the most expressive frame (the first one on ties; 0 for an empty input). */
export function pickExpressiveFrame(positions: ArrayLike<number>, frames: number, points: number, options: FrameScoreOptions): number {
  const scores = scoreFrames(positions, frames, points, options);
  let best = 0;
  for (let f = 1; f < frames; f++) if (scores[f]! > scores[best]! + 1e-9) best = f;
  return best;
}
