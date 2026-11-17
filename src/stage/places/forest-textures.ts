/**
 * Forest textures: the photographic ground, bark and rock maps, and the
 * foliage atlas, which is composed at load time from photographed leaves
 * (CC0, ambientCG; see assets/forest/CREDITS.txt) into branch, bough, frond
 * and whole-tree cards.
 */
import * as THREE from 'three';
import { mulberry32 } from './shared';
import barkBroadleafColorUrl from './assets/forest/bark_broadleaf_color.jpg';
import barkBroadleafNormalUrl from './assets/forest/bark_broadleaf_normal.jpg';
import barkConiferColorUrl from './assets/forest/bark_conifer_color.jpg';
import barkConiferNormalUrl from './assets/forest/bark_conifer_normal.jpg';
import floorColorUrl from './assets/forest/floor_color.jpg';
import floorNormalUrl from './assets/forest/floor_normal.jpg';
import grassColorUrl from './assets/forest/grass_color.jpg';
import grassNormalUrl from './assets/forest/grass_normal.jpg';
import leafletsColorUrl from './assets/forest/leaflets_color.jpg';
import leafletsOpacityUrl from './assets/forest/leaflets_opacity.jpg';
import beechColorUrl from './assets/forest/leaves_beech_color.jpg';
import beechOpacityUrl from './assets/forest/leaves_beech_opacity.jpg';
import hazelColorUrl from './assets/forest/leaves_hazel_color.jpg';
import hazelOpacityUrl from './assets/forest/leaves_hazel_opacity.jpg';
import needlesColorUrl from './assets/forest/needles_color.jpg';
import needlesOpacityUrl from './assets/forest/needles_opacity.jpg';
import rockColorUrl from './assets/forest/rock_color.jpg';
import rockNormalUrl from './assets/forest/rock_normal.jpg';

type Rng = () => number;
type Rect = readonly [x: number, y: number, w: number, h: number];
type Ctx = CanvasRenderingContext2D;

/** Where the photographed leaves sit in their sheets (pixels). */
const BEECH: readonly Rect[] = [
  [24, 3, 125, 165],
  [200, 2, 112, 163],
  [368, 4, 118, 162],
  [27, 176, 116, 159],
  [368, 174, 115, 165],
  [199, 181, 116, 157],
  [26, 346, 116, 160],
  [196, 345, 119, 162],
];
const HAZEL: readonly Rect[] = [
  [30, 28, 101, 228],
  [198, 15, 119, 223],
  [374, 26, 107, 208],
  [32, 278, 121, 213],
  [208, 271, 117, 222],
  [371, 274, 107, 220],
];
/** Conifer sprays lie on their side: the stem is at the right end. */
const NEEDLES: readonly Rect[] = [
  [219, 50, 328, 158],
  [60, 243, 630, 225],
  [32, 493, 683, 255],
];
const LEAFLETS: readonly Rect[] = [
  [96, 43, 38, 161],
  [169, 27, 43, 192],
  [256, 38, 45, 183],
  [352, 30, 44, 184],
];

/** A rectangle of the foliage atlas. The plant grows from `vBase` (stem) to `vTip`. */
export interface AtlasCell {
  u0: number;
  u1: number;
  vBase: number;
  vTip: number;
}

export interface ForestAtlas {
  texture: THREE.DataTexture;
  /** Leafy broadleaf branches, about 1.7 m long. */
  sprays: AtlasCell[];
  /** Larger-leaved shrub branches. */
  shrubs: AtlasCell[];
  /** Dense masses of foliage for mid-distance crowns. */
  masses: AtlasCell[];
  /** Conifer boughs. */
  boughs: AtlasCell[];
  /** Fern fronds. */
  fronds: AtlasCell[];
  /** Whole distant trees. */
  farBroadleaf: AtlasCell[];
  farConifer: AtlasCell[];
  /** Opaque strips of bark for distant trunks: broadleaf, conifer. */
  bark: AtlasCell[];
}

