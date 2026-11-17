/**
 * Strobe: full-screen white flashes drawn as a DOM overlay above the canvas.
 *
 * Safety rules (hard): nothing flashes unless the viewer has agreed
 * (state.ui.strobeAllowed) AND scene.strobeIntensity > 0, there are never more
 * than three flashes per second (MIN_FLASH_INTERVAL), and the overlay is hidden
 * during capture.
 */
import type { SceneSettings } from '../types';
import type { FrameContext, StageContext, StageSystem } from './system';

/** Seconds a flash takes to fade out completely. */
export const FLASH_DECAY = 0.06;
/**
 * Shortest time between two flash onsets, seconds. A hard safety cap: whatever
 * the settings or the song's tempo, the strobe never exceeds three flashes per
 * second (the general flash threshold used by accessibility guidelines).
 */
export const MIN_FLASH_INTERVAL = 1 / 3;

/** Opacity (0..1) of a flash of the given peak, `age` seconds after its onset. */
export function flashOpacity(peak: number, age: number): number {
  if (!(age >= 0) || age >= FLASH_DECAY) return 0;
  const k = 1 - age / FLASH_DECAY;
  return Math.min(1, Math.max(0, peak)) * k * k;
}

/**
 * The strobe's position in its cycle, in flashes: a flash fires every time the
 * integer part increases. Synced: one flash every `strobeDivision` beats, locked
 * to the beat grid. Free: `strobeBpm` flashes per minute of clock time.
 */
export function strobePhase(
  scene: Pick<SceneSettings, 'strobeSync' | 'strobeDivision' | 'strobeBpm'>,
  time: number,
  beat: number,
): number {
  return scene.strobeSync ? beat / scene.strobeDivision : (time * scene.strobeBpm) / 60;
}

/** Whether the strobe may flash at all. */
export function strobeActive(allowed: boolean, intensity: number): boolean {
  return allowed === true && intensity > 0;
}

export interface StrobeState {
  /** Integer part of the phase at the previous step, or null right after (re)activation. */
  index: number | null;
  /** Clock time of the latest flash onset, or -Infinity. */
  flashAt: number;
}

/** A fresh, idle strobe state. */
export function createStrobeState(): StrobeState {
  return { index: null, flashAt: -Infinity };
}

/**
 * Advance the strobe by one frame and return the overlay opacity (0..1).
 * Mutates `strobe`. Time-based: the result depends on clock time only, not on the frame rate.
 */
export function stepStrobe(
  strobe: StrobeState,
  active: boolean,
  scene: Pick<SceneSettings, 'strobeSync' | 'strobeDivision' | 'strobeBpm' | 'strobeIntensity'>,
  time: number,
  beat: number,
): number {
  if (!active) {
    strobe.index = null;
    strobe.flashAt = -Infinity;
    return 0;
  }
  const index = Math.floor(strobePhase(scene, time, beat));
  if (strobe.index === null) {
    // Just switched on: wait for the next grid point instead of flashing immediately.
    strobe.index = index;
  } else if (index !== strobe.index) {
    strobe.index = index;
    if (time - strobe.flashAt >= MIN_FLASH_INTERVAL) strobe.flashAt = time;
  }
  return flashOpacity(scene.strobeIntensity, time - strobe.flashAt);
}

/** The strobe system: owns the overlay element and drives its opacity every frame. */
export function createStrobeSystem(context: StageContext): StageSystem {
  const overlay = document.createElement('div');
  overlay.dataset.role = 'strobe';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText =
    'position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;display:none;z-index:1;';
  context.container.appendChild(overlay);

  const strobe = createStrobeState();
  let shown = 0;
  let capturing = false;
  let syncMode: boolean | null = null;

  function show(opacity: number): void {
    if (opacity === shown) return;
    if (opacity > 0 && shown === 0) overlay.style.display = 'block';
    else if (opacity === 0) overlay.style.display = 'none';
    overlay.style.opacity = opacity === 0 ? '0' : opacity.toFixed(3);
    shown = opacity;
  }

  return {
    update(frame: FrameContext) {
      const { scene, ui } = frame.state;
      if (scene.strobeSync !== syncMode) {
        // The phase jumps when the timing source changes: re-arm instead of flashing on the jump.
        syncMode = scene.strobeSync;
        strobe.index = null;
      }
      const active = strobeActive(ui.strobeAllowed, scene.strobeIntensity);
      const opacity = stepStrobe(strobe, active, scene, frame.clock.time, frame.clock.beat);
      show(capturing ? 0 : opacity);
    },
    beforeCapture() {
      capturing = true;
      overlay.style.visibility = 'hidden';
    },
    afterCapture() {
      capturing = false;
      overlay.style.visibility = '';
    },
    dispose() {
      overlay.remove();
    },
  };
}
