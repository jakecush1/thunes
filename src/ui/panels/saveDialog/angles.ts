/**
 * Pure helpers for the save dialog: alternative camera angles for the cover
 * choices, and title validation.
 */
import type { CameraPose } from '../../../types';

export const TITLE_MAX = 60;

/** Cover image size and encoding (well under the library's 200 kB limit). */
export const COVER = { width: 400, height: 225, type: 'image/jpeg' as const, quality: 0.8 };

/**
 * Two alternative viewpoints around the same target: a wider three-quarter
 * view from the side and higher up, and a lower, closer front view.
 */
export function alternativeAngles(pose: CameraPose): [CameraPose, CameraPose] {
  const [tx, ty, tz] = pose.target;
  const dx = pose.position[0] - tx;
  const dz = pose.position[2] - tz;
  const flat = Math.hypot(dx, dz);
  const radius = Math.max(3, Math.hypot(flat, pose.position[1] - ty));
  const azimuth = flat > 1e-6 ? Math.atan2(dx, dz) : 0;
  const at = (angle: number, distance: number, height: number): CameraPose => ({
    position: [round(tx + Math.sin(angle) * distance), round(Math.max(0.3, height)), round(tz + Math.cos(angle) * distance)],
    target: [tx, ty, tz],
  });
  const side = azimuth + (azimuth > 0 ? -1 : 1) * (Math.PI / 4);
  return [at(side, radius * 0.95, ty + radius * 0.4), at(azimuth * 0.15, radius * 0.6, ty + 0.1)];
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Trimmed, whitespace-collapsed title, or an error to show. */
export function validateTitle(raw: string): { ok: true; title: string } | { ok: false; error: string } {
  const title = raw.replace(/\s+/g, ' ').trim();
  if (title.length === 0) return { ok: false, error: 'Give the scene a name.' };
  if (title.length > TITLE_MAX) return { ok: false, error: `Keep the name to ${TITLE_MAX} characters or fewer.` };
  return { ok: true, title };
}
