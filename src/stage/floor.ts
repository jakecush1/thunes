/**
 * The ground: a large plane at y = 0 drawn in two transparent layers.
 *   1. pattern — grid / checker / dance-floor tiles (or nothing) plus a soft
 *      pool of light around the stage centre, or a textured ground (grass,
 *      concrete, dirt, sand) generated in the shader. It fades to fully
 *      transparent with distance and fog, so it melts into whatever background
 *      is behind it.
 *   2. shadow  — a ShadowMaterial layer that only darkens where dancers cast
 *      shadows. It works in every style, including 'none'.
 */
import * as THREE from 'three';
import { STAGE_RADIUS } from '../config';
import type { AudioLevels, FloorStyle } from '../types';
import type { BackgroundPreset } from './backgrounds';
import { hexToRgb, mixHex } from './color';

const STYLE_INDEX: Record<FloorStyle, number> = { grid: 0, checker: 1, tiles: 2, none: 3, grass: 4, concrete: 5, dirt: 6, sand: 7 };

/** Styles at or above this index are textured grounds. */
const FIRST_TEXTURED = STYLE_INDEX.grass;

/**
 * Average colour of the sand texture (display RGB, 0..1). Scenery that must
 * meet the sand floor seamlessly (the desert's dunes) uses the same value.
 */
export const SAND_MID: readonly [number, number, number] = [0.85, 0.72, 0.475];

/** Half edge length of the pattern plane, metres (the pattern has faded out long before). */
const FLOOR_EXTENT = 320;
/** Half edge length of the shadow-receiving plane, metres. */
const SHADOW_EXTENT = STAGE_RADIUS * 5;

