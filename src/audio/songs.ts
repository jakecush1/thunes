/**
 * The built-in placeholder songs: six original loops written as SongPattern
 * data and synthesised in the browser. See pattern.ts for the format.
 */

import type { SongDef } from '../types';
import type { SongPattern } from './pattern';

const FOUR_ON_FLOOR = 'x...x...x...x...';
const BACKBEAT = '....x.......x...';
const OFFBEATS = '..x...x...x...x.';
const SILENT = '................';

/** Synthwave, A minor: Am F C G, then F G Em Am with the lead on top. */
const nightDrive: SongPattern = {
  format: 'thunes-song@1',
  bpm: 104,
  bars: 16,
  seed: 1987,
  tracks: {
    kick: { kind: 'kick', tone: 0.4, decay: 1.1 },
    snare: { kind: 'snare', gain: 0.95, decay: 1.6, tone: 0.45, reverb: 0.4 },
    hat: { kind: 'hat', gain: 0.5, pan: 0.2 },
    openhat: { kind: 'openhat', gain: 0.4, pan: -0.2 },
    tom: { kind: 'perc', variant: 'tom', gain: 0.75, reverb: 0.3, pan: -0.25 },
    bass: { kind: 'bass', cutoff: 260, envAmount: 2.2, duck: 0.6 },
    pad: { kind: 'pad', low: 'C3', cutoff: 1100, duck: 0.5, reverb: 0.3, gain: 0.9 },
    arp: { kind: 'pluck', low: 'F3', delay: 0.35, reverb: 0.15, pan: -0.15, gain: 0.8, duck: 0.2 },
    lead: { kind: 'lead', wave: 'saw', voices: 3, detune: 12, cutoff: 2200, delay: 0.3, reverb: 0.3, gain: 0.9 },
  },
  sections: {
    A: {
      bars: 4,
      chords: ['Am', 'F', 'C', 'G'],
      parts: {
        kick: FOUR_ON_FLOOR,
        snare: '....X.......X...',
        hat: 'x.o.x.o.x.o.x.o.',
        bass: { steps: 'X.x.x.x.X.x.x.x.', pitches: ['1', '1', '1+', '1', '1', '1', '1+', '5'], gate: 1.6 },
        pad: { bar: [[0, 'chord', 16, 0.7]] },
        arp: { steps: 'x.7.x.7.x.7.x.7.', pitches: ['1', '3', '5', '1+', '5', '3', '5', '1+'], gate: 1.5 },
      },
    },
    A2: {
      extends: 'A',
      parts: {
        kick: [FOUR_ON_FLOOR, FOUR_ON_FLOOR, FOUR_ON_FLOOR, 'x...x...x...x.x.'],
        openhat: [SILENT, '..............x.', SILENT, '..............x.'],
        tom: [SILENT, SILENT, SILENT, '..........7.8.9X'],
        arp: { steps: 'x.7.x.7.x.7.x.77', pitches: ['1+', '5', '3', '5', '1+', '5', '3+', '1+', '5'], gate: 1.5 },
      },
    },
    B: {
      bars: 4,
      chords: ['F', 'G', 'Em', 'Am'],
      parts: {
        kick: FOUR_ON_FLOOR,
        snare: '....X.......X...',
        hat: 'x.o.x.o.x.o.x.oo',
        openhat: OFFBEATS.replace(/x/g, '5'),
        bass: { steps: 'X.x.x.x.X.x.x.x.', pitches: ['1', '1', '1+', '1', '1', '1', '1+', '5'], gate: 1.6 },
        pad: { bar: [[0, 'chord', 16, 0.75]] },
        arp: { steps: 'o.o.o.o.o.o.o.o.', pitches: ['1', '5', '1+', '5'], gate: 1.5 },
        lead: {
          notes: [
            [0, 'C5', 6], [6, 'A4', 2], [8, 'C5', 4], [12, 'D5', 4],
            [16, 'D5', 6], [22, 'B4', 2], [24, 'D5', 4], [28, 'E5', 4],
            [32, 'E5', 8], [40, 'D5', 4], [44, 'B4', 4],
            [48, 'C5', 6], [54, 'B4', 2], [56, 'A4', 8],
          ],
        },
      },
    },
    B2: {
      extends: 'B',
      parts: {
        kick: [FOUR_ON_FLOOR, FOUR_ON_FLOOR, FOUR_ON_FLOOR, 'x...x...x...x..x'],
        snare: ['....X.......X...', '....X.......X...', '....X.......X...', '....X.......X.x.'],
        tom: [SILENT, SILENT, SILENT, '........6.7.8.9X'],
        lead: {
          notes: [
            [0, 'A4', 4], [4, 'C5', 4], [8, 'F5', 6], [14, 'E5', 2],
            [16, 'D5', 8], [24, 'B4', 4], [28, 'D5', 4],
            [32, 'E5', 6], [38, 'G5', 2], [40, 'E5', 4], [44, 'D5', 4],
            [48, 'C5', 4], [52, 'B4', 4], [56, 'A4', 8],
          ],
        },
      },
    },
  },
  arrangement: ['A', 'A2', 'B', 'B2'],
  effects: { delay: { steps: 3, feedback: 0.45 }, reverb: { seconds: 2.4, tone: 5500 }, duck: { depth: 0.6, release: 0.8 } },
};

