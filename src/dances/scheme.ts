/**
 * PROVISIONAL — the dance agent owns and extends this.
 *
 * A DanceScheme is a JSON-compatible, beat-based description of a looping
 * dance on the canonical skeleton. Schemes are compiled to AnimationClips.
 */
export interface DanceScheme {
  format: 'thunes-dance@1';
  /** Loop length in beats. */
  beats: number;
  /** Native tempo in beats per minute. */
  bpm: number;
}
