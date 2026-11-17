/**
 * Places: the 3D scenery that surrounds the stage for the 'place' backdrops
 * (forest, city, desert, ocean). Each place lives in its own module, which is
 * downloaded and built the first time the place is shown and then kept, so
 * switching back is instant.
 *
 * Scenery stays outside the stage (dancers can stand anywhere within
 * STAGE_RADIUS on the flat ground at y = 0) and out of the corridor between
 * the default camera and the stage.
 */
import { resolveBackground } from '../backgrounds';
import type { PlaceKind } from '../backgrounds';
import { exposureGain } from '../lighting';
import type { StageContext, StageSystem } from '../system';
import type { Place } from './shared';

interface PlaceModule {
  build(context: StageContext): Place | Promise<Place>;
}

const LOADERS: Record<PlaceKind, () => Promise<PlaceModule>> = {
  forest: () => import('./forest'),
  city: () => import('./city'),
  desert: () => import('./desert'),
  ocean: () => import('./ocean'),
};

/** Shows the scenery of the active 'place' backdrop (and none for the other backdrops). */
export function createPlacesSystem(context: StageContext): StageSystem {
  const built = new Map<PlaceKind, Place>();
  const loading = new Map<PlaceKind, Promise<Place | null>>();
  let active: PlaceKind | null = null;
  let shown: Place | null = null;
  let gain = 1;
  let disposed = false;

  /** The stage's own floor plane is hidden while a place that draws its ground is shown. */
  function setFloorVisible(visible: boolean): void {
    const floor = context.scene.getObjectByName('floor');
    if (floor) floor.visible = visible;
  }

  function present(kind: PlaceKind, place: Place): void {
    if (disposed || active !== kind || shown === place) return;
    shown = place;
    place.setGain?.(gain);
    context.scene.add(place.object);
    setFloorVisible(!place.ownsGround);
  }

  function load(kind: PlaceKind): Promise<Place | null> {
    let pending = loading.get(kind);
    if (!pending) {
      pending = LOADERS[kind]()
        .then((module) => module.build(context))
        .then((place) => {
          if (disposed) {
            place.dispose();
            return null;
          }
          built.set(kind, place);
          return place;
        })
        .catch((error: unknown) => {
          console.error(`[places] could not build the ${kind}`, error);
          loading.delete(kind);
          return null;
        });
      loading.set(kind, pending);
    }
    return pending;
  }

  function show(kind: PlaceKind | null): void {
    if (kind === active) return;
    shown?.object.removeFromParent();
    shown = null;
    active = kind;
    setFloorVisible(true);
    if (!kind) return;
    const ready = built.get(kind);
    if (ready) present(kind, ready);
    else void load(kind).then((place) => place && present(kind, place));
  }

  return {
    sync(state, previous) {
      if (previous && state.scene === previous.scene) return;
      gain = exposureGain(state.scene.exposure);
      show(resolveBackground(state.scene).place ?? null);
      shown?.setGain?.(gain);
    },
    update(frame) {
      shown?.update?.(frame.clock.time);
    },
    dispose() {
      disposed = true;
      shown?.object.removeFromParent();
      shown = null;
      for (const place of built.values()) place.dispose();
      built.clear();
      loading.clear();
      active = null;
      setFloorVisible(true);
    },
  };
}
