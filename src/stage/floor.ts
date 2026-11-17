/**
 * The ground: a large plane at y = 0 drawn in two transparent layers.
 *   1. pattern — grid / checker / dance-floor tiles (or nothing) plus a soft
 *      pool of light around the stage centre. It fades to fully transparent
 *      with distance and fog, so it melts into whatever background is behind it.
 *   2. shadow  — a ShadowMaterial layer that only darkens where dancers cast
 *      shadows. It works in every style, including 'none'.
 */
import * as THREE from 'three';
import { STAGE_RADIUS } from '../config';
import type { AudioLevels, FloorStyle } from '../types';
import type { BackgroundPreset } from './backgrounds';
import { hexToRgb, mixHex } from './color';

const STYLE_INDEX: Record<FloorStyle, number> = { grid: 0, checker: 1, tiles: 2, none: 3 };

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