/** Disco-funk, B minor / D major: Em7 A7 Dmaj7 Bm7 with an octave bass and chord chops. */
const mirrorball: SongPattern = {
  format: 'thunes-song@1',
  bpm: 114,
  bars: 16,
  swing: 0.12,
  seed: 1977,
  tracks: {
    kick: { kind: 'kick', tone: 0.6, decay: 0.8 },
    clap: { kind: 'clap', gain: 0.9, reverb: 0.2 },
    snare: { kind: 'snare', gain: 0.5, tone: 0.6 },
    hat: { kind: 'hat', gain: 0.62, pan: 0.25 },
    openhat: { kind: 'openhat', gain: 0.58, pan: 0.25, decay: 0.8 },
    conga: { kind: 'perc', variant: 'conga', gain: 0.6, pan: -0.35, reverb: 0.15 },
    congaHigh: { kind: 'perc', variant: 'conga', tune: 5, gain: 0.5, pan: -0.2, reverb: 0.15 },
    tamb: { kind: 'perc', variant: 'tamb', gain: 0.35, pan: -0.3 },
    bass: { kind: 'bass', cutoff: 380, envAmount: 2.8, envDecay: 0.12, sustain: 0.5, sub: 0.45, duck: 0.35 },
    chops: {
      kind: 'pluck', wave: 'square', low: 'D4', cutoff: 900, envAmount: 2.4, decay: 0.12, sustain: 0.1, release: 0.06,
      pan: 0.3, gain: 0.85, reverb: 0.1,
    },
    strings: { kind: 'pad', low: 'A3', cutoff: 2400, attack: 0.15, release: 0.4, gain: 0.6, reverb: 0.35, duck: 0.3 },
    bell: { kind: 'keys', fmRatio: 2, fmAmount: 1.6, low: 'E4', delay: 0.25, reverb: 0.3, gain: 0.9 },
  },
  sections: {
    A: {
      bars: 4,
      chords: ['Em7', 'A7', 'Dmaj7', 'Bm7'],
      parts: {
        kick: FOUR_ON_FLOOR,
        clap: BACKBEAT,
        snare: '....x.......x..o',
        hat: 'x..ox..ox..ox..o',
        openhat: OFFBEATS,
        conga: '..o..x....o..x..',
        congaHigh: '.......o.......x',
        bass: { steps: 'X..ox.x.X..ox.ox', pitches: ['1', '1', '1+', '1', '1', '1', '1+', '5', '7'], gate: 1 },
        chops: { steps: '..x.o..x..x.o..x', pitches: ['chord'], gate: 0.8 },
        strings: { bar: [[0, 'chord', 16, 0.6]] },
      },
    },
    A2: {
      extends: 'A',
      parts: {
        kick: [FOUR_ON_FLOOR, FOUR_ON_FLOOR, FOUR_ON_FLOOR, 'x...x...x...x..x'],
        snare: ['....x.......x..o', '....x.......x..o', '....x.......x..o', '....x.......x.xx'],
        tamb: 'o.x.o.x.o.x.o.x.',
        bell: { notes: [[8, 'B4', 2], [11, 'D5', 2], [14, 'E5', 4], [40, 'F#5', 2], [43, 'D5', 2], [46, 'A4', 4]] },
      },
    },
    B: {
      bars: 4,
      chords: ['Gmaj7', 'A7', 'F#m7', 'Bm7'],
      parts: {
        kick: FOUR_ON_FLOOR,
        clap: BACKBEAT,
        snare: '....x.......x..o',
        hat: 'x..ox..ox..ox..o',
        openhat: OFFBEATS,
        tamb: 'o.x.o.x.o.x.o.x.',
        conga: '..o..x....o..x..',
        congaHigh: '.......o.......x',
        bass: { steps: 'X..ox.x.X..ox.ox', pitches: ['1', '1', '1+', '1', '1', '1', '1+', '5', '7'], gate: 1 },
        chops: { steps: '..x.o..x..x.o..x', pitches: ['chord'], gate: 0.8 },
        strings: { bar: [[0, 'chord', 16, 0.7]] },
        bell: {
          notes: [
            [0, 'F#5', 3], [3, 'D5', 3], [6, 'B4', 2], [10, 'D5', 2], [12, 'F#5', 4],
            [16, 'E5', 3], [19, 'C#5', 3], [22, 'A4', 2], [26, 'C#5', 2], [28, 'E5', 4],
            [32, 'C#5', 3], [35, 'A4', 3], [38, 'F#4', 2], [42, 'A4', 2], [44, 'C#5', 4],
            [48, 'D5', 6], [54, 'F#5', 2], [56, 'B4', 8],
          ],
        },
      },
    },
    B2: {
      extends: 'B',
      parts: {
        kick: [FOUR_ON_FLOOR, FOUR_ON_FLOOR, FOUR_ON_FLOOR, 'x...x...x.x.x..x'],
        snare: ['....x.......x..o', '....x.......x..o', '....x.......x..o', '....x.....o.x.xX'],
        congaHigh: ['.......o.......x', '.......o.......x', '.......o.......x', '.......o..x.x.xx'],
        bell: {
          notes: [
            [0, 'F#5', 3], [3, 'D5', 3], [6, 'B4', 2], [10, 'D5', 2], [12, 'F#5', 4],
            [16, 'E5', 3], [19, 'C#5', 3], [22, 'A4', 2], [26, 'C#5', 2], [28, 'G5', 4],
            [32, 'F#5', 3], [35, 'C#5', 3], [38, 'A4', 2], [42, 'C#5', 2], [44, 'E5', 4],
            [48, 'D5', 4], [52, 'F#5', 4], [56, 'B5', 6],
          ],
        },
      },
    },
  },
  arrangement: ['A', 'A2', 'B', 'B2'],
  effects: { delay: { steps: 3, feedback: 0.3 }, reverb: { seconds: 1.5, tone: 7000 }, duck: { depth: 0.5, release: 0.5 } },
};

