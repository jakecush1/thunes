/**
 * Quality levels: how many pixels are rendered and how shadows are drawn.
 */
import type { Quality } from '../types';

export interface QualitySettings {
  /** Device pixels rendered per CSS pixel. */
  pixelRatio: number;
  /** Whether the key light casts shadows. */
  shadows: boolean;
  /** Shadow map edge length in texels (0 when shadows are off). */
  shadowMapSize: number;
}

const LEVELS: Record<Quality, { maxPixelRatio: number; shadowMapSize: number }> = {
  low: { maxPixelRatio: 1, shadowMapSize: 0 },
  medium: { maxPixelRatio: 1.5, shadowMapSize: 2048 },
  high: { maxPixelRatio: 2, shadowMapSize: 4096 },
};

/**
 * Resolve a quality level for a display.
 * low: pixel ratio 1, no shadows. medium: pixel ratio up to 1.5, 2048² shadow map.
 * high: pixel ratio up to 2, 4096² shadow map. Unknown levels behave like 'medium'.
 * @param devicePixelRatio window.devicePixelRatio (values below 1 or non-finite count as 1)
 */
export function qualitySettings(quality: Quality, devicePixelRatio: number): QualitySettings {
  const level = LEVELS[quality] ?? LEVELS.medium;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio >= 1 ? devicePixelRatio : 1;
  return {
    pixelRatio: quality === 'low' ? 1 : Math.min(dpr, level.maxPixelRatio),
    shadows: level.shadowMapSize > 0,
    shadowMapSize: level.shadowMapSize,
  };
}

/**
 * Drawing-buffer size for a container, never zero and never beyond `maxSize` per edge
 * (the pixel ratio is lowered instead, keeping the aspect ratio).
 */
export function bufferSize(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
  maxSize = 8192,
): { width: number; height: number; pixelRatio: number } {
  const w = Math.max(1, Math.floor(cssWidth));
  const h = Math.max(1, Math.floor(cssHeight));
  const ratio = Math.min(pixelRatio, maxSize / w, maxSize / h);
  return { width: w, height: h, pixelRatio: ratio };
}