export interface ForestTextures {
  grassColor: THREE.Texture;
  grassNormal: THREE.Texture;
  floorColor: THREE.Texture;
  floorNormal: THREE.Texture;
  barkBroadleafColor: THREE.Texture;
  barkBroadleafNormal: THREE.Texture;
  barkConiferColor: THREE.Texture;
  barkConiferNormal: THREE.Texture;
  rockColor: THREE.Texture;
  rockNormal: THREE.Texture;
  atlas: ForestAtlas;
  /** Every texture above, for disposal. */
  all: THREE.Texture[];
}

const ATLAS_SIZE = 2048;

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('The forest needs a 2D canvas to build its foliage.');
  return { canvas, ctx };
}

/** A photographed sheet of leaves with its opacity mask applied, plus a shaded and a sunlit copy. */
interface Sheet {
  lit: HTMLCanvasElement;
  dark: HTMLCanvasElement;
  bright: HTMLCanvasElement;
  sprites: readonly Rect[];
}

function tintedCopy(source: HTMLCanvasElement, fill: string): HTMLCanvasElement {
  const { canvas, ctx } = canvasOf(source.width, source.height);
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

function makeSheet(color: HTMLImageElement, opacity: HTMLImageElement, sprites: readonly Rect[], tint: string | null, dark: string, bright: string): Sheet {
  const width = color.naturalWidth;
  const height = color.naturalHeight;
  const { canvas, ctx } = canvasOf(width, height);
  ctx.drawImage(opacity, 0, 0, width, height);
  const mask = ctx.getImageData(0, 0, width, height).data;
  ctx.drawImage(color, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < width * height; i++) image.data[i * 4 + 3] = mask[i * 4]!;
  ctx.putImageData(image, 0, 0);
  const lit = tint ? tintedCopy(canvas, tint) : canvas;
  return { lit, dark: tintedCopy(lit, dark), bright: tintedCopy(lit, bright), sprites };
}

/** Draws an upright sprite (stem at the bottom) with its stem at (x, y), growing along `angle` (0 = up the canvas). */
function drawLeaf(ctx: Ctx, sheet: HTMLCanvasElement, rect: Rect, x: number, y: number, angle: number, length: number, flip: boolean): void {
  const scale = length / rect[3];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(flip ? -scale : scale, scale);
  ctx.drawImage(sheet, rect[0], rect[1], rect[2], rect[3], -rect[2] / 2, -rect[3], rect[2], rect[3]);
  ctx.restore();
}

/** Draws a conifer spray (stem at the right end of the sprite) from (x, y) along `angle` (0 = up the canvas). */
function drawSprig(ctx: Ctx, sheet: HTMLCanvasElement, rect: Rect, x: number, y: number, angle: number, length: number, flip: boolean): void {
  const scale = length / rect[2];
  ctx.save();
  ctx.translate(x, y);
  // The sprite grows toward -x; turn that to "up", then by `angle`.
  ctx.rotate(angle + Math.PI / 2);
  ctx.scale(scale, flip ? -scale : scale);
  ctx.drawImage(sheet, rect[0], rect[1], rect[2], rect[3], -rect[2], -rect[3] / 2, rect[2], rect[3]);
  ctx.restore();
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length) % items.length]!;
}

interface LeafSpot {
  x: number;
  y: number;
  angle: number;
  length: number;
}

interface Twig {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
}

/**
 * Grows a branch: a stem from (x, y) along `angle`, side twigs and leaves.
 * Coordinates are canvas pixels; angle 0 points up the canvas.
 */
