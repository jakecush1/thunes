/**
 * The city: a junction of two streets at sunset. The dancers stand in the
 * middle of the crossing; the street ahead of the default camera runs straight
 * into the low sun.
 *
 *   city-plan       the street grid and the buildings (data)
 *   city-look       the sunset light shared by every material
 *   city-ground     roads, pavements, kerbs, covers and drains
 *   city-buildings  facades, shop fronts, roofs
 *   city-cars       parked cars
 *   city-props      street lamps, traffic lights, bollards, glows
 *
 * Textures: photographs from ambientCG (CC0), see assets/city/CREDITS.txt.
 */
import * as THREE from 'three';
import type { StageContext } from '../system';
import asphaltNormalUrl from './assets/city/asphalt-n.jpg';
import asphaltUrl from './assets/city/asphalt.jpg';
import concreteUrl from './assets/city/concrete.jpg';
import decalsAlphaUrl from './assets/city/decals-alpha.jpg';
import decalsUrl from './assets/city/decals-color.jpg';
import bandMetalUrl from './assets/city/facade-band-m.jpg';
import bandNormalUrl from './assets/city/facade-band-n.jpg';
import bandUrl from './assets/city/facade-band.jpg';
import brickNormalUrl from './assets/city/facade-brick-n.jpg';
import brickUrl from './assets/city/facade-brick.jpg';
import glassMetalUrl from './assets/city/facade-glass-m.jpg';
import glassNormalUrl from './assets/city/facade-glass-n.jpg';
import glassUrl from './assets/city/facade-glass.jpg';
import gridMetalUrl from './assets/city/facade-grid-m.jpg';
import pierNormalUrl from './assets/city/facade-pier-n.jpg';
import pierUrl from './assets/city/facade-pier.jpg';
import stoneNormalUrl from './assets/city/facade-stone-n.jpg';
import stoneUrl from './assets/city/facade-stone.jpg';
import pavingNormalUrl from './assets/city/paving-n.jpg';
import pavingUrl from './assets/city/paving.jpg';
import { buildBuildings } from './city-buildings';
import { buildCars, createDetailMaterial } from './city-cars';
import { buildGround } from './city-ground';
import { createCityLook } from './city-look';
import type { ShadeBox } from './city-look';
import type { CityPart } from './city-mesh';
import { createCityPlan } from './city-plan';
import { buildProps } from './city-props';
import { createBin } from './shared';
import type { Place } from './shared';

export async function build(context: StageContext): Promise<Place> {
  const bin = createBin();
  const group = new THREE.Group();
  group.name = 'place-city';

  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, context.renderer.capabilities.getMaxAnisotropy());
  const load = async (url: string, color: boolean): Promise<THREE.Texture> => {
    const texture = bin.add(await loader.loadAsync(url));
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = anisotropy;
    return texture;
  };

  let textures: THREE.Texture[];
  try {
    textures = await Promise.all([
      load(asphaltUrl, true),
      load(asphaltNormalUrl, false),
      load(pavingUrl, true),
      load(pavingNormalUrl, false),
      load(concreteUrl, true),
      load(decalsUrl, true),
      load(decalsAlphaUrl, false),
      load(brickUrl, true),
      load(brickNormalUrl, false),
      load(stoneUrl, true),
      load(stoneNormalUrl, false),
      load(pierUrl, true),
      load(pierNormalUrl, false),
      load(bandUrl, true),
      load(bandNormalUrl, false),
      load(bandMetalUrl, false),
      load(glassUrl, true),
      load(glassNormalUrl, false),
      load(glassMetalUrl, false),
      load(gridMetalUrl, false),
    ]);
  } catch (error) {
    bin.dispose();
    throw error;
  }
  const [asphalt, asphaltNormal, paving, pavingNormal, concrete, decals, decalsAlpha, brick, brickNormal, stone, stoneNormal, pier, pierNormal, band, bandNormal, bandMetal, glass, glassNormal, glassMetal, gridMetal] =
    textures as [THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture];
  for (const texture of [decals, decalsAlpha]) {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  const look = bin.add(createCityLook(context.renderer));
  const plan = createCityPlan();
  const shade: ShadeBox[] = [];
  for (const building of plan.buildings) for (const tier of building.tiers) shade.push(tier);
  look.setShade(shade);

  const ground = buildGround(plan, look, { asphalt, asphaltNormal, paving, pavingNormal, concrete, decals, decalsAlpha });
  const buildings = buildBuildings(plan, look, {
    concrete,
    facades: {
      brick: { map: brick, normal: brickNormal, metal: gridMetal },
      stone: { map: stone, normal: stoneNormal, metal: gridMetal },
      pier: { map: pier, normal: pierNormal, metal: gridMetal },
      band: { map: band, normal: bandNormal, metal: bandMetal },
      glass: { map: glass, normal: glassNormal, metal: glassMetal },
    },
  });
  const detail = bin.add(createDetailMaterial(look));
  const cars = buildCars(look, detail);
  const props = buildProps(detail, buildings.masts, cars.lights);

  const parts: CityPart[] = [ground, buildings, cars, props];
  for (const part of parts) {
    for (const mesh of part.meshes) {
      bin.add(mesh.geometry);
      if (mesh instanceof THREE.InstancedMesh) bin.add(mesh);
      group.add(mesh);
    }
    for (const material of part.materials) bin.add(material);
    for (const texture of part.textures ?? []) bin.add(texture);
  }

  const store = context.store;
  return {
    object: group,
    ownsGround: true,
    update() {
      look.setBrightness(store.getState().scene.brightness);
      const fog = context.scene.fog;
      props.setFog(fog instanceof THREE.FogExp2 ? fog.density : 0);
    },
    dispose() {
      group.removeFromParent();
      bin.dispose();
    },
  };
}
