/**
 * The camera-loop system: while `scene.cameraLoop` is on, the camera circles
 * the stage centre. It eases in from the free camera and back to the pose the
 * user had before, and never writes loop poses to the store.
 */
import type { AppState, CameraPose } from '../types';
import { LOOP_EASE_SECONDS, advanceLoopAngle, azimuthOf, blendPose, createOrbitPose, ease, loopPose } from './cameraPath';
import type { OrbitPose } from './cameraPath';
import { stageHub } from './hub';
import type { FrameContext, StageSystem, StageSystemFactory } from './system';

function copyPose(pose: CameraPose, out: OrbitPose): void {
  out.px = pose.position[0];
  out.py = pose.position[1];
  out.pz = pose.position[2];
  out.tx = pose.target[0];
  out.ty = pose.target[1];
  out.tz = pose.target[2];
}

/** The camera-loop system factory (see the file comment). */
export const createCameraLoopSystem: StageSystemFactory = (context) => {
  const { camera, cameraTarget } = context;
  const hub = stageHub(context);

  /** The user's own camera, restored when the loop ends. */
  const free = createOrbitPose();
  const loop = createOrbitPose();
  const out = createOrbitPose();

  let on = false;
  /** The loop owns the camera (on, or still easing back). */
  let active = false;
  let blend = 0;
  let angle = 0;

  function applyToCamera(pose: OrbitPose): void {
    camera.position.set(pose.px, pose.py, pose.pz);
    cameraTarget.set(pose.tx, pose.ty, pose.tz);
    camera.up.set(0, 1, 0);
    camera.lookAt(cameraTarget);
  }

  const system: StageSystem = {
    sync(state: AppState, previous: AppState | null) {
      on = state.scene.cameraLoop;
      if (on) hub.cameraLocked = true;
      // A scene was loaded while the loop runs: that becomes the pose to return to.
      if (active && previous && state.camera !== previous.camera) copyPose(state.camera, free);
    },
    update(frame: FrameContext) {
      if (on && !active) {
        active = true;
        blend = 0;
        free.px = camera.position.x;
        free.py = camera.position.y;
        free.pz = camera.position.z;
        free.tx = cameraTarget.x;
        free.ty = cameraTarget.y;
        free.tz = cameraTarget.z;
        // Start on the side of the stage the camera is already on.
        angle = azimuthOf(free.px, free.pz);
      }
      if (!active) {
        // Switched on and off again between two frames.
        if (hub.cameraLocked) hub.cameraLocked = false;
        return;
      }

      const delta = frame.clock.delta > 0 ? Math.min(frame.clock.delta, 0.25) : 0;
      const scene = frame.state.scene;
      blend += ((on ? 1 : -1) * delta) / LOOP_EASE_SECONDS;
      if (on) angle = advanceLoopAngle(angle, delta, scene.cameraLoopPeriod);

      if (!on && blend <= 0) {
        blend = 0;
        active = false;
        hub.cameraLocked = false;
        applyToCamera(free);
        return;
      }
      if (blend > 1) blend = 1;
      hub.cameraLocked = true;
      loopPose(scene, angle, loop);
      applyToCamera(blendPose(free, loop, ease(blend), out));
    },
    dispose() {
      hub.cameraLocked = false;
    },
  };
  return system;
};