const FLOOR_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FLOOR_FRAGMENT = /* glsl */ `
uniform int uStyle;
uniform vec3 uLine;
uniform vec3 uAccent;
uniform vec3 uGlow;
uniform float uGlowStrength;
uniform float uDensity;
uniform float uGain;
uniform float uBeatIndex;
uniform float uBeatFrac;
uniform float uLevel;
uniform float uBass;
uniform vec3 uTone;
uniform float uTint;
varying vec3 vWorld;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Anti-aliased grid lines at integer coordinates. lineWidth is a fraction of a cell.
// Lines never get thinner than a pixel (they get fainter instead) and dissolve
// into their average coverage once cells are smaller than a pixel: no moire.
float gridMask(vec2 uv, float lineWidth) {
  vec4 dd = vec4(dFdx(uv), dFdy(uv));
  vec2 deriv = vec2(length(dd.xz), length(dd.yw));
  vec2 target = vec2(lineWidth);
  vec2 draw = clamp(target, deriv, vec2(0.5));
  vec2 aa = deriv * 1.5;
  vec2 g = 1.0 - abs(fract(uv) * 2.0 - 1.0);
  vec2 m = smoothstep(draw + aa, draw - aa, g);
  m *= clamp(target / draw, 0.0, 1.0);
  m = mix(m, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
  return mix(m.x, 1.0, m.y);
}

// Box-filtered checkerboard, 0..1.
float checkerMask(vec2 p) {
  vec2 w = fwidth(p) + 0.0005;
  vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
  return 0.5 - 0.5 * i.x * i.y;
}

float tileLit(vec2 id, float beat) {
  return smoothstep(0.5, 0.62, hash12(id + beat * vec2(13.0, 7.0)));
}

// ── Textured grounds ─────────────────────────────────────────────────────
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return s;
}
// 1 where a detail of the given frequency (cycles per metre) is resolvable on
// screen, falling to 0 as it shrinks below a couple of pixels: fine detail
// dissolves into its average instead of shimmering in the distance.
float detail(vec2 p, float frequency) {
  float footprint = max(fwidth(p.x), fwidth(p.y)) * frequency;
  return clamp(1.25 - footprint * 1.6, 0.0, 1.0);
}

vec3 grassColor(vec2 p) {
  float patches = fbm(p * 0.22);
  float tuft = vnoise(p * 3.1);
  vec3 c = mix(vec3(0.15, 0.32, 0.10), vec3(0.28, 0.49, 0.15), smoothstep(0.25, 0.7, patches));
  c = mix(c, vec3(0.48, 0.64, 0.22), smoothstep(0.55, 0.95, tuft) * 0.45);
  // Blades: two stretched noises multiplied give short streaks.
  float blades = vnoise(vec2(p.x * 46.0 + tuft * 3.0, p.y * 17.0)) * vnoise(vec2(p.x * 19.0, p.y * 53.0));
  c *= mix(1.0, 0.7 + 1.2 * blades, detail(p, 24.0));
  // A sprinkle of daisies.
  vec2 cell = floor(p * 2.3);
  vec2 f = fract(p * 2.3) - 0.5 - (vec2(hash12(cell + 7.1), hash12(cell + 3.7)) - 0.5) * 0.6;
  float flower = smoothstep(0.07, 0.03, length(f)) * step(0.94, hash12(cell)) * detail(p, 9.0);
  return mix(c, vec3(0.96, 0.95, 0.82), flower);
}

vec3 concreteColor(vec2 p) {
  vec3 c = mix(vec3(0.49, 0.48, 0.46), vec3(0.63, 0.62, 0.59), fbm(p * 0.55));
  c *= mix(1.0, 0.93 + 0.14 * vnoise(p * 38.0), detail(p, 30.0));
  // Old stains, expansion joints every 3 m and a few hairline cracks.
  c *= 1.0 - 0.11 * smoothstep(0.6, 0.8, fbm(p * 0.17 + 40.0));
  c = mix(c, c * 0.55, gridMask((p + 1.5) / 3.0, 0.004) * 0.9);
  float crack = abs(fbm(p * 0.9 + 11.0) - 0.5);
  c *= 1.0 - 0.35 * smoothstep(0.012, 0.0, crack) * detail(p, 8.0);
  return c;
}

vec3 dirtColor(vec2 p) {
  vec3 c = mix(vec3(0.32, 0.21, 0.13), vec3(0.50, 0.36, 0.22), fbm(p * 0.35));
  c *= mix(1.0, 0.82 + 0.36 * vnoise(p * 9.0), detail(p, 6.0));
  c *= mix(1.0, 0.9 + 0.2 * vnoise(p * 55.0), detail(p, 40.0));
  // Pebbles.
  vec2 cell = floor(p * 4.0);
  vec2 f = fract(p * 4.0) - 0.5 - (vec2(hash12(cell + 1.3), hash12(cell + 9.2)) - 0.5) * 0.7;
  float pebble = smoothstep(0.11, 0.07, length(f * vec2(1.0, 1.3))) * step(0.8, hash12(cell + 4.4)) * detail(p, 12.0);
  c = mix(c, mix(vec3(0.56, 0.51, 0.45), vec3(0.29, 0.26, 0.23), hash12(cell + 2.2)), pebble);
  // Damp patches.
  return c * (1.0 - 0.18 * smoothstep(0.55, 0.8, fbm(p * 0.12 + 7.0)));
}

vec3 sandColor(vec2 p) {
  vec3 c = mix(vec3(0.80, 0.66, 0.42), vec3(0.90, 0.78, 0.53), fbm(p * 0.18));
  // Wind ripples a hand's width apart, bent by slow noise.
  float ripple = sin((p.y + p.x * 0.25) * 22.0 + fbm(p * 0.5) * 15.0);
  c *= mix(1.0, 0.94 + 0.08 * ripple, detail(p, 5.0));
  c *= mix(1.0, 0.95 + 0.1 * vnoise(p * 70.0), detail(p, 50.0));
  return c;
}

void main() {
  // Half a cell of offset puts the stage centre in the middle of a cell / tile.
  vec2 p = vWorld.xz + 0.5;
  float dist = distance(vWorld, cameraPosition);
  // Plain exponential falloff: on screen it approaches the horizon with zero
  // slope, so even the solid styles end without a visible edge.
  float fade = exp(-dist * (0.008 + uDensity * 1.6));
  fade *= 1.0 - smoothstep(${(FLOOR_EXTENT * 0.55).toFixed(1)}, ${(FLOOR_EXTENT * 0.95).toFixed(1)}, length(vWorld.xz));

  vec3 color = uLine;
  float alpha = 0.0;

  if (uStyle == 0) {
    float minor = gridMask(p, 0.018);
    float major = gridMask((p + 2.0) / 5.0, 0.006);
    alpha = max(minor * 0.4, major * 0.8);
  } else if (uStyle == 1) {
    alpha = mix(0.06, 0.46, checkerMask(p));
  } else if (uStyle == 2) {
    vec2 id = floor(p);
    vec2 f = fract(p);
    vec2 w = fwidth(p);
    float footprint = max(w.x, w.y);
    float blur = clamp(footprint * 2.0 - 0.4, 0.0, 1.0);
    vec2 e = min(f, 1.0 - f);
    vec2 inner = smoothstep(vec2(0.03) - w, vec2(0.03) + w, e);
    float inside = mix(inner.x * inner.y, 0.88, blur);
    // The lit set changes on the beat with a short crossfade, then relaxes.
    float lit = mix(tileLit(id, uBeatIndex - 1.0), tileLit(id, uBeatIndex), smoothstep(0.0, 0.16, uBeatFrac));
    float pulse = exp(-3.5 * uBeatFrac);
    float ripple = 0.5 + 0.5 * sin(length(id + 0.5) * 0.9 - (uBeatIndex + uBeatFrac) * 3.14159265);
    float glowUp = 0.4 + 0.22 * pulse * (0.45 + 0.55 * uBass) + 0.14 * uLevel;
    float intensity = 0.13 + 0.07 * ripple + lit * glowUp;
    float pick = step(0.5, hash12(id * 1.7 + 3.0));
    color = mix(uLine, uAccent, mix(pick, 0.5, blur));
    intensity = mix(intensity, 0.2 + 0.45 * glowUp, blur);
    alpha = clamp(intensity, 0.0, 0.92) * inside;
  }

  if (uStyle >= ${FIRST_TEXTURED}) {
    vec2 q = vWorld.xz;
    if (uStyle == 4) color = grassColor(q);
    else if (uStyle == 5) color = concreteColor(q);
    else if (uStyle == 6) color = dirtColor(q);
    else color = sandColor(q);
    // A chosen floor colour recolours the texture and keeps its light and dark.
    color = mix(color, dot(color, vec3(0.299, 0.587, 0.114)) * uLine * 1.7, uTint * 0.85);
    color *= uTone;
    // Solid ground: opaque nearby, thinning out more slowly than the graphic patterns.
    alpha = 1.0;
    fade = sqrt(fade);
  }

  alpha *= fade;
  float glow = uGlowStrength * exp(-dot(vWorld.xz, vWorld.xz) / 90.0) * fade;
  float outAlpha = alpha + glow * (1.0 - alpha);
  vec3 rgb = (color * alpha + uGlow * glow * (1.0 - alpha)) / max(outAlpha, 1e-4);
  // A little noise on the alpha hides banding in the wide, faint pool of light.
  float n = hash12(gl_FragCoord.xy) + hash12(gl_FragCoord.xy + 31.7) - 1.0;
  outAlpha = clamp(outAlpha + n * 0.004 * step(0.002, outAlpha), 0.0, 1.0);
  gl_FragColor = vec4(rgb * uGain, outAlpha);
}
`;

