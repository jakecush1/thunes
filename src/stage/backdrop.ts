/**
 * Draws the active background preset inside the WebGL frame (so captures
 * include it): a full-screen triangle for gradients and solids, an inverted
 * sphere with a procedural shader for skies. Both ignore depth and are drawn
 * before everything else.
 */
import * as THREE from 'three';
import type { BackgroundPreset, SkyKind } from './backgrounds';
import { hexToRgb } from './color';

const MAX_STOPS = 4;
const RENDER_ORDER = -1000;

const DITHER = /* glsl */ `
float ditherNoise(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 dither(vec3 c) {
  // Triangular noise of about one 8-bit step hides banding in smooth ramps.
  float n = ditherNoise(gl_FragCoord.xy) + ditherNoise(gl_FragCoord.xy + 17.17) - 1.0;
  return c + n / 255.0;
}
`;

const GRADIENT_VERTEX = /* glsl */ `
varying float vT;
void main() {
  vT = 0.5 - 0.5 * position.y;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const GRADIENT_FRAGMENT = /* glsl */ `
uniform vec3 uColors[${MAX_STOPS}];
uniform float uStops[${MAX_STOPS}];
uniform vec3 uFog;
uniform float uVeil;
uniform float uGain;
varying float vT;
${DITHER}
float seg(float a, float b, float t) {
  float x = clamp((t - a) / max(b - a, 1e-4), 0.0, 1.0);
  return mix(x, x * x * (3.0 - 2.0 * x), 0.5);
}
void main() {
  vec3 c = uColors[0];
  c = mix(c, uColors[1], seg(uStops[0], uStops[1], vT));
  c = mix(c, uColors[2], seg(uStops[1], uStops[2], vT));
  c = mix(c, uColors[3], seg(uStops[2], uStops[3], vT));
  c = mix(c, uFog, uVeil);
  gl_FragColor = vec4(dither(c * uGain), 1.0);
}
`;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // Rotation only: the sky is infinitely far away.
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
`;

/** Cloud cover of the daytime sky when a preset does not set one (0 = clear … 1 = overcast). */
const DEFAULT_CLOUD_COVER = 0.84;

const SKY_TYPES: Record<SkyKind, number> = { stars: 0, sunset: 1, clouds: 2, aurora: 3 };

const SKY_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uGain;
uniform float uVeil;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform float uCloudCover;
varying vec3 vDir;
${DITHER}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
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
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return s;
}
vec3 rgb(int r, int g, int b) { return vec3(float(r), float(g), float(b)) / 255.0; }

// One layer of point stars on the upper hemisphere. Returns brightness.
float starLayer(vec3 d, float scale, float density, float size) {
  vec2 uv = d.xz / (abs(d.x) + abs(d.y) + abs(d.z));
  vec2 p = uv * scale;
  vec2 id = floor(p);
  float h = hash12(id);
  if (h > density) return 0.0;
  float k = h / density;
  vec2 c = 0.25 + 0.5 * hash22(id + 7.0);
  float px = max(fwidth(p.x), fwidth(p.y));
  float r0 = size * (0.45 + 0.55 * k);
  float r = max(r0, px * 0.8);
  float core = smoothstep(r, r * 0.25, length(fract(p) - c));
  float twinkle = 0.78 + 0.22 * sin(uTime * (0.7 + 2.6 * fract(k * 7.3)) + k * 90.0);
  return core * twinkle * min(1.0, (r0 * r0) / (r * r)) * (0.35 + 0.65 * k);
}

