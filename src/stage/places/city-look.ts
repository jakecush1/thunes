/**
 * The city's light: a low sun straight down the -Z street.
 *
 * The stage's own key and rim lights are placed for the dancers, not for a
 * street at sunset, so the scenery is lit by three things of its own instead:
 *   - an environment map of the sunset sky (diffuse fill and reflections),
 *   - a "sun" evaluated in the material shaders only (it never touches the dancers),
 *   - a sun-shadow height map: for every square metre, the height below which
 *     the buildings toward the sun block it. One texture fetch gives long, soft
 *     building shadows for free.
 */
import * as THREE from 'three';

/** Direction to the sun of the 'sunset' sky (see stage/backdrop.ts). */
export const SUN = new THREE.Vector3(0, 0.105, -1).normalize();

/** Half-size of the square the shadow map covers, metres (1 texel per metre). */
const SHADE_HALF = 256;

export interface ShadeBox {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Top of the box, metres. */
  y1: number;
}

export interface SceneryOptions {
  /**
   * How the stage's directional lights reach the surface. 'ground' keeps them
   * (so the dancers' shadows show) but dims them where buildings shade the
   * street; 'none' drops them.
   */
  stageLights: 'ground' | 'none';
  /** Program cache key: one per distinct combination of hooks. */
  key: string;
  /** Strength of the sun on this surface (default 1); the road takes more, for the glare toward the sun. */
  sun?: number;
  uniforms?: Record<string, THREE.IUniform>;
  vertexHead?: string;
  vertexBody?: string;
  fragmentHead?: string;
  /** Runs after the colour map: edit `diffuseColor`. */
  albedo?: string;
  /** Runs after the roughness and metalness maps: edit `roughnessFactor` / `metalnessFactor`. */
  surface?: string;
  /** Runs after the emissive map: add to `totalEmissiveRadiance`. */
  emissive?: string;
}

export interface CityLook {
  /** Prefiltered sunset sky for `material.envMap`. */
  readonly env: THREE.Texture;
  /** Shared by every patched material. */
  readonly uniforms: {
    uCitySun: { value: THREE.Color };
    uCityShade: { value: THREE.Texture };
  };
  /** Make a standard/physical material take the city's sun, shade and sky. */
  patch<T extends THREE.MeshStandardMaterial>(material: T, envIntensity: number, options: SceneryOptions): T;
  /** Fill the sun-shadow map from the buildings. */
  setShade(boxes: readonly ShadeBox[]): void;
  /** Follow the brightness slider (1 = as authored). */
  setBrightness(brightness: number): void;
  dispose(): void;
}

const ENV_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * The sunset as light (linear, scene-referred): brighter and less saturated
 * than the painted sky, with a hot sun and a dark band of city along the
 * horizon everywhere except down the street.
 */
const ENV_FRAGMENT = /* glsl */ `
varying vec3 vDir;
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
void main() {
  vec3 d = normalize(vDir);
  vec3 sun = normalize(vec3(0.0, 0.105, -1.0));
  float el = max(d.y, 0.0);
  vec3 col = mix(vec3(1.35, 0.74, 0.36), vec3(0.95, 0.5, 0.5), smoothstep(0.0, 0.28, el));
  col = mix(col, vec3(0.52, 0.4, 0.66), smoothstep(0.18, 0.6, el));
  col = mix(col, vec3(0.3, 0.3, 0.62), smoothstep(0.45, 1.0, el));
  float sd = max(dot(d, sun), 0.0);
  col += vec3(2.4, 1.15, 0.4) * pow(sd, 7.0);
  col += vec3(5.0, 2.6, 0.9) * pow(sd, 70.0);
  col = mix(col, vec3(34.0, 17.0, 6.0), smoothstep(0.99595, 0.9968, sd));
  // The ground: asphalt in the evening light, glowing a little toward the sun.
  vec3 ground = vec3(0.15, 0.115, 0.105) + vec3(0.5, 0.22, 0.08) * pow(sd, 4.0);
  col = mix(col, ground, smoothstep(0.01, -0.03, d.y));
  // Buildings along the horizon, open down the two ends of the street.
  float side = abs(d.x) / max(length(d.xz), 1e-4);
  float azimuth = atan(d.x, d.z);
  float skyline = 0.14 + 0.3 * hash11(floor(azimuth * 9.0) + 3.0) * smoothstep(0.2, 0.5, side);
  float city = smoothstep(0.16, 0.3, side) * (1.0 - smoothstep(skyline - 0.01, skyline + 0.01, d.y)) * step(0.0, d.y);
  vec3 wall = mix(vec3(0.085, 0.07, 0.085), vec3(0.34, 0.2, 0.13), smoothstep(0.3, -1.0, d.z) * 0.6);
  col = mix(col, wall, city);
  gl_FragColor = vec4(col, 1.0);
}
`;

function createSunsetEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const geometry = new THREE.IcosahedronGeometry(10, 4);
  const material = new THREE.ShaderMaterial({ vertexShader: ENV_VERTEX, fragmentShader: ENV_FRAGMENT, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false });
  scene.add(new THREE.Mesh(geometry, material));
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0, 0.1, 50);
  generator.dispose();
  geometry.dispose();
  material.dispose();
  return target;
}

const VERTEX_HEAD = /* glsl */ `
varying vec3 vCityPos;
`;
const VERTEX_BODY = /* glsl */ `
{
  vec4 cityWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    cityWorld = instanceMatrix * cityWorld;
  #endif
  vCityPos = (modelMatrix * cityWorld).xyz;
}
`;
const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vCityPos;
uniform vec3 uCitySun;
uniform sampler2D uCityShade;
/** 0 where buildings toward the sun block it, 1 in the open. */
float citySunlight(vec3 p, vec3 n) {
  vec2 uv = (p.xz + n.xz * 1.6) / ${(SHADE_HALF * 2).toFixed(1)} + 0.5;
  vec2 shade = texture2D(uCityShade, uv).rg;
  float top = shade.r * 127.5;
  float high = smoothstep(top - 1.0, top + 0.5, p.y + 1.0);
  return mix(shade.g, high, smoothstep(1.0, 5.0, p.y));
}
`;

/** `lights_fragment_begin` with the stage's directional lights scaled per light, or removed. */
function lightsChunk(mode: SceneryOptions['stageLights']): string {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const loopGuard = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
  const lightInfo = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (!chunk.includes(loopGuard) || !chunk.includes(lightInfo)) return chunk;
  if (mode === 'none') return chunk.replace(loopGuard, '#if 0');
  // Light 0 is the shadow-casting key, the rest are rim lights.
  return chunk.replace(lightInfo, `${lightInfo}\n\t\tdirectLight.color *= ( UNROLLED_LOOP_INDEX == 0 ) ? cityKeyGain : cityRimGain;`);
}

const SUN_GLSL = `vec3(${SUN.x.toFixed(5)}, ${SUN.y.toFixed(5)}, ${SUN.z.toFixed(5)})`;

export function createCityLook(renderer: THREE.WebGLRenderer): CityLook {
  const environment = createSunsetEnvironment(renderer);

  const shadeData = new Uint8Array(SHADE_HALF * 2 * SHADE_HALF * 2 * 2);
  for (let i = 0; i < shadeData.length; i += 2) shadeData[i + 1] = 255;
  const shade = new THREE.DataTexture(shadeData, SHADE_HALF * 2, SHADE_HALF * 2, THREE.RGFormat, THREE.UnsignedByteType);
  shade.magFilter = THREE.LinearFilter;
  shade.minFilter = THREE.LinearFilter;
  shade.needsUpdate = true;

  const sunBase = new THREE.Color(3.4, 1.75, 0.72);
  const uniforms = {
    uCitySun: { value: sunBase.clone() },
    uCityShade: { value: shade as THREE.Texture },
  };
  const patched: { material: THREE.MeshStandardMaterial; envIntensity: number }[] = [];
  let brightness = 1;

  return {
    env: environment.texture,
    uniforms,
    patch(material, envIntensity, options) {
      material.envMap = environment.texture;
      material.envMapIntensity = envIntensity * brightness;
      patched.push({ material, envIntensity });
      const ground = options.stageLights === 'ground';
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms, options.uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}${options.vertexHead ?? ''}`)
          .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}${options.vertexBody ?? ''}`);
        let fragment = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}${options.fragmentHead ?? ''}`);
        if (options.albedo) fragment = fragment.replace('#include <map_fragment>', `#include <map_fragment>\n${options.albedo}`);
        if (options.surface) fragment = fragment.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${options.surface}`);
        if (options.emissive) fragment = fragment.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${options.emissive}`);
        fragment = fragment.replace(
          '#include <lights_fragment_begin>',
          /* glsl */ `
          vec3 cityNormal = inverseTransformDirection(normal, viewMatrix);
          float citySun = citySunlight(vCityPos, cityNormal);
          ${ground ? 'float cityKeyGain = mix(0.34, 1.0, citySun);\nfloat cityRimGain = cityKeyGain * 0.2;' : ''}
          ${lightsChunk(options.stageLights)}
          {
            IncidentLight citySunLight;
            citySunLight.color = uCitySun * (citySun * ${(options.sun ?? 1).toFixed(2)});
            citySunLight.direction = normalize((viewMatrix * vec4(${SUN_GLSL}, 0.0)).xyz);
            citySunLight.visible = true;
            RE_Direct(citySunLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
          }
          `,
        );
        shader.fragmentShader = fragment;
      };
      material.customProgramCacheKey = () => `thunes-city-${options.key}-${options.stageLights}-${options.sun ?? 1}`;
      return material;
    },
    setShade(boxes) {
      const size = SHADE_HALF * 2;
      const heights = new Float32Array(size * size);
      for (const box of boxes) {
        const x0 = Math.max(0, Math.round(box.x0 + SHADE_HALF));
        const x1 = Math.min(size, Math.round(box.x1 + SHADE_HALF));
        const z0 = Math.max(0, Math.round(box.z0 + SHADE_HALF));
        const z1 = Math.min(size, Math.round(box.z1 + SHADE_HALF));
        for (let z = z0; z < z1; z++) {
          for (let x = x0; x < x1; x++) {
            const i = z * size + x;
            if (box.y1 > heights[i]!) heights[i] = box.y1;
          }
        }
      }
      // The sun shines along +Z: sweep each column, letting the shadow sink with the sun's slope.
      const slope = SUN.y / -SUN.z;
      const open = new Float32Array(size * size);
      for (let x = 0; x < size; x++) {
        let top = 0;
        for (let z = 0; z < size; z++) {
          const i = z * size + x;
          top = Math.max(heights[i]!, top - slope);
          heights[i] = top;
          open[i] = top < 0.6 ? 1 : 0;
        }
      }
      // Soften the ground-level edge (about two metres of penumbra).
      const blurred = new Float32Array(size * size);
      for (let pass = 0; pass < 2; pass++) {
        for (let z = 0; z < size; z++) {
          for (let x = 0; x < size; x++) {
            const i = z * size + x;
            const left = open[x > 0 ? i - 1 : i]!;
            const right = open[x < size - 1 ? i + 1 : i]!;
            blurred[i] = (left + 2 * open[i]! + right) / 4;
          }
        }
        open.set(blurred);
      }
      for (let i = 0; i < size * size; i++) {
        shadeData[i * 2] = Math.min(255, Math.round(heights[i]! * 2));
        shadeData[i * 2 + 1] = Math.round(open[i]! * 255);
      }
      shade.needsUpdate = true;
    },
    setBrightness(value) {
      if (value === brightness) return;
      brightness = value;
      uniforms.uCitySun.value.copy(sunBase).multiplyScalar(value);
      for (const entry of patched) entry.material.envMapIntensity = entry.envIntensity * value;
    },
    dispose() {
      environment.dispose();
      shade.dispose();
      patched.length = 0;
    },
  };
}
