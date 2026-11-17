/**
 * Bootstrap: build the services, load the first scene and start rendering.
 * Everything is also exposed on `window.__thunes` for the console and tests.
 */
import { createAppRegistry } from './assets';
import { createAudioEngine } from './audio/engine';
import { AUDIO_DEFAULTS, UI_DEFAULTS } from './config';
import { createSceneLibrary } from './core/library';
import { loadPrefs, savePrefs } from './core/prefs';
import { readShareUrl } from './core/serialize';
import { starterDocument } from './core/starter';
import { createStore } from './core/store';
import { createCameraLoopSystem } from './stage/cameraLoop';
import { createDancerSystem } from './stage/dancers';
import { createInteractionSystem } from './stage/interaction';
import { createStage } from './stage/stage';
import { createThumbnailer } from './stage/thumbnails';
import type { AppServices, SceneDocument } from './types';
import { mountUi } from './ui/app';

/** Debug/test handle. Lab pages declare their own shape for `window.__thunes`, so this stays untyped here. */
function expose(value: Record<string, unknown>): void {
  (window as unknown as { __thunes?: Record<string, unknown> }).__thunes = value;
}

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app element.');
  const stageHost = document.createElement('div');
  stageHost.className = 'stage-host';
  const uiHost = document.createElement('div');
  uiHost.className = 'ui-host';
  app.append(stageHost, uiHost);

  const prefs = loadPrefs();
  const store = createStore({
    initial: {
      ui: { ...UI_DEFAULTS, mode: prefs.mode, quality: prefs.quality },
      audio: { ...AUDIO_DEFAULTS, volume: prefs.volume, muted: prefs.muted },
    },
  });

  // A shared link wins over the starter scene; a broken link falls back to it.
  let shared: SceneDocument | null = null;
  let shareError: string | null = null;
  try {
    shared = await readShareUrl(window.location.href);
  } catch (error) {
    shareError = error instanceof Error ? error.message : String(error);
  }
  store.loadDocument(shared ?? starterDocument(window.innerHeight > window.innerWidth * 1.2));
  if (shared) store.updateUi({ viewOnly: true });

  const registry = createAppRegistry();
  const audio = createAudioEngine(registry);
  const stage = createStage(
    { container: stageHost, store, registry, audio },
    { systems: [createDancerSystem, createInteractionSystem, createCameraLoopSystem] },
  );
  const thumbnails = createThumbnailer({ registry });
  const library = createSceneLibrary();

  audio.sync(store.getState().audio);
  store.subscribe((state, previous) => {
    if (state.audio !== previous.audio) {
      audio.sync(state.audio);
      if (state.audio.volume !== previous.audio.volume || state.audio.muted !== previous.audio.muted) {
        savePrefs({ volume: state.audio.volume, muted: state.audio.muted });
      }
    }
    if (state.ui.mode !== previous.ui.mode || state.ui.quality !== previous.ui.quality) {
      savePrefs({ mode: state.ui.mode, quality: state.ui.quality });
    }
  });

  const services: AppServices = {
    store,
    registry,
    audio,
    stage,
    thumbnails,
    library,
    startup: { sharedScene: shared !== null, shareError },
  };
  mountUi(uiHost, services);
  stage.start();

  expose({ ready: true, ...services });
}

boot().catch((error: unknown) => {
  console.error(error);
  expose({ ready: false, error: error instanceof Error ? error.message : String(error) });
  const app = document.getElementById('app');
  if (app) {
    const message = document.createElement('p');
    message.className = 'boot-error';
    message.textContent = 'Thunes could not start. Reload the page, or try a browser with WebGL 2 enabled.';
    app.replaceChildren(message);
  }
});