/** House, C minor: Cm7 Abmaj7 Fm7 Gm7 with organ-style stabs and an off-beat bass. */
const glassBalcony: SongPattern = {
  format: 'thunes-song@1',
  bpm: 124,
  bars: 16,
  seed: 2024,
  tracks: {
    kick: { kind: 'kick', tone: 0.5, decay: 0.9 },
    clap: { kind: 'clap', gain: 1.05, reverb: 0.25 },
    hat: { kind: 'hat', gain: 0.6, pan: -0.15 },
    openhat: { kind: 'openhat', gain: 0.65, decay: 0.9, pan: 0.15 },
    shaker: { kind: 'perc', variant: 'shaker', gain: 0.78, pan: 0.3 },
    rim: { kind: 'perc', variant: 'rim', gain: 0.5, pan: -0.3, reverb: 0.25, delay: 0.15 },
    bass: { kind: 'bass', wave: 'square', cutoff: 190, envAmount: 1.6, sub: 0.6, duck: 0.7 },
    stab: {
      kind: 'keys', low: 'G3', fmAmount: 3, decay: 0.5, sustain: 0.2, release: 0.25,
      delay: 0.3, reverb: 0.3, gain: 1.25, duck: 0.3,
    },
    pad: { kind: 'pad', low: 'C4', cutoff: 2000, gain: 0.75, reverb: 0.4, duck: 0.7 },
    lead: { kind: 'pluck', wave: 'saw', voices: 2, detune: 6, cutoff: 1800, envAmount: 2, sustain: 0.35, delay: 0.4, reverb: 0.3, gain: 1.35 },
  },
  sections: {
    A: {
      bars: 4,
      chords: ['Cm7', 'Abmaj7', 'Fm7', 'Gm7'],
      parts: {
        kick: FOUR_ON_FLOOR,
        clap: BACKBEAT,
        openhat: OFFBEATS,
        hat: '...o...o...o...o',
        shaker: '5o7o5o7o5o7o5o7o',
        rim: ['..........x..x..', '......x......x.x'],
        bass: { steps: '..x...x...xx..x.', pitches: ['1', '1', '1', '1+', '1'], gate: 1.5 },
        stab: { steps: 'X..x..x...o..x..', pitches: ['chord'], gate: 2 },
        pad: { bar: [[0, 'chord', 16, 0.6]] },
      },
    },
    A2: {
      extends: 'A',
      parts: {
        kick: [FOUR_ON_FLOOR, FOUR_ON_FLOOR, FOUR_ON_FLOOR, 'x...x...x...x.x.'],
        clap: [BACKBEAT, BACKBEAT, BACKBEAT, '....x.......x.xx'],
        lead: { notes: [[22, 'Eb5', 2], [25, 'C5', 2], [28, 'Ab4', 4], [54, 'D5', 2], [57, 'Bb4', 2], [60, 'G4', 4]] },
      },
    },
    B: {
      bars: 4,
      chords: ['Abmaj7', 'Bb', 'Gm7', 'Cm7'],
      parts: {
        kick: FOUR_ON_FLOOR,
        clap: BACKBEAT,
        openhat: OFFBEATS,
        hat: '.o.o.o.o.o.o.o.o',
        shaker: '5o7o5o7o5o7o5o7o',
        bass: { steps: '..x..x..x.x...x.', pitches: ['1', '1', '1', '1+', '5'], gate: 1.5 },
        stab: { steps: 'X..x..x...o..x..', pitches: ['chord'], gate: 2 },
        pad: { bar: [[0, 'chord', 16, 0.7]] },
        lead: {
          notes: [
            [0, 'G4', 3], [3, 'C5', 3], [6, 'Eb5', 4], [12, 'C5', 2], [14, 'Eb5', 2],
            [16, 'D5', 3], [19, 'Bb4', 3], [22, 'D5', 4], [28, 'F5', 4],
            [32, 'D5', 3], [35, 'Bb4', 3], [38, 'G4', 4], [44, 'Bb4', 2], [46, 'D5', 2],
            [48, 'Eb5', 3], [51, 'D5', 3], [54, 'C5', 10],
          ],
        },
      },
    },
    B2: {
      extends: 'B',
      parts: {
        kick: [FOUR_ON_FLOOR, FOUR_ON_FLOOR, FOUR_ON_FLOOR, 'x...x...x.......'],
        clap: [BACKBEAT, BACKBEAT, BACKBEAT, '....x.......x..x'],
        rim: [SILENT, SILENT, SILENT, '..........x.xx.x'],
        lead: {
          notes: [
            [0, 'G4', 3], [3, 'C5', 3], [6, 'Eb5', 4], [12, 'C5', 2], [14, 'Eb5', 2],
            [16, 'D5', 3], [19, 'Bb4', 3], [22, 'D5', 4], [28, 'F5', 4],
            [32, 'G5', 3], [35, 'F5', 3], [38, 'D5', 4], [44, 'Bb4', 2], [46, 'D5', 2],
            [48, 'G5', 3], [51, 'Eb5', 3], [54, 'C5', 10],
          ],
        },
      },
    },
  },
  arrangement: ['A', 'A2', 'B', 'B2'],
  effects: { delay: { steps: 3, feedback: 0.4 }, reverb: { seconds: 1.9 }, duck: { depth: 0.65, release: 0.7 } },
};