function growBranch(
  rng: Rng,
  x: number,
  y: number,
  angle: number,
  length: number,
  depth: number,
  leaf: number,
  twigs: Twig[],
  leaves: LeafSpot[],
): void {
  const steps = Math.max(3, Math.round(length / (leaf * 0.5)));
  const step = length / steps;
  let px = x;
  let py = y;
  let heading = angle;
  const bare = depth === 0 ? 0.16 : 0.08;
  for (let i = 0; i < steps; i++) {
    const f = i / steps;
    heading += (rng() - 0.5) * 0.2;
    const nx = px + Math.sin(heading) * step;
    const ny = py - Math.cos(heading) * step;
    twigs.push({ x0: px, y0: py, x1: nx, y1: ny, width: (depth === 0 ? 3.6 : depth === 1 ? 2.2 : 1.4) * (1 - f * 0.7) });
    px = nx;
    py = ny;
    if (f < bare) continue;
    const side = i % 2 === 0 ? 1 : -1;
    // Side twigs carry most of the leaves.
    if (depth < 2 && f < 0.84 && (depth === 0 || i % 2 === 1)) {
      const reach = length * (depth === 0 ? 0.58 : 0.42) * (1 - f * 0.7) * (0.75 + rng() * 0.5);
      if (reach > leaf * 1.3) growBranch(rng, px, py, heading + side * (0.7 + rng() * 0.5), reach, depth + 1, leaf, twigs, leaves);
    }
    if (depth === 0 && f < 0.5) continue;
    leaves.push({ x: px, y: py, angle: heading + side * (0.8 + rng() * 0.6), length: leaf * (0.75 + rng() * 0.5) });
    if (rng() < 0.3) leaves.push({ x: px, y: py, angle: heading - side * (0.7 + rng() * 0.7), length: leaf * (0.65 + rng() * 0.45) });
  }
  leaves.push({ x: px, y: py, angle: heading + (rng() - 0.5) * 0.5, length: leaf * (0.85 + rng() * 0.4) });
}

/** A leafy branch that fans out from the bottom centre of the cell. */
function drawSpray(ctx: Ctx, sheet: Sheet, w: number, h: number, rng: Rng, leaf: number): void {
  const twigs: Twig[] = [];
  const leaves: LeafSpot[] = [];
  growBranch(rng, w / 2, h - 4, (rng() - 0.5) * 0.1, h * 0.84, 0, leaf, twigs, leaves);
  // Two lower limbs fill the flanks of the fan.
  growBranch(rng, w / 2, h - 34, -0.72 - rng() * 0.2, h * 0.56, 1, leaf, twigs, leaves);
  growBranch(rng, w / 2, h - 52, 0.72 + rng() * 0.2, h * 0.56, 1, leaf, twigs, leaves);
  const margin = leaf * 0.55;
  const inside = (l: LeafSpot) => {
    const tx = l.x + Math.sin(l.angle) * l.length;
    const ty = l.y - Math.cos(l.angle) * l.length;
    return Math.min(l.x, tx) > margin && Math.max(l.x, tx) < w - margin && Math.min(l.y, ty) > margin && Math.max(l.y, ty) < h - 2;
  };
  const kept = leaves.filter(inside);
  // Shaded leaves behind, twigs, then the lit leaves.
  for (const l of kept) {
    if (rng() < 0.5) drawLeaf(ctx, sheet.dark, pick(sheet.sprites, rng), l.x + (rng() - 0.5) * leaf * 0.8, l.y + (rng() - 0.5) * leaf * 0.8, l.angle + (rng() - 0.5) * 1.6, l.length, rng() < 0.5);
  }
  ctx.lineCap = 'round';
  for (const t of twigs) {
    if (t.x1 < 4 || t.x1 > w - 4 || t.y1 < 4) continue;
    ctx.strokeStyle = t.width > 2.4 ? '#4a3a26' : '#55452c';
    ctx.lineWidth = t.width;
    ctx.beginPath();
    ctx.moveTo(t.x0, t.y0);
    ctx.lineTo(t.x1, t.y1);
    ctx.stroke();
  }
  for (const l of kept) {
    const roll = rng();
    const sprite = pick(sheet.sprites, rng);
    drawLeaf(ctx, roll < 0.12 ? sheet.dark : roll > 0.7 ? sheet.bright : sheet.lit, sprite, l.x, l.y, l.angle, l.length, rng() < 0.5);
  }
}