vec3 sky(vec3 d) {
  float el = max(d.y, 0.0);
  vec3 col;
#if SKY_TYPE == 0
  // Star field with a faint diagonal band of dust
  col = mix(uHorizon, rgb(3, 4, 12), pow(el, 0.5));
  vec3 axis = normalize(vec3(0.8, 0.55, 0.0825));
  float band = exp(-pow(dot(d, axis) * 3.4, 2.0));
  float cloud = fbm(d.xz * 3.0 + d.y * 2.0 + 4.0);
  float above = smoothstep(0.0, 0.1, d.y);
  col += band * (0.3 + 0.7 * cloud) * rgb(30, 34, 84) * above;
  col += band * smoothstep(0.5, 0.85, cloud) * rgb(64, 30, 76) * 0.7 * above;
  float s = starLayer(d, 46.0, 0.5, 0.09) + 0.8 * starLayer(d.zyx, 84.0, 0.36 + 0.3 * band, 0.1)
          + 0.5 * starLayer(d.yxz + 0.3, 150.0, 0.3 + 0.4 * band, 0.12);
  vec3 tint = mix(rgb(190, 210, 255), rgb(255, 232, 200), hash12(floor(d.xz * 40.0)));
  col += s * smoothstep(0.0, 0.05, d.y) * tint;
#elif SKY_TYPE == 1
  // Sunset
  vec3 sun = normalize(vec3(0.0, 0.105, -1.0));
  col = mix(uHorizon, rgb(226, 88, 124), smoothstep(0.0, 0.3, el));
  col = mix(col, rgb(120, 58, 132), smoothstep(0.2, 0.6, el));
  col = mix(col, rgb(40, 26, 92), smoothstep(0.45, 1.0, el));
  float sd = dot(d, sun);
  col += rgb(255, 150, 80) * 0.38 * pow(max(sd, 0.0), 6.0);
  col += rgb(255, 214, 150) * 0.5 * pow(max(sd, 0.0), 60.0);
  float streak = fbm(vec2(d.x * 2.6 + d.z * 1.3 + 3.0, el * 26.0));
  float streakMask = smoothstep(0.5, 0.78, streak) * smoothstep(0.02, 0.1, el) * exp(-el * 4.5);
  col = mix(col, rgb(96, 44, 96), streakMask * 0.55);
  float disc = smoothstep(0.99595, 0.9964, sd);
  vec3 discColor = mix(rgb(255, 196, 120), rgb(255, 246, 214), smoothstep(-0.01, 0.12, d.y - sun.y + 0.06));
  col = mix(col, discColor, disc * (1.0 - streakMask * 0.6));
  col = mix(col, uHorizon, exp(-el * 22.0) * 0.75);
#elif SKY_TYPE == 2
  // Daytime sky with drifting clouds
  vec3 sun = normalize(vec3(-0.45, 0.62, -0.64));
  col = mix(uHorizon, rgb(58, 134, 216), pow(el, 0.62));
  float sd = max(dot(d, sun), 0.0);
  col += rgb(255, 244, 214) * (0.25 * pow(sd, 24.0) + 0.6 * pow(sd, 700.0));
  vec2 p = d.xz / (el + 0.14) * 0.9 + uTime * vec2(0.012, 0.004);
  float n = fbm(p);
  float edge = mix(0.78, 0.4, uCloudCover);
  float cover = smoothstep(edge, edge + 0.28, n) * smoothstep(0.015, 0.2, el);
  float lit = clamp((n - fbm(p + sun.xz * 0.22)) * 3.0 + 0.6, 0.0, 1.0);
  vec3 cloudColor = mix(rgb(188, 204, 226), rgb(255, 255, 255), lit);
  col = mix(col, cloudColor, cover * 0.92);
#else
  // Aurora: curtains with a sharp lower edge and rays fading upwards, all around the horizon
  col = mix(uHorizon, rgb(3, 8, 20), pow(el, 0.5));
  float stars = (starLayer(d, 60.0, 0.4, 0.09) + 0.6 * starLayer(d.zyx, 110.0, 0.4, 0.11)) * smoothstep(0.0, 0.06, d.y);
  col += stars * 0.75 * rgb(210, 225, 255);
  vec2 u = normalize(d.xz + vec2(1e-5, 0.0));
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float edge = 0.05 + 0.085 * fi
               + 0.05 * sin(dot(u, vec2(2.3, 1.1)) * (2.0 + fi) + uTime * 0.05 + fi * 2.1)
               + 0.12 * (fbm(u * (1.8 + 0.5 * fi) + fi * 7.0 + uTime * 0.015) - 0.5);
    float h = d.y - edge;
    float body = h > 0.0 ? exp(-h * (7.0 - 1.5 * fi)) : exp(h * 70.0);
    float rays = 0.45 + 0.55 * vnoise(u * (26.0 + 9.0 * fi) + fi * 31.0 + uTime * 0.04);
    float reach = max(smoothstep(0.35, 0.7, vnoise(u * 1.6 + fi * 3.0 + uTime * 0.01)), 0.75 * smoothstep(0.1, 0.9, -u.y));
    vec3 tint = mix(rgb(52, 255, 150), rgb(140, 88, 255), smoothstep(0.02, 0.3, h));
    glow += tint * body * rays * reach * (0.6 - 0.12 * fi);
  }
  col += glow * smoothstep(0.0, 0.04, d.y) * 0.85;