const SHADOW_FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  // Shadows dissolve in fog instead of turning into fog-coloured patches.
  gl_FragColor.a *= 1.0 - fogFactor;
#endif
`;

/** Floor colours resolved from the scene and the active preset ('#rrggbb'). */
export interface FloorColors {
  line: string;
  accent: string;
}

/**
 * Pattern colours: `floorColor` when the user picked one (the tiles' second
 * colour is then derived from it), otherwise the preset's own pair.
 */
export function floorColors(floorColor: string | null, preset: BackgroundPreset): FloorColors {
  if (!floorColor) return { line: preset.floor.line, accent: preset.floor.accent };
  return { line: floorColor, accent: mixHex(floorColor, preset.floor.accent, 0.65) };
}

export interface Floor {
  readonly object: THREE.Object3D;
  /** Pattern, colours and pool of light. */
  setLook(style: FloorStyle, floorColor: string | null, preset: BackgroundPreset): void;
  /**
   * @param density exponential fog density (per metre)
   * @param gain display-space multiplier from exposure
   */
  setAtmosphere(density: number, gain: number): void;
  /** Per-frame animation input for the tiles. `beat` is the continuous beat counter. */
  setBeat(beat: number, levels: AudioLevels): void;
  dispose(): void;
}

export function createFloor(): Floor {
  const object = new THREE.Group();
  object.name = 'floor';

  const uniforms = {
    uStyle: { value: 0 },
    uLine: { value: new THREE.Vector3(1, 1, 1) },
    uAccent: { value: new THREE.Vector3(1, 1, 1) },
    uGlow: { value: new THREE.Vector3(1, 1, 1) },
    uGlowStrength: { value: 0 },
    uDensity: { value: 0 },
    uGain: { value: 1 },
    uBeatIndex: { value: 0 },
    uBeatFrac: { value: 0 },
    uLevel: { value: 0 },
    uBass: { value: 0 },
    uTone: { value: new THREE.Vector3(1, 1, 1) },
    uTint: { value: 0 },
  };

  const patternGeometry = new THREE.PlaneGeometry(FLOOR_EXTENT * 2, FLOOR_EXTENT * 2);
  patternGeometry.rotateX(-Math.PI / 2);
  const patternMaterial = new THREE.ShaderMaterial({
    name: 'floor-pattern',
    uniforms,
    vertexShader: FLOOR_VERTEX,
    fragmentShader: FLOOR_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const pattern = new THREE.Mesh(patternGeometry, patternMaterial);
  pattern.name = 'floor-pattern';
  pattern.renderOrder = -20;
  pattern.matrixAutoUpdate = false;
  object.add(pattern);

  const shadowGeometry = new THREE.PlaneGeometry(SHADOW_EXTENT * 2, SHADOW_EXTENT * 2);
  shadowGeometry.rotateX(-Math.PI / 2);
  const shadowMaterial = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.4, depthWrite: false });
  shadowMaterial.name = 'floor-shadow';
  shadowMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', SHADOW_FOG_FRAGMENT);
  };
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.name = 'floor-shadow';
  shadow.receiveShadow = true;
  shadow.renderOrder = -19;
  shadow.matrixAutoUpdate = false;
  object.add(shadow);

  function setVector(target: THREE.Vector3, hex: string): void {
    const [r, g, b] = hexToRgb(hex);
    target.set(r, g, b);
  }

  return {
    object,
    setLook(style, floorColor, preset) {
      uniforms.uStyle.value = STYLE_INDEX[style] ?? STYLE_INDEX.none;
      const colors = floorColors(floorColor, preset);
      setVector(uniforms.uLine.value, colors.line);
      setVector(uniforms.uAccent.value, colors.accent);
      setVector(uniforms.uGlow.value, preset.floor.glow);
      uniforms.uGlowStrength.value = preset.floor.glowStrength;
      // Textured grounds: tinted only when the user picked a colour, and toned to sit in the backdrop's light.
      uniforms.uTint.value = floorColor ? 1 : 0;
      setVector(uniforms.uTone.value, preset.floor.tone ?? mixHex(preset.fog, '#ffffff', 0.55));
      shadowMaterial.opacity = preset.floor.shadow;
    },
    setAtmosphere(density, gain) {
      uniforms.uDensity.value = density;
      uniforms.uGain.value = gain;
    },
    setBeat(beat, levels) {
      const index = Math.floor(beat);
      // Keep the hash input small; 1024 is even, so the ripple stays continuous across the wrap.
      uniforms.uBeatIndex.value = ((index % 1024) + 1024) % 1024;
      uniforms.uBeatFrac.value = beat - index;
      uniforms.uLevel.value = levels.level;
      uniforms.uBass.value = levels.bass;
    },
    dispose() {
      patternGeometry.dispose();
      patternMaterial.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      object.removeFromParent();
    },
  };
}