/** A dense, irregular mass of foliage made of small copies of the sprays. */
function drawMass(ctx: Ctx, sprays: HTMLCanvasElement[], dark: HTMLCanvasElement[], w: number, h: number, rng: Rng): void {
  const cx = w / 2;
  const cy = h * 0.5;
  const size = w * 0.42;
  const stamp = (source: HTMLCanvasElement, radius: number) => {
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r * 0.92;
    ctx.save();
    ctx.translate(x, y);
    // Sprays point away from the middle of the mass.
    ctx.rotate(Math.atan2(x - cx, -(y - cy)) + (rng() - 0.5) * 1.4);
    const s = size * (0.8 + rng() * 0.45);
    ctx.drawImage(source, -s / 2, -s * 0.72, s, s);
    ctx.restore();
  };
  for (let i = 0; i < 22; i++) stamp(pick(dark, rng), w * 0.2);
  for (let i = 0; i < 26; i++) stamp(pick(sprays, rng), w * 0.25);
}

/** A conifer bough seen from above: a twig with sprays angled forward on both sides. */
function drawBough(ctx: Ctx, sheet: Sheet, w: number, h: number, rng: Rng): void {
  const cx = w / 2;
  const base = h - 4;
  const top = 26;
  const sway = (rng() - 0.5) * 0.1;
  const spineX = (f: number) => cx + Math.sin(f * 2.2) * sway * w;
  const place = (canvas: HTMLCanvasElement, jitter: number) => {
    const count = 15;
    for (let i = 0; i < count; i++) {
      const f = (i + rng() * 0.6) / count;
      const y = base - f * (base - top);
      const reach = (w * 0.56) * (1 - f * 0.68) * (0.85 + rng() * 0.3);
      for (const side of [-1, 1]) {
        drawSprig(ctx, canvas, pick(sheet.sprites, rng), spineX(f) + (rng() - 0.5) * jitter, y + (rng() - 0.5) * jitter, side * (0.78 + rng() * 0.3), reach, rng() < 0.5);
      }
    }
  };
  place(sheet.dark, 14);
  ctx.strokeStyle = '#3d2f1f';
  ctx.lineCap = 'round';
  for (let i = 0; i < 20; i++) {
    const f0 = i / 20;
    const f1 = (i + 1) / 20;
    ctx.lineWidth = 5 * (1 - f0 * 0.75);
    ctx.beginPath();
    ctx.moveTo(spineX(f0), base - f0 * (base - top));
    ctx.lineTo(spineX(f1), base - f1 * (base - top));
    ctx.stroke();
  }
  place(sheet.lit, 5);
  // The leading shoot.
  drawSprig(ctx, sheet.bright, sheet.sprites[0]!, spineX(1), top + 40, (rng() - 0.5) * 0.2, 64, false);
  // Paler new growth at the ends.
  for (let i = 0; i < 9; i++) {
    const f = 0.15 + rng() * 0.8;
    const side = rng() < 0.5 ? -1 : 1;
    const y = base - f * (base - top);
    drawSprig(ctx, sheet.bright, sheet.sprites[0]!, spineX(f) + side * w * 0.18 * (1 - f * 0.6), y - 10, side * (0.7 + rng() * 0.3), w * 0.24 * (1 - f * 0.5), rng() < 0.5);
  }
}