#endif
  return col;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = sky(d);
  // Below the horizon: haze into the ground colour (the floor is drawn over this).
  col = mix(col, uGround, smoothstep(0.0, -0.2, d.y));
  col = mix(col, uHorizon, uVeil);
  gl_FragColor = vec4(dither(col * uGain), 1.0);
}
`;

/** The object that draws the background. Add `object` to the scene. */
export interface Backdrop {
  readonly object: THREE.Object3D;
  /** Switch to a preset (cheap; sky shaders compile on first use). */
  setPreset(preset: BackgroundPreset): void;
  /**
   * Per-frame/per-change parameters.
   * @param time seconds, drives twinkle and drift
   * @param gain display-space multiplier from exposure (1 = colours exactly as authored)
   * @param veil 0..1 how much fog hides the backdrop
   */
  setParams(time: number, gain: number, veil: number): void;
  dispose(): void;
}

export function createBackdrop(): Backdrop {
  const object = new THREE.Group();
  object.name = 'backdrop';

  // Full-screen triangle for gradients and solids.
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const gradientUniforms = {
    uColors: { value: Array.from({ length: MAX_STOPS }, () => new THREE.Vector3()) },
    uStops: { value: [0, 1, 1, 1] },
    uFog: { value: new THREE.Vector3() },
    uVeil: { value: 0 },
    uGain: { value: 1 },
  };
  const gradientMaterial = new THREE.ShaderMaterial({
    name: 'backdrop-gradient',
    uniforms: gradientUniforms,
    vertexShader: GRADIENT_VERTEX,
    fragmentShader: GRADIENT_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const gradientMesh = new THREE.Mesh(triangle, gradientMaterial);
  gradientMesh.frustumCulled = false;
  gradientMesh.renderOrder = RENDER_ORDER;
  gradientMesh.matrixAutoUpdate = false;
  object.add(gradientMesh);

  // Inverted sphere for skies; one material per sky type, created on demand.
  const sphere = new THREE.IcosahedronGeometry(1, 3);
  const skyUniforms = {
    uTime: { value: 0 },
    uGain: { value: 1 },
    uVeil: { value: 0 },
    uHorizon: { value: new THREE.Vector3() },
    uGround: { value: new THREE.Vector3() },
    uCloudCover: { value: DEFAULT_CLOUD_COVER },
  };
  const skyMaterials = new Map<SkyKind, THREE.ShaderMaterial>();
  const skyMesh = new THREE.Mesh(sphere);
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = RENDER_ORDER;
  skyMesh.matrixAutoUpdate = false;
  skyMesh.visible = false;
  object.add(skyMesh);

  function skyMaterial(kind: SkyKind): THREE.ShaderMaterial {
    let material = skyMaterials.get(kind);
    if (!material) {
      material = new THREE.ShaderMaterial({
        name: `backdrop-sky-${kind}`,
        uniforms: skyUniforms,
        defines: { SKY_TYPE: SKY_TYPES[kind] },
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      });
      skyMaterials.set(kind, material);
    }
    return material;
  }

  function setVector(target: THREE.Vector3, hex: string): void {
    const [r, g, b] = hexToRgb(hex);
    target.set(r, g, b);
  }

  return {
    object,
    setPreset(preset) {
      const isSky = (preset.kind === 'sky' || preset.kind === 'place') && preset.sky !== undefined;
      skyMesh.visible = isSky;
      gradientMesh.visible = !isSky;
      if (isSky) {
        skyMesh.material = skyMaterial(preset.sky!);
        setVector(skyUniforms.uHorizon.value, preset.fog);
        setVector(skyUniforms.uGround.value, preset.ground ?? preset.fog);
        skyUniforms.uCloudCover.value = preset.cloudCover ?? DEFAULT_CLOUD_COVER;
      } else {
        const stops = preset.stops;
        for (let i = 0; i < MAX_STOPS; i++) {
          const stop = stops[Math.min(i, stops.length - 1)]!;
          setVector(gradientUniforms.uColors.value[i]!, stop.color);
          gradientUniforms.uStops.value[i] = i < stops.length ? stop.at : 1;
        }
        setVector(gradientUniforms.uFog.value, preset.fog);
      }
    },
    setParams(time, gain, veil) {
      // Wrap so float precision in the shader stays good for hours.
      skyUniforms.uTime.value = time % 3600;
      skyUniforms.uGain.value = gain;
      skyUniforms.uVeil.value = veil;
      gradientUniforms.uGain.value = gain;
      gradientUniforms.uVeil.value = veil;
    },
    dispose() {
      triangle.dispose();
      sphere.dispose();
      gradientMaterial.dispose();
      for (const material of skyMaterials.values()) material.dispose();
      skyMaterials.clear();
      object.removeFromParent();
    },
  };
}
