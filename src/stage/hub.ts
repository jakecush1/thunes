/**
 * The small blackboard the dancer, interaction and camera-loop systems share.
 * One per stage, looked up from the StageContext every system receives.
 */
import type { PickProxy } from './picking';
import type { StageContext } from './system';

export interface StageHub {
  /** Pick proxies, one per dancer, valid for indices below `count`. Call `refreshProxies` before reading. */
  readonly proxies: PickProxy[];
  /** Dancer id per proxy. */
  readonly ids: string[];
  count: number;
  /** Bring `proxies`/`ids`/`count` up to date with the dancers as last rendered. Installed by the dancer system. */
  refreshProxies(): void;
  /** The dancer under the pointer (drawn with a light ring), or null. Written by the interaction system. */
  hoveredId: string | null;
  /** The camera loop is moving the camera (including while it eases in or out): orbit controls must keep off. */
  cameraLocked: boolean;
}

const hubs = new WeakMap<StageContext, StageHub>();

/** The hub of the stage that owns `context` (created on first use). */
export function stageHub(context: StageContext): StageHub {
  let hub = hubs.get(context);
  if (!hub) {
    hub = { proxies: [], ids: [], count: 0, refreshProxies() {}, hoveredId: null, cameraLocked: false };
    hubs.set(context, hub);
  }
  return hub;
}