/** A fern frond: narrow leaflets in pairs along an arching stalk. */
function drawFrond(ctx: Ctx, sheet: Sheet, w: number, h: number, rng: Rng): void {
  const cx = w / 2;
  const base = h - 3;
  const top = 8;
  const lean = (rng() - 0.5) * 0.14;
  const spineX = (f: number) => cx + Math.sin(f * 1.9) * lean * w;
  const pairs = 46;
  const draw = (canvas: HTMLCanvasElement, offset: number) => {
    for (let i = 0; i < pairs; i++) {
      const f = 0.1 + (i / pairs) * 0.9;
      const y = base - f * (base - top);
      // Longest a third of the way up, tapering to the tip.
      const profile = Math.min(1, (f - 0.06) / 0.2) * Math.pow(1 - f, 0.62);
      const length = 6 + w * 0.5 * profile * (0.9 + rng() * 0.2);
      const droop = 1.25 - f * 0.45;
      for (const side of [-1, 1]) {
        drawLeaf(ctx, canvas, pick(sheet.sprites, rng), spineX(f) + offset, y + offset + (side > 0 ? 3 : 0), side * (droop + (rng() - 0.5) * 0.16), length, rng() < 0.5);
      }
    }
  };
  draw(sheet.dark, 2.5);
  ctx.strokeStyle = '#5a6b2a';
  ctx.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    const f0 = i / 16;
    const f1 = (i + 1) / 16;
    ctx.lineWidth = 3.2 * (1 - f0 * 0.75);
    ctx.beginPath();
    ctx.moveTo(spineX(f0), base - f0 * (base - top));
    ctx.lineTo(spineX(f1), base - f1 * (base - top));
    ctx.stroke();
  }
  draw(sheet.lit, 0);
}

/** A whole broadleaf tree for the distance: trunk, limbs and a crown of tiny sprays. */
function drawFarBroadleaf(ctx: Ctx, sprays: HTMLCanvasElement[], dark: HTMLCanvasElement[], bright: HTMLCanvasElement[], bark: HTMLImageElement, w: number, h: number, rng: Rng): void {
  const cx = w / 2;
  // Trunk and limbs.
  ctx.save();
  const trunkTop = h * 0.36;
  ctx.beginPath();
  ctx.moveTo(cx - 13, h);
  ctx.lineTo(cx - 6, trunkTop);
  ctx.lineTo(cx + 6, trunkTop);
  ctx.lineTo(cx + 13, h);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(bark, cx - 16, trunkTop, 32, h - trunkTop);
  ctx.fillStyle = 'rgba(20, 22, 14, 0.38)';
  ctx.fillRect(cx - 16, trunkTop, 32, h - trunkTop);
  ctx.restore();
  ctx.strokeStyle = '#4b4334';
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y0 = h * (0.72 - i * 0.055);
    ctx.lineWidth = 5 - i * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, y0);
    ctx.quadraticCurveTo(cx + side * w * 0.14, y0 - h * 0.1, cx + side * w * (0.22 + rng() * 0.12), y0 - h * (0.16 + rng() * 0.1));
    ctx.stroke();
  }
  // Crown: overlapping clumps of foliage, each shaded underneath and sunlit on top.
  const clumps: { x: number; y: number; rx: number; ry: number }[] = [{ x: cx + (rng() - 0.5) * w * 0.06, y: h * 0.3, rx: w * 0.27, ry: h * 0.22 }];
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + rng() * 0.6;
    const reach = 0.2 + rng() * 0.09;
    clumps.push({
      x: cx + Math.cos(angle) * w * reach * 1.15,
      y: h * 0.36 + Math.sin(angle) * h * reach * (Math.sin(angle) > 0 ? 0.75 : 1),
      rx: w * (0.13 + rng() * 0.07),
      ry: h * (0.1 + rng() * 0.06),
    });
  }
  // Lower clumps first, so the upper ones overlap them.
  clumps.sort((p, q) => q.y - p.y);
  const stamp = (sources: HTMLCanvasElement[], clump: { x: number; y: number; rx: number; ry: number }, count: number, top: number, bottom: number) => {
    for (let placed = 0, attempt = 0; placed < count && attempt < count * 8; attempt++) {
      const angle = rng() * Math.PI * 2;
      const r = Math.sqrt(rng());
      const x = clump.x + Math.cos(angle) * r * clump.rx;
      const y = clump.y + Math.sin(angle) * r * clump.ry;
      const t = (y - (clump.y - clump.ry)) / (2 * clump.ry);
      if (t < top || t > bottom) continue;
      placed++;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(x - clump.x, -(y - clump.y - clump.ry * 0.5)) + (rng() - 0.5) * 1.2);
      const s = w * (0.1 + rng() * 0.05);
      ctx.drawImage(pick(sources, rng), -s / 2, -s * 0.7, s, s);
      ctx.restore();
    }
  };
  for (const clump of clumps) {
    const amount = (clump.rx * clump.ry) / (w * h * 0.02);
    stamp(dark, clump, Math.round(26 * amount), 0, 1);
    stamp(sprays, clump, Math.round(26 * amount), 0, 0.78);
    stamp(bright, clump, Math.round(10 * amount), 0, 0.4);
  }
}

