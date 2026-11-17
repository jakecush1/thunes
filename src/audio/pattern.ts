/**
 * PROVISIONAL — the audio agent owns and extends this.
 *
 * A SongPattern is a JSON-compatible description of a looping, synthesised
 * song. Patterns are rendered to audio buffers in the browser.
 */
export interface SongPattern {
  format: 'thunes-song@1';
  /** Tempo in beats per minute. */
  bpm: number;
  /** Loop length in bars of four beats. */
  bars: number;
}