/** Electro, F minor: a broken beat with a squelchy bass riff, then a four-on-the-floor lift. */
const laserPicnic: SongPattern = {
  format: 'thunes-song@1',
  bpm: 128,
  bars: 16,
  seed: 808,
  tracks: {
    kick: { kind: 'kick', tone: 0.8, decay: 0.8, tune: 0 },
    snare: { kind: 'snare', tone: 0.8, gain: 0.9, decay: 0.8, reverb: 0.15 },
    clap: { kind: 'clap', gain: 0.55, reverb: 0.2 },
    hat: { kind: 'hat', gain: 0.45, tone: 0.7, pan: 0.2 },
    openhat: { kind: 'openhat', gain: 0.4, pan: 0.2 },
    cowbell: { kind: 'perc', variant: 'cowbell', gain: 0.45, pan: -0.3, delay: 0.15 },
    bass: {
      kind: 'bass', cutoff: 300, resonance: 4.5, envAmount: 3, envDecay: 0.1, sustain: 0.5, sub: 0.5, duck: 0.4,
    },
    zap: {
      kind: 'lead', wave: 'square', voices: 1, cutoff: 2500, vibrato: 0, attack: 0.003, sustain: 0.6, release: 0.08,
      delay: 0.3, reverb: 0.15, pan: 0.1,
    },
    pad: { kind: 'pad', low: 'F3', cutoff: 800, gain: 0.7, duck: 0.6, reverb: 0.3 },
    arp: { kind: 'pluck', wave: 'square', low: 'F4', delay: 0.3, reverb: 0.15, gain: 0.6, pan: -0.2 },
    lead: { kind: 'lead', wave: 'saw', voices: 2, cutoff: 2600, delay: 0.25, reverb: 0.3, gain: 0.9 },
  },
  sections: {
    A: {
      bars: 4,
      chords: ['Fm', 'Fm', 'Db', 'Eb'],
      parts: {
        kick: ['x.....x...x.....', 'x..x..x...x...x.'],
        snare: '....X.......X...',
        hat: 'x5o5x5o5x5o5x5o5',
        openhat: [SILENT, '..............x.'],
        bass: { steps: 'X..x..x.X..x.xo.', pitches: ['1', '1', '1+', '1', '7', '1+', '5'], gate: 1.2 },
        pad: { bar: [[0, 'chord', 16, 0.5]] },
      },
    },
    A2: {
      extends: 'A',
      parts: {
        cowbell: ['...x..x......x..', '...x..x....x.x..'],
        snare: ['....X.......X...', '....X.......X...', '....X.......X...', '....X.......X.xx'],
        zap: {
          notes: [
            [0, 'F4', 2], [2, 'F4', 1], [4, 'Ab4', 2], [6, 'F4', 2], [10, 'C5', 2], [12, 'Bb4', 2], [14, 'Ab4', 2],
            [16, 'F4', 2], [18, 'F4', 1], [20, 'Ab4', 2], [22, 'Bb4', 4],
            [32, 'Ab4', 2], [34, 'Ab4', 1], [36, 'Db5', 2], [38, 'Ab4', 2], [42, 'F5', 2], [44, 'Eb5', 2], [46, 'Db5', 2],
            [48, 'Eb5', 2], [50, 'Eb5', 1], [52, 'Bb4', 2], [54, 'C5', 4], [60, 'Eb5', 4],
          ],
        },
      },
    },
    B: {
      bars: 4,
      chords: ['Bbm', 'Db', 'Eb', 'Fm'],
      parts: {
        kick: FOUR_ON_FLOOR,
        clap: BACKBEAT,
        snare: '....x.......x...',
        hat: 'x5o5x5o5x5o5x5o5',
        openhat: OFFBEATS,
        bass: { steps: 'X.xx.x.xX.xx.x.x', pitches: ['1', '1', '1+', '1', '1', '1', '1', '1+', '1', '5'], gate: 1 },
        pad: { bar: [[0, 'chord', 16, 0.65]] },
        arp: { steps: 'x.7xx.7xx.7xx.7x', pitches: ['1', '5', '1+', '3+', '5', '1+', '3+', '5', '1+', '5', '3+', '1+'], gate: 0.9 },
        lead: {
          notes: [
            [0, 'F5', 6], [6, 'Db5', 2], [8, 'F5', 8],
            [16, 'Ab5', 6], [22, 'F5', 2], [24, 'Ab5', 8],
            [32, 'G5', 6], [38, 'Eb5', 2], [40, 'Bb5', 8],
            [48, 'Ab5', 4], [52, 'G5', 4], [56, 'F5', 8],
          ],
        },
      },
    },
    B2: {
      extends: 'B',
      parts: {
        kick: [FOUR_ON_FLOOR, FOUR_ON_FLOOR, FOUR_ON_FLOOR, 'x...x...x..x..x.'],
        snare: ['....x.......x...', '....x.......x...', '....x.......x...', '....x...5.6.789X'],
        cowbell: '...x..x......x..',
        lead: {
          notes: [
            [0, 'F5', 6], [6, 'Db5', 2], [8, 'Bb5', 8],
            [16, 'Ab5', 6], [22, 'F5', 2], [24, 'Db6', 8],
            [32, 'Bb5', 6], [38, 'G5', 2], [40, 'Eb5', 8],
            [48, 'F5', 4], [52, 'Ab5', 4], [56, 'C6', 4], [60, 'Ab5', 4],
          ],
        },
      },
    },
  },
  arrangement: ['A', 'A2', 'B', 'B2'],
  effects: { delay: { steps: 3, feedback: 0.4, tone: 3000 }, reverb: { seconds: 1.4 }, duck: { depth: 0.55, release: 0.6 } },
};

