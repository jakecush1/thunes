/** The scene a first-time visitor lands on: a small crew already dancing. */
import type { SceneDocument } from '../types';
import { defaultDancer, emptyDocument } from './serialize';

/**
 * @param portrait pass true on tall screens: the camera starts further back so the whole crew fits the narrow view.
 */
export function starterDocument(portrait = false): SceneDocument {
  const document = emptyDocument();
  if (portrait) document.camera = { position: [0, 2.6, 14], target: [0, 1, 0] };
  document.dancers = [
    { ...defaultDancer('d1', 'builtin:mannequin', 'builtin:groove'), x: -0.7, z: 0.2 },
    { ...defaultDancer('d2', 'builtin:toy', 'builtin:hands-up'), x: 0.7, z: 0.2 },
    { ...defaultDancer('d3', 'builtin:robot', 'builtin:robot'), x: -2.1, z: -0.6, rotation: 14 },
    { ...defaultDancer('d4', 'builtin:lanky', 'builtin:disco-point'), x: 2.1, z: -0.6, rotation: -14 },
  ];
  return document;
}
