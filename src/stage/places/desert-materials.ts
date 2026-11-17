/**
 * The desert's materials: MeshStandardMaterials whose shaders are extended for
 * photographed sand without visible tiling, rock without UV seams (triplanar),
 * and one hard desert sun.
 *
 * The sun: the stage's key light sits high in front of the dancers, and its
 * rim light shines from behind. On scenery that reads as two suns, so every
 * material here takes the key light only, lowers it to a desert-afternoon
 * elevation (keeping its compass direction, so the scenery's shadows stay
 * parallel to the dancers') and all but ignores the rim. Shadows of the
 * scenery are baked once into two top-down masks (see desert-bake.ts) that the
 * sand reads; the dancers' own shadows still come from the key light's map.
 */
import * as THREE from 'three';
import { WIND } from './desert-terrain';

/** Angle between the dune-building wind and the ripples' wind, radians. */
const RIPPLE_TURN = (38 * Math.PI) / 180;

/** Uniforms shared by every desert material. */
export interface DesertUniforms {
  /** World direction toward the stage's key light (to recognise it among the scene's lights). */
  uThKeyDir: { value: THREE.Vector3 };
  /** World direction toward the desert sun. */
  uThSunDir: { value: THREE.Vector3 };
  /** Brightness of the sun relative to the key light. */
  uThSunGain: { value: number };
  /** How much of the other directional lights (the rim) reaches the scenery. */
  uThRim: { value: number };
  /** Tint of the sky and bounce light on the scenery: less of it, and bluer, than on the stage, so shadows are deep and cool. */
  uThAmbient: { value: THREE.Color };
  /** Average colour of the sand (linear), for dust on rocks and plants. */
  uThSandTint: { value: THREE.Color };
  /** Baked sun-shadow (R) and contact-shade (G) masks around the stage and out to the horizon. */
  uThMaskNear: { value: THREE.Texture | null };
  uThMaskFar: { value: THREE.Texture | null };
  /** 1 / (2 * half extent) of the two masks. */
  uThMaskScale: { value: THREE.Vector2 };
  uThSandColor: { value: THREE.Texture | null };
  uThSandNormal: { value: THREE.Texture | null };
  uThSandSoft: { value: THREE.Texture | null };
  uThRockColor: { value: THREE.Texture | null };
  uThRockNormal: { value: THREE.Texture | null };
}