/** Lo-fi hip-hop, D major: Dmaj7 Bm7 Em9 A7 on electric piano over a swung, dusty beat. */
const rainyWindow: SongPattern = {
  format: 'thunes-song@1',
  bpm: 90,
  bars: 16,
  swing: 0.55,
  seed: 1994,
  tracks: {
    kick: { kind: 'kick', tone: 0.25, decay: 1.2, tune: -1, gain: 0.9 },
    snare: { kind: 'snare', tone: 0.3, decay: 0.9, gain: 1.05, tune: -2, reverb: 0.2, humanize: 0.15 },
    rim: { kind: 'perc', variant: 'rim', gain: 0.4, pan: -0.3, reverb: 0.25 },
    hat: { kind: 'hat', gain: 0.48, tone: 0.15, decay: 1.3, pan: 0.15, humanize: 0.25 },
    shaker: { kind: 'perc', variant: 'shaker', gain: 0.25, tone: 0.1, pan: -0.2, humanize: 0.3 },
    bass: {
      kind: 'bass', wave: 'triangle', cutoff: 420, envAmount: 0.8, sub: 0.5, sustain: 0.8, release: 0.1, duck: 0.3, gain: 0.9,
    },
    keys: {
      kind: 'keys', low: 'F#3', fmAmount: 2.1, cutoff: 2600, vibrato: 7, vibratoRate: 0.7, decay: 1.2, sustain: 0.3,
      gain: 1.3, reverb: 0.3, duck: 0.25,
    },
    lead: {
      kind: 'lead', wave: 'triangle', voices: 1, cutoff: 1900, attack: 0.02, vibrato: 8, delay: 0.25, reverb: 0.35,
      gain: 1.3, pan: 0.1,
    },
  },
  sections: {
    A: {
      bars: 4,
      chords: ['Dmaj7', 'Bm7', 'Em9', 'A7'],
      parts: {
        kick: ['X.....x...x.....', 'X......x.xx.....'],
        snare: '....X..o....X...',
        hat: 'x.o.x.o.x.o.x.oo',
        bass: { bar: [[0, '1', 6], [10, '1', 3, 0.7], [14, '5', 2, 0.6]] },
        keys: { bar: [[0, 'chord', 6, 0.7], [7, 'chord', 2, 0.45], [10, 'chord', 5, 0.6]] },
        lead: { notes: [[24, 'F#5', 2, 0.5], [26, 'D5', 4, 0.5], [56, 'E5', 2, 0.5], [58, 'C#5', 4, 0.5]] },
      },
    },
    A2: {
      extends: 'A',
      parts: {
        shaker: '..o...o...o...o.',
        rim: [SILENT, '..........x..x..', SILENT, '......x...x..x.x'],
        snare: ['....X..o....X...', '....X..o....X...', '....X..o....X...', '....X..o....X.oo'],
        lead: { notes: [[8, 'A4', 2, 0.5], [10, 'D5', 4, 0.5], [24, 'F#5', 2, 0.5], [26, 'D5', 4, 0.5], [40, 'B4', 2, 0.5], [42, 'F#5', 4, 0.5], [56, 'E5', 2, 0.5], [58, 'C#5', 4, 0.5]] },
      },
    },
    B: {
      bars: 4,
      chords: ['Gmaj7', 'F#m7', 'Em9', 'A7'],
      parts: {
        kick: ['X.....x...x.....', 'X......x.xx.....'],
        snare: '....X..o....X...',
        hat: 'x.o.x.o.x.o.x.oo',
        shaker: '..o...o...o...o.',
        bass: { bar: [[0, '1', 6], [10, '1', 3, 0.7], [14, '5', 2, 0.6]] },
        keys: { bar: [[0, 'chord', 6, 0.7], [7, 'chord', 2, 0.45], [10, 'chord', 5, 0.6]] },
        lead: {
          notes: [
            [2, 'B4', 2], [4, 'D5', 4], [8, 'B4', 2], [10, 'A4', 6],
            [18, 'A4', 2], [20, 'C#5', 4], [24, 'A4', 2], [26, 'F#4', 6],
            [34, 'G4', 2], [36, 'B4', 4], [40, 'D5', 2], [42, 'F#5', 6],
            [50, 'E5', 2], [52, 'C#5', 4], [56, 'A4', 2], [58, 'E4', 6],
          ],
        },
      },
    },
    B2: {
      extends: 'B',
      parts: {
        rim: [SILENT, '..........x..x..', SILENT, '..........x..x..'],
        snare: ['....X..o....X...', '....X..o....X...', '....X..o....X...', '....X..o..o.X.xx'],
        kick: ['X.....x...x.....', 'X......x.xx.....', 'X.....x...x.....', 'X......x.x......'],
        lead: {
          notes: [
            [2, 'B4', 2], [4, 'D5', 4], [8, 'F#5', 2], [10, 'E5', 6],
            [18, 'A4', 2], [20, 'C#5', 4], [24, 'E5', 2], [26, 'C#5', 6],
            [34, 'G4', 2], [36, 'B4', 4], [40, 'D5', 2], [42, 'F#5', 6],
            [50, 'G5', 2], [52, 'E5', 4], [56, 'C#5', 2], [58, 'A4', 6],
          ],
        },
      },
    },
  },
  arrangement: ['A', 'A2', 'B', 'B2'],
  effects: { delay: { steps: 4, feedback: 0.3, tone: 2200 }, reverb: { seconds: 1.6, tone: 4000 }, duck: { depth: 0.45, release: 0.6 } },
};