/** A whole conifer for the distance: tiers of drooping boughs around a straight trunk. */
function drawFarConifer(ctx: Ctx, sheet: Sheet, w: number, h: number, rng: Rng): void {
  const cx = w / 2;
  const top = 6;
  const bottom = h * 0.9;
  ctx.fillStyle = '#3a3023';
  ctx.beginPath();
  ctx.moveTo(cx - 1, top + 20);
  ctx.lineTo(cx + 1, top + 20);
  ctx.lineTo(cx + 6, h);
  ctx.lineTo(cx - 6, h);
  ctx.closePath();
  ctx.fill();
  const tiers = 34;
  const layer = (canvas: HTMLCanvasElement, jitter: number, scale: number) => {
    for (let i = 0; i < tiers; i++) {
      const f = (i + rng() * 0.5) / tiers;
      const y = top + 14 + f * (bottom - top - 14);
      const reach = (10 + Math.pow(f, 0.85) * w * 0.46) * scale * (0.82 + rng() * 0.36);
      const droop = 1.75 + f * 0.25 + (rng() - 0.5) * 0.2;
      for (const side of [-1, 1]) {
        drawSprig(ctx, canvas, pick(sheet.sprites, rng), cx + (rng() - 0.5) * jitter, y + (rng() - 0.5) * jitter, side * droop, reach, side > 0);
      }
      // Boughs that point toward and away from the viewer.
      drawSprig(ctx, canvas, sheet.sprites[0]!, cx + (rng() - 0.5) * reach * 0.9, y, Math.PI + (rng() - 0.5) * 0.5, reach * 0.55, rng() < 0.5);
    }
  };
  layer(sheet.dark, 8, 1);
  layer(sheet.lit, 3, 0.94);
  drawSprig(ctx, sheet.lit, sheet.sprites[0]!, cx, top + 34, 0, 34, false);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load the forest texture ${url}`));
    image.src = url;
  });
}

function cellAt(x: number, y: number, w: number, h: number): AtlasCell {
  const inset = 1.5;
  return {
    u0: (x + inset) / ATLAS_SIZE,
    u1: (x + w - inset) / ATLAS_SIZE,
    vBase: (y + h - inset) / ATLAS_SIZE,
    vTip: (y + inset) / ATLAS_SIZE,
  };
}

interface AtlasImages {
  beech: [HTMLImageElement, HTMLImageElement];
  hazel: [HTMLImageElement, HTMLImageElement];
  needles: [HTMLImageElement, HTMLImageElement];
  leaflets: [HTMLImageElement, HTMLImageElement];
  barkBroadleaf: HTMLImageElement;
  barkConifer: HTMLImageElement;
}

/** Composes the foliage atlas. Deterministic: the same picture on every load. */
export function composeAtlas(images: AtlasImages): { canvas: HTMLCanvasElement; atlas: Omit<ForestAtlas, 'texture'>; pixels: Uint8Array } {
  const rng = mulberry32(4711);
  const { canvas, ctx } = canvasOf(ATLAS_SIZE, ATLAS_SIZE);
  // Summer foliage: deep greens, with shaded and sunlit copies of every leaf for depth.
  const beech = makeSheet(images.beech[0], images.beech[1], BEECH, 'rgba(34, 74, 22, 0.4)', 'rgba(6, 26, 10, 0.62)', 'rgba(176, 200, 70, 0.17)');
  const hazel = makeSheet(images.hazel[0], images.hazel[1], HAZEL, 'rgba(40, 84, 24, 0.5)', 'rgba(8, 28, 10, 0.6)', 'rgba(176, 204, 76, 0.16)');
  const needles = makeSheet(images.needles[0], images.needles[1], NEEDLES, 'rgba(24, 52, 30, 0.34)', 'rgba(4, 16, 10, 0.6)', 'rgba(140, 176, 84, 0.22)');
  const leaflets = makeSheet(images.leaflets[0], images.leaflets[1], LEAFLETS, 'rgba(40, 96, 26, 0.78)', 'rgba(8, 30, 8, 0.55)', 'rgba(160, 196, 66, 0.22)');

  // Each cell: where it sits, how it is painted and the colour its transparent pixels take (so edges do not fringe).
  const fills: { rect: Rect; color: readonly [number, number, number] }[] = [];
  const paint = (x: number, y: number, w: number, h: number, color: readonly [number, number, number], draw: () => void): AtlasCell => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x, y);
    draw();
    ctx.restore();
    fills.push({ rect: [x, y, w, h], color });
    return cellAt(x, y, w, h);
  };
  const leafGreen = [50, 84, 30] as const;
  const needleGreen = [30, 52, 30] as const;

  const sprays: AtlasCell[] = [];
  for (let i = 0; i < 4; i++) sprays.push(paint(i * 512, 0, 512, 512, leafGreen, () => drawSpray(ctx, beech, 512, 512, rng, 36)));
  const shrubs: AtlasCell[] = [];
  for (let i = 0; i < 2; i++) shrubs.push(paint(i * 512, 512, 512, 512, leafGreen, () => drawSpray(ctx, hazel, 512, 512, rng, 62)));

  // Copies of the sprays (and shaded / sunlit versions) to stamp into the masses and far trees.
  const copy = (index: number, fill: string | null) => {
    const { canvas: out, ctx: octx } = canvasOf(256, 256);
    octx.drawImage(canvas, index * 512, 0, 512, 512, 0, 0, 256, 256);
    return fill ? tintedCopy(out, fill) : out;
  };
  const stamps = [0, 1, 2, 3].map((i) => copy(i, null));
  const darkStamps = [0, 1, 2, 3].map((i) => copy(i, 'rgba(6, 24, 10, 0.6)'));
  const brightStamps = [0, 1, 2, 3].map((i) => copy(i, 'rgba(190, 210, 84, 0.16)'));

  const masses: AtlasCell[] = [];
  for (let i = 0; i < 2; i++) masses.push(paint(1024 + i * 512, 512, 512, 512, leafGreen, () => drawMass(ctx, stamps, darkStamps, 512, 512, rng)));
  const boughs: AtlasCell[] = [];
  for (let i = 0; i < 4; i++) boughs.push(paint(i * 256, 1024, 256, 512, needleGreen, () => drawBough(ctx, needles, 256, 512, rng)));
  const fronds: AtlasCell[] = [];
  for (let i = 0; i < 4; i++) fronds.push(paint(1024 + i * 128, 1024, 128, 512, [58, 100, 34], () => drawFrond(ctx, leaflets, 128, 512, rng)));
  const bark: AtlasCell[] = [];
  [images.barkBroadleaf, images.barkConifer].forEach((image, i) => {
    bark.push(
      paint(1536 + i * 64, 1024, 64, 512, [70, 62, 50], () => {
        for (let k = 0; k < 3; k++) ctx.drawImage(image, 0, k * 171, 64, 171);
        ctx.fillStyle = i === 0 ? 'rgba(28, 30, 20, 0.3)' : 'rgba(30, 20, 12, 0.34)';
        ctx.fillRect(0, 0, 64, 512);
      }),
    );
  });
  const farBroadleaf: AtlasCell[] = [];
  for (let i = 0; i < 2; i++) {
    farBroadleaf.push(paint(i * 512, 1536, 512, 512, leafGreen, () => drawFarBroadleaf(ctx, stamps, darkStamps, brightStamps, images.barkBroadleaf, 512, 512, rng)));
  }
  const farConifer: AtlasCell[] = [];
  for (let i = 0; i < 2; i++) farConifer.push(paint(1024 + i * 256, 1536, 256, 512, needleGreen, () => drawFarConifer(ctx, needles, 256, 512, rng)));

  // Give fully transparent pixels the colour of the foliage around them: mip maps and
  // filtering then blend toward green at the cut-out edges, not toward black.
  const image = ctx.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const data = image.data;
  for (const { rect, color } of fills) {
    for (let y = rect[1]; y < rect[1] + rect[3]; y++) {
      let i = (y * ATLAS_SIZE + rect[0]) * 4;
      for (let x = 0; x < rect[2]; x++, i += 4) {
        const a = data[i + 3]!;
        if (a === 255) continue;
        if (a < 8) {
          data[i] = color[0];
          data[i + 1] = color[1];
          data[i + 2] = color[2];
        }
      }
    }
  }
  const pixels = new Uint8Array(data.buffer.slice(0));
  return { canvas, atlas: { sprays, shrubs, masses, boughs, fronds, farBroadleaf, farConifer, bark }, pixels };
}

export async function loadAtlasImages(): Promise<AtlasImages> {
  const [beechColor, beechOpacity, hazelColor, hazelOpacity, needlesColor, needlesOpacity, leafletsColor, leafletsOpacity, barkBroadleaf, barkConifer] = await Promise.all(
    [beechColorUrl, beechOpacityUrl, hazelColorUrl, hazelOpacityUrl, needlesColorUrl, needlesOpacityUrl, leafletsColorUrl, leafletsOpacityUrl, barkBroadleafColorUrl, barkConiferColorUrl].map(loadImage),
  );
  return {
    beech: [beechColor!, beechOpacity!],
    hazel: [hazelColor!, hazelOpacity!],
    needles: [needlesColor!, needlesOpacity!],
    leaflets: [leafletsColor!, leafletsOpacity!],
    barkBroadleaf: barkBroadleaf!,
    barkConifer: barkConifer!,
  };
}

/** Loads every forest texture and composes the foliage atlas. */
export async function loadForestTextures(renderer: THREE.WebGLRenderer): Promise<ForestTextures> {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const created: THREE.Texture[] = [];
  const tiling = async (url: string, color: boolean): Promise<THREE.Texture> => {
    const texture = await loader.loadAsync(url);
    created.push(texture);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = anisotropy;
    return texture;
  };
  try {
    const [grassColor, grassNormal, floorColor, floorNormal, barkBroadleafColor, barkBroadleafNormal, barkConiferColor, barkConiferNormal, rockColor, rockNormal, images] =
      await Promise.all([
        tiling(grassColorUrl, true),
        tiling(grassNormalUrl, false),
        tiling(floorColorUrl, true),
        tiling(floorNormalUrl, false),
        tiling(barkBroadleafColorUrl, true),
        tiling(barkBroadleafNormalUrl, false),
        tiling(barkConiferColorUrl, true),
        tiling(barkConiferNormalUrl, false),
        tiling(rockColorUrl, true),
        tiling(rockNormalUrl, false),
        loadAtlasImages(),
      ]);
    const composed = composeAtlas(images);
    const texture = new THREE.DataTexture(composed.pixels, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.name = 'forest-foliage';
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(4, anisotropy);
    texture.needsUpdate = true;
    created.push(texture);
    return {
      grassColor,
      grassNormal,
      floorColor,
      floorNormal,
      barkBroadleafColor,
      barkBroadleafNormal,
      barkConiferColor,
      barkConiferNormal,
      rockColor,
      rockNormal,
      atlas: { texture, ...composed.atlas },
      all: created,
    };
  } catch (error) {
    for (const texture of created) texture.dispose();
    throw error;
  }
}