export function createDesertUniforms(): DesertUniforms {
  return {
    uThKeyDir: { value: new THREE.Vector3(-0.389, 0.777, 0.495) },
    uThSunDir: { value: new THREE.Vector3(-0.5, 0.588, 0.636) },
    uThSunGain: { value: 1.25 },
    uThRim: { value: 0.06 },
    uThAmbient: { value: new THREE.Color(0.62, 0.7, 0.86) },
    uThSandTint: { value: new THREE.Color(0.55, 0.37, 0.2) },
    uThMaskNear: { value: null },
    uThMaskFar: { value: null },
    uThMaskScale: { value: new THREE.Vector2(1 / 72, 1 / 440) },
    uThSandColor: { value: null },
    uThSandNormal: { value: null },
    uThSandSoft: { value: null },
    uThRockColor: { value: null },
    uThRockNormal: { value: null },
  };
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vThWorld;
varying float vThAbove;
`;

/** World position, and height above the object's own origin (which sits on the sand). */
const VERTEX_WORLD = /* glsl */ `
{
  vec4 thWorld = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    thWorld = instanceMatrix * thWorld;
    float thBase = ( modelMatrix * instanceMatrix[ 3 ] ).y;
  #else
    float thBase = modelMatrix[ 3 ].y;
  #endif
  thWorld = modelMatrix * thWorld;
  vThWorld = thWorld.xyz;
  vThAbove = thWorld.y - thBase;
}
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vThWorld;
varying float vThAbove;
uniform vec3 uThKeyDir;
uniform vec3 uThSunDir;
uniform float uThSunGain;
uniform float uThRim;
uniform vec3 uThAmbient;
uniform vec3 uThSandTint;
vec3 thToWorld( vec3 v ) { return normalize( ( vec4( v, 0.0 ) * viewMatrix ).xyz ); }
float thHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float thNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( thHash( i ), thHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( thHash( i + vec2( 0.0, 1.0 ) ), thHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
`;

/** The light loop of the standard material, with the key light turned into the desert sun. */
function sunLights(): string {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const anchor = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (!chunk.includes(anchor)) return chunk;
  return (
    'vec3 thSunView = normalize( mat3( viewMatrix ) * uThSunDir );\n' +
    chunk.replace(
      anchor,
      `${anchor}
		if ( dot( thToWorld( directLight.direction ), uThKeyDir ) > 0.995 ) {
			directLight.direction = thSunView;
			directLight.color *= uThSunGain * thSunVis;
		} else {
			directLight.color *= uThRim;
		}`,
    )
  );
}

const SHADE_END = /* glsl */ `
#include <aomap_fragment>
reflectedLight.indirectDiffuse *= thAO * uThAmbient;
reflectedLight.indirectSpecular *= thAO * uThAmbient;
reflectedLight.directDiffuse *= mix( 1.0, thAO, 0.55 );
`;

interface Patch {
  /** Program cache key: one per distinct shader. */
  key: string;
  uniforms: Record<string, { value: unknown }>;
  vertexPars?: string;
  /** Runs after the world position is known. */
  vertexMain?: string;
  /** Replaces <uv_vertex>. */
  uvVertex?: string;
  fragmentPars?: string;
  /** Replaces <map_fragment>; must declare `float thSunVis` and `float thAO`. */
  surface: string;
  /** Replaces <normal_fragment_maps>. */
  normal?: string;
  /** Replaces <normal_fragment_begin>. */
  normalBegin?: string;
}

function patch(material: THREE.MeshStandardMaterial, shared: DesertUniforms, options: Patch): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, options.uniforms);
    let vertex = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}${options.vertexPars ?? ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_WORLD}${options.vertexMain ?? ''}`);
    if (options.uvVertex) vertex = vertex.replace('#include <uv_vertex>', options.uvVertex);
    shader.vertexShader = vertex;
    let fragment = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}${options.fragmentPars ?? ''}`)
      .replace('#include <map_fragment>', options.surface)
      .replace('#include <lights_fragment_begin>', sunLights())
      .replace('#include <aomap_fragment>', SHADE_END);
    if (options.normal) fragment = fragment.replace('#include <normal_fragment_maps>', options.normal);
    if (options.normalBegin) fragment = fragment.replace('#include <normal_fragment_begin>', options.normalBegin);
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => `thunes-desert-${options.key}`;
}

// ──────────────────────────────────────────────────────────────── sand ──

const SAND_PARS = /* glsl */ `
uniform sampler2D uThSandColor;
uniform sampler2D uThSandNormal;
uniform sampler2D uThSandSoft;
uniform sampler2D uThMaskNear;
uniform sampler2D uThMaskFar;
uniform vec2 uThMaskScale;
uniform vec2 uThWind;
uniform vec2 uThCrest;
uniform vec3 uThSandLook;
uniform vec4 uThSandHue;
`;

/**
 * Sand colour. The ripple photograph is laid across the wind and sampled twice
 * at offsets picked by a slow noise, so no repeat shows; a blurred copy of the
 * same photograph at dune scale mottles it.
 */
const SAND_SURFACE = /* glsl */ `
vec3 thGeoN = thToWorld( normalize( vNormal ) );
vec2 thXZ = vThWorld.xz;
vec4 thMask;
{
  vec2 uvNear = thXZ * uThMaskScale.x + 0.5;
  vec2 uvFar = thXZ * uThMaskScale.y + 0.5;
  float edge = max( abs( uvNear.x - 0.5 ), abs( uvNear.y - 0.5 ) );
  thMask = mix( texture2D( uThMaskNear, uvNear ), texture2D( uThMaskFar, uvFar ), smoothstep( 0.45, 0.49, edge ) );
}
float thSunVis = thMask.r;
float thAO = thMask.g;
// 1 on slip faces: avalanching sand is smooth, with no ripples.
float thSlip = 1.0 - smoothstep( 0.862, 0.905, thGeoN.y );
vec2 thRip = vec2( dot( thXZ, uThCrest ), dot( thXZ, uThWind ) );
vec2 thUv = thRip / uThSandLook.x;
vec2 thDx = dFdx( thUv );
vec2 thDy = dFdy( thUv );
float thPick = thNoise( thRip * 0.11 ) * 8.0;
float thPickI = floor( thPick );
vec2 thOffA = sin( vec2( 3.0, 7.0 ) * thPickI );
vec2 thOffB = sin( vec2( 3.0, 7.0 ) * ( thPickI + 1.0 ) );
vec3 thColA = textureGrad( uThSandColor, thUv + thOffA, thDx, thDy ).rgb;
vec3 thColB = textureGrad( uThSandColor, thUv + thOffB, thDx, thDy ).rgb;
float thBlend = smoothstep( 0.2, 0.8, fract( thPick ) - 0.1 * ( thColA.r + thColA.g + thColA.b - thColB.r - thColB.g - thColB.b ) );
vec3 thMean = textureLod( uThSandColor, vec2( 0.5 ), 12.0 ).rgb;
vec3 thSand = mix( thColA, thColB, thBlend );
thSand = mix( thSand, thMean, thSlip * 0.75 );
// Dune-scale mottling from a blurred, much larger copy of the photograph.
vec3 thBroad = texture2D( uThSandColor, thXZ.yx * 0.0137 + 0.31, 2.5 ).rgb / thMean;
vec3 thWide = texture2D( uThSandColor, thXZ * 0.0031 + 0.63, 1.0 ).rgb / thMean;
thSand *= mix( vec3( 1.0 ), thBroad * thWide, uThSandLook.z );
thSand = mix( vec3( dot( thSand, vec3( 0.3, 0.55, 0.15 ) ) ), thSand, uThSandHue.w ) * uThSandHue.rgb;
diffuseColor.rgb *= thSand;
`;

const SAND_NORMAL = /* glsl */ `
{
  vec3 crest = vec3( uThCrest.x, 0.0, uThCrest.y );
  vec3 thT = normalize( crest - thGeoN * dot( crest, thGeoN ) );
  vec3 thB = cross( thGeoN, thT );
  vec3 nA = textureGrad( uThSandNormal, thUv + thOffA, thDx, thDy ).xyz * 2.0 - 1.0;
  vec3 nB = textureGrad( uThSandNormal, thUv + thOffB, thDx, thDy ).xyz * 2.0 - 1.0;
  vec2 ripple = mix( nA.xy, nB.xy, thBlend ) * uThSandLook.y * ( 1.0 - 0.9 * thSlip );
  // Soft hummocks at a few metres, so the middle distance is not dead flat.
  vec2 soft = ( texture2D( uThSandSoft, thRip / 8.7 + 0.17 ).xy * 2.0 - 1.0 ) * 0.55 * ( 1.0 - 0.6 * thSlip );
  vec2 bend = ripple + soft;
  normal = normalize( mat3( viewMatrix ) * normalize( thT * bend.x + thB * bend.y + thGeoN ) );
}
`;

export interface SandTextures {
  color: THREE.Texture;
  normal: THREE.Texture;
  soft: THREE.Texture;
}

/** The ground. Lit, so it receives the dancers' shadows from the key light. */
export function createSandMaterial(shared: DesertUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true });
  material.envMapIntensity = 0.55;
  // Ripples form across the wind near the ground, which the dunes turn along their troughs:
  // here it runs RIPPLE_TURN further toward the camera than the wind that built the dunes.
  const wind = new THREE.Vector2(WIND[0], WIND[1]).rotateAround(new THREE.Vector2(), RIPPLE_TURN);
  patch(material, shared, {
    key: 'sand',
    uniforms: {
      uThWind: { value: wind },
      uThCrest: { value: new THREE.Vector2(-wind.y, wind.x) },
      // x: size of one ripple tile, metres. y: ripple depth. z: strength of the dune-scale mottling.
      uThSandLook: { value: new THREE.Vector3(1.8, 1.15, 0.7) },
      // rgb: tint of the photograph; w: its saturation.
      uThSandHue: { value: new THREE.Vector4(1.04, 1.06, 1.1, 0.8) },
    },
    fragmentPars: SAND_PARS,
    surface: SAND_SURFACE,
    normal: SAND_NORMAL,
  });
  return material;
}

// ──────────────────────────────────────────────────────────────── rock ──

const ROCK_PARS = /* glsl */ `
uniform sampler2D uThRockColor;
uniform sampler2D uThRockNormal;
uniform vec4 uThRockLook;
uniform vec3 uThRockDust;
`;

/**
 * Rock colour by triplanar projection in world space (no UVs, no seams; every
 * boulder shows a different part of the photograph). Sand lies at the foot of
 * each rock and on its flat tops.
 */
const ROCK_SURFACE = /* glsl */ `
float thSunVis = 1.0;
vec3 thGeoN = thToWorld( normalize( vNormal ) );
vec3 thW = pow( abs( thGeoN ), vec3( 5.0 ) );
thW /= thW.x + thW.y + thW.z;
// Sides are stretched along the horizon (uThRockLook.y < 1) to read as bedding on cliffs.
vec3 thP = vThWorld * uThRockLook.x;
vec2 thUvX = thP.zy * vec2( uThRockLook.y, 1.0 );
vec2 thUvY = thP.xz;
vec2 thUvZ = thP.xy * vec2( uThRockLook.y, 1.0 );
vec3 thRock = texture2D( uThRockColor, thUvX ).rgb * thW.x + texture2D( uThRockColor, thUvY ).rgb * thW.y + texture2D( uThRockColor, thUvZ ).rgb * thW.z;
float thFoot = uThRockDust.x;
float thGrain = dot( thRock, vec3( 0.6 ) ) - 0.25;
float thDust = 1.0 - smoothstep( thFoot * 0.1, thFoot, vThAbove + thGrain * thFoot );
thDust = max( thDust, smoothstep( 0.72, 0.97, thGeoN.y + thGrain * 0.25 ) * uThRockDust.y );
diffuseColor.rgb *= mix( thRock * uThRockLook.w, uThSandTint, thDust * 0.9 );
// Contact shade where the rock meets the sand.
float thAO = mix( 0.5, 1.0, smoothstep( 0.0, uThRockDust.z, vThAbove ) );
`;

const ROCK_NORMAL = /* glsl */ `
{
  vec3 tx = texture2D( uThRockNormal, thUvX ).xyz * 2.0 - 1.0;
  vec3 ty = texture2D( uThRockNormal, thUvY ).xyz * 2.0 - 1.0;
  vec3 tz = texture2D( uThRockNormal, thUvZ ).xyz * 2.0 - 1.0;
  vec3 bend = vec3( 0.0, tx.y, tx.x ) * thW.x + vec3( ty.x, 0.0, ty.y ) * thW.y + vec3( tz.x, tz.y, 0.0 ) * thW.z;
  normal = normalize( mat3( viewMatrix ) * normalize( thGeoN + bend * uThRockLook.z * ( 1.0 - 0.7 * thDust ) ) );
}
`;

export interface RockLook {
  /** Size of one texture tile, metres. */
  tile: number;
  /** Horizontal stretch of the sides (1 = none; 0.3 = features three times wider than tall). */
  stretch: number;
  /** Normal-map strength. */
  bump: number;
  /** Brightness of the rock colour. */
  gain: number;
  /** Height of the sand apron at the foot, metres. */
  foot: number;
  /** 0..1 sand on level tops. */
  topDust: number;
  /** Height of the contact shade, metres. */
  contact: number;
  key: string;
}

export function createRockMaterial(shared: DesertUniforms, look: RockLook): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0, vertexColors: true });
  material.envMapIntensity = 0.5;
  patch(material, shared, {
    key: `rock-${look.key}`,
    uniforms: {
      uThRockLook: { value: new THREE.Vector4(1 / look.tile, look.stretch, look.bump, look.gain) },
      uThRockDust: { value: new THREE.Vector3(look.foot, look.topDust, look.contact) },
    },
    fragmentPars: ROCK_PARS,
    surface: ROCK_SURFACE,
    normal: ROCK_NORMAL,
  });
  return material;
}

// ────────────────────────────────────────────────────────────── plants ──

/** Cactus skin: a ribbed, vertex-shaded trunk with a small tiling skin texture. */
export function createCactusMaterial(shared: DesertUniforms, skin: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: skin, roughness: 0.72, metalness: 0, vertexColors: true });
  material.envMapIntensity = 0.6;
  patch(material, shared, {
    key: 'cactus',
    uniforms: {},
    surface: /* glsl */ `
      #include <map_fragment>
      float thSunVis = 1.0;
      // Dust and shade at the foot.
      diffuseColor.rgb = mix( uThSandTint, diffuseColor.rgb, 0.45 + 0.55 * smoothstep( 0.0, 0.5, vThAbove ) );
      float thAO = mix( 0.55, 1.0, smoothstep( 0.0, 0.45, vThAbove ) );
    `,
  });
  return material;
}

/**
 * Dry grass and shrubs: alpha-tested cards from a 2 x 2 atlas (colour and
 * coverage in two textures, so the mip chain never fringes dark). Each instance
 * picks its atlas cell with the `aCell` attribute.
 */
export function createFoliageMaterial(shared: DesertUniforms, color: THREE.Texture, alpha: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: color,
    alphaMap: alpha,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  material.alphaToCoverage = true;
  material.envMapIntensity = 0.6;
  patch(material, shared, {
    key: 'foliage',
    uniforms: {},
    vertexPars: 'attribute vec2 aCell;\n',
    uvVertex: /* glsl */ `
      #include <uv_vertex>
      vMapUv = uv * 0.5 + aCell;
      vAlphaMapUv = vMapUv;
    `,
    // Cards are lit like the ground they stand on, on both faces.
    normalBegin: /* glsl */ `
      #include <normal_fragment_begin>
      normal = normalize( vNormal );
    `,
    surface: /* glsl */ `
      #include <map_fragment>
      float thSunVis = 1.0;
      float thAO = mix( 0.5, 1.0, smoothstep( 0.0, 0.35, vThAbove ) );
    `,
  });
  return material;
}