/** Trance-pop, F# minor: F#m D A E with a rolling bass, pumping pads and a soaring lead. */
const auroraSprint: SongPattern = {
  format: 'thunes-song@1',
  bpm: 138,
  bars: 16,
  seed: 1999,
  tracks: {
    kick: { kind: 'kick', tone: 0.6, decay: 0.8 },
    clap: { kind: 'clap', gain: 0.7, reverb: 0.3 },
    snare: { kind: 'snare', gain: 0.6, tone: 0.7, reverb: 0.2 },
    hat: { kind: 'hat', gain: 0.4, pan: 0.2 },
    openhat: { kind: 'openhat', gain: 0.5, pan: -0.1 },
    bass: {
      kind: 'bass', cutoff: 430, envAmount: 2, envDecay: 0.1, sustain: 0.6, sub: 0.45, release: 0.04, duck: 0.8,
    },
    pad: {
      kind: 'pad', voices: 5, detune: 20, low: 'A3', cutoff: 2600, attack: 0.05, release: 0.3, gain: 0.9, duck: 0.85,
      reverb: 0.35,
    },
    arp: { kind: 'pluck', low: 'F#4', delay: 0.35, reverb: 0.2, gain: 0.7, duck: 0.3, pan: 0.15 },
    lead: { kind: 'lead', wave: 'saw', voices: 3, detune: 14, cutoff: 3000, delay: 0.3, reverb: 0.35, gain: 0.95 },
  },
  sections: {
    A: {
      bars: 4,
      chords: ['F#m', 'D', 'A', 'E'],
      parts: {
        kick: FOUR_ON_FLOOR,
        clap: BACKBEAT,
        openhat: OFFBEATS,
        hat: 'o..oo..oo..oo..o',
        bass: { steps: '.7x8.7x8.7x8.7x8', pitches: ['1'], gate: 0.8 },
        pad: { bar: [[0, 'chord', 16, 0.7]] },
        arp: { steps: 'x6x6x6x6x6x6x6x6', pitches: ['1', '5', '1+', '5', '3+', '5', '1+', '5'], gate: 0.8 },
      },
    },
    A2: {
      extends: 'A',
      parts: {
        kick: [FOUR_ON_FLOOR, FOUR_ON_FLOOR, FOUR_ON_FLOOR, 'x...x...x.......'],
        snare: [SILENT, SILENT, SILENT, '....3...4.5.6789'],
        arp: { steps: 'x6x6x6x6x6x6x6x6', pitches: ['1+', '5', '3+', '5', '5+', '3+', '1+', '5'], gate: 0.8 },
      },
    },
    B: {
      bars: 4,
      chords: ['D', 'E', 'F#m', 'C#m'],
      parts: {
        kick: FOUR_ON_FLOOR,
        clap: BACKBEAT,
        openhat: OFFBEATS,
        hat: 'o.ooo.ooo.ooo.oo',
        bass: { steps: '.7x8.7x8.7x8.7x8', pitches: ['1'], gate: 0.8 },
        pad: { steps: 'X..x..x.X..x..x.', pitches: ['chord'], gate: 2.2 },
        arp: { steps: 'o.o.o.o.o.o.o.o.', pitches: ['1+', '5', '3+', '5'], gate: 0.8 },
        lead: {
          notes: [
            [0, 'F#5', 6], [6, 'A5', 2], [8, 'F#5', 4], [12, 'D5', 4],
            [16, 'E5', 6], [22, 'G#5', 2], [24, 'B5', 4], [28, 'G#5', 4],
            [32, 'A5', 6], [38, 'F#5', 2], [40, 'C#5', 4], [44, 'F#5', 4],
            [48, 'E5', 6], [54, 'G#5', 2], [56, 'E5', 8],
          ],
        },
      },
    },
    B2: {
      extends: 'B',
      parts: {
        kick: [FOUR_ON_FLOOR, FOUR_ON_FLOOR, FOUR_ON_FLOOR, 'x...x...x...x.x.'],
        snare: [SILENT, SILENT, SILENT, '........3.4.5678'],
        lead: {
          notes: [
            [0, 'A5', 6], [6, 'F#5', 2], [8, 'D5', 4], [12, 'F#5', 4],
            [16, 'B5', 6], [22, 'G#5', 2], [24, 'E5', 4], [28, 'G#5', 4],
            [32, 'A5', 4], [36, 'C#6', 4], [40, 'A5', 4], [44, 'F#5', 4],
            [48, 'G#5', 8], [56, 'E5', 4], [60, 'G#5', 4],
          ],
        },
      },
    },
  },
  arrangement: ['A', 'A2', 'B', 'B2'],
  effects: { delay: { steps: 3, feedback: 0.45 }, reverb: { seconds: 2.2 }, duck: { depth: 0.7, release: 0.8 } },
};

function builtin(slug: string, title: string, vibe: string, pattern: SongPattern): SongDef {
  return {
    id: `builtin:${slug}`,
    source: 'builtin',
    category: 'Built-in',
    title,
    artist: 'Thunes',
    vibe,
    bpm: pattern.bpm,
    duration: (pattern.bars * 4 * 60) / pattern.bpm,
    pattern,
  };
}

/** The placeholder songs, in list order. 'builtin:night-drive' is the app's default song. */
export const BUILTIN_SONGS: SongDef[] = [
  builtin('night-drive', 'Neon Night Drive', 'Synthwave', nightDrive),
  builtin('mirrorball-lemonade', 'Mirrorball Lemonade', 'Disco-funk', mirrorball),
  builtin('glass-balcony', 'Glass Balcony', 'House', glassBalcony),
  builtin('laser-picnic', 'Laser Picnic', 'Electro', laserPicnic),
  builtin('rainy-window-seat', 'Rainy Window Seat', 'Lo-fi hip-hop', rainyWindow),
  builtin('aurora-sprint', 'Aurora Sprint', 'Trance-pop', auroraSprint),
];
