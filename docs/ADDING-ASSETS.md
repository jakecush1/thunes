# Adding your own characters, dances and music

There are two ways to bring your own files into Thunes:

1. **Drop them into the repository** under `public/assets/`. They ship with the app and every visitor gets them.
2. **Upload them in the browser.** They stay on that device only.

## Folder layout

```
public/assets/
  characters/   .glb  .gltf  .fbx
  dances/       .glb  .gltf  .fbx  .bvh  .json (dance scheme)
  music/        .mp3  .wav  .ogg  .m4a  .aac  .flac  .opus  .json (song pattern)
```

- Sub-folders are fine (`dances/hiphop/slide.fbx`).
- While `npm run dev` is running, adding, changing or removing a file reloads the page; the file simply appears in the pickers. For a production build, run the build again.
- The display name comes from the file name: `hip_hop-01.fbx` becomes "Hip Hop 01".
- Dotfiles, READMEs, `.bin` files and textures are ignored, so a `.gltf` may sit next to its `.bin` and images. A single self-contained `.glb` is still the safest choice.
- A dance file (`.glb`/`.gltf`) with several animation clips becomes one dance per clip.
- A file that cannot be used is skipped with a message in the browser console (and an error where it is picked) instead of breaking the app.

## Sidecar files (optional)

Put `<full file name>.meta.json` next to a file to describe it, for example `public/assets/dances/hip_hop-01.fbx.meta.json`:

```json
{
  "name": "Hip Hop Slide",
  "category": "Street",
  "bpm": 96,
  "beats": 16,
  "inPlace": true
}
```

| Field | Applies to | Meaning |
| --- | --- | --- |
| `name` | characters, dances | Display name |
| `category` | characters, dances | Group in the picker |
| `height` | characters | Height on stage in metres (0.3 to 5). Default: the standard dancer height |
| `bpm` | dances, songs | Tempo (30 to 300). Lets a dance follow the music's beat |
| `beats` | dances | Length of the loop in beats. Default: duration x bpm / 60 |
| `inPlace` | dances | `true` removes travel so the dancer stays on its spot |
| `clip` | dances | Use only this animation clip of the file: a name or an index starting at 0 |
| `title`, `artist`, `vibe` | songs | Title, artist and a short mood label |

Unknown fields and out-of-range values are ignored. Invalid JSON prints a warning in the dev-server terminal and the file is used without metadata.

Songs without a `bpm` get an estimate the first time they are played (it works best on music with a clear beat; set `bpm` in the sidecar if the estimate is off or doubled/halved).

## Rig requirements

Characters and dance files need a **humanoid skeleton**:

- Hips, a spine, head, and two arms (upper arm, forearm, hand) and two legs (thigh, shin, foot). Neck, shoulders, toes and fingers are used when present.
- Bone names must be recognisable. The following conventions are understood, with or without prefixes such as `mixamorig:`: Mixamo (`LeftForeArm`), VRM / Unity humanoid (`leftLowerArm`), Blender and Rigify (`upper_arm.L`, `DEF-forearm.R`), Unreal mannequin (`lowerarm_l`), BVH / motion capture (`LeftElbow`, `LHipJoint`), 3ds Max Biped (`Bip01 L Forearm`) and similar left/right spellings (`L_`, `_l`, `.L`, `Left`).
- Characters must be **skinned** and rest in a **T-pose or A-pose**, standing upright, facing forward. The bind pose is what counts, not the first animation frame.
- Scale and units do not matter (centimetre FBX files are fine): everything is scaled to the dancer height. The up axis is detected from the skeleton.
- glTF files may use Meshopt compression. **Draco compression is not supported**: export without it.
- Animals, props and robots without a human-like skeleton are refused, and the message lists the bones that could not be found.

Dance files may contain a mesh or only a skeleton with animation. Any dance plays on any character: the motion is retargeted between the two skeletons.

### Tips for Mixamo downloads

- Character: download the character itself as "FBX Binary (.fbx)" in T-pose (or convert to `.glb` in Blender), and put it in `characters/`.
- Dance: on an animation, choose "FBX Binary", **"With Skin"** or "Without Skin" both work, 30 fps, no keyframe reduction. Put it in `dances/`.
- Tick "In Place" on Mixamo when it is offered, or set `"inPlace": true` in the sidecar.
- Mixamo names every clip `mixamo.com`; the dance is named after the file, so give the file a good name.
- You do not need the same character for the animation and for the stage.

## Uploads in the browser

Uploading accepts the same model, audio and JSON files. Differences from the folders:

- The files are stored in the browser (IndexedDB) on that device; they survive reloads but are not part of the project and nobody else sees them. If the browser does not allow storage (some private windows), uploads last until the page is closed, and the upload report says so.
- One model file can yield both a character (if it has a skinned humanoid) and a dance for every animation clip in it.
- There are no sidecars: names come from file and clip names, and the tempo of a song is detected on upload.
- Limits: 200 MB per model, 100 MB per audio file, 2 MB per JSON file. A `.gltf` must be self-contained (use `.glb`).
- Removing an upload deletes its stored file once nothing else from that file is left.

## Authoring a dance as JSON

A dance scheme describes a looping dance in body controls (degrees, or fractions of the leg length) instead of bone rotations, so it works on every character. `public/assets/dances/example-side-sway.json` is a complete example: edit it while the dev server runs and watch the result.

```json
{
  "format": "thunes-dance@1",
  "beats": 4,
  "bpm": 120,
  "base": { "arms.raise": 20, "arms.elbow": 30 },
  "tracks": [
    { "control": "leftArm.raise", "keys": [[0, 0], [1, 100, "out"], [2, 0, "inOut"]] }
  ],
  "oscillators": [
    { "control": "hips.crouch", "wave": "bounce", "amp": -0.04, "bias": 0.04, "period": 1 },
    { "control": "hips.shift", "amp": 0.1, "period": 4 }
  ]
}
```

- `beats`: loop length. `bpm`: the tempo the dance was written for.
- `base`: resting value of each control.
- `tracks`: keyframes `[beat, value, ease?]` added on top of the base. `repeat` plays the keys several times per loop; `mirror` plays them on the other side of the body, that many beats later; `lag` delays a track.
- `oscillators`: repeating waves (`sine`, `bounce`, `triangle`, `pulse`) with `amp`, `period` in beats (it must divide the loop), `phase` and `bias`.
- Eases: `linear`, `in`, `out`, `inOut` (default), `hold`, `snap`, `overshoot`.
- Controls: `spine.lean/side/twist`, `hips.yaw/tilt/roll/shift/forward/crouch`, `air` (jump), `head.nod/tilt/turn/level`, `leftArm.` / `rightArm.` / `arms.` + `raise/swing/twist/shrug/elbow/forearmTwist/wrist`, `leftFoot.` / `rightFoot.` / `feet.` + `side/forward/up/turn/pitch`, and `leftLeg.` / `rightLeg.` / `legs.` + `kneeOut/lift/spread/turnOut/knee`. Feet are planted on the floor and the knees are solved for you.

The full reference, with the meaning and range of every control, is the header comment of `src/dances/scheme.ts`. A scheme with a mistake is refused with a message naming the problem.

## Authoring a song as JSON

A song pattern is synthesised in the browser, so no audio file is needed. Time is a grid of 16 steps per bar.

```json
{
  "format": "thunes-song@1",
  "bpm": 118,
  "bars": 4,
  "seed": 7,
  "tracks": {
    "kick": { "kind": "kick" },
    "clap": { "kind": "clap", "reverb": 0.2 },
    "hat": { "kind": "hat", "gain": 0.5 },
    "bass": { "kind": "bass", "duck": 0.5 },
    "keys": { "kind": "keys", "low": "C4", "gain": 0.8, "reverb": 0.3 }
  },
  "sections": {
    "A": {
      "bars": 4,
      "chords": ["Am", "F", "C", "G"],
      "parts": {
        "kick": "x...x...x...x...",
        "clap": "....x.......x...",
        "hat": "..x...x...x...xo",
        "bass": { "steps": "x..x..x.x..x..x.", "pitches": ["1", "1", "5", "1+", "1", "5"], "gate": 2 },
        "keys": { "bar": [[0, "chord", 6, 0.7], [10, "chord", 4, 0.6]] }
      }
    }
  },
  "arrangement": ["A"]
}
```

- `tracks`: the instruments. Drum kinds: `kick`, `snare`, `clap`, `hat`, `openhat`, `perc`. Synth kinds: `bass`, `pluck`, `lead`, `pad`, `keys`. Each takes mix settings such as `gain`, `pan`, `reverb`, `delay`, `duck`.
- `sections`: named blocks of bars with one chord name per bar and a part per track. `arrangement` lists the sections in playing order; `bars` must equal their total length. The song loops.
- Drum parts are step strings: `.` rest, `x` hit, `X` accent, `o` ghost note, `1` to `9` velocity. Spaces and `|` are ignored.
- Pitched parts use `steps` + `pitches`, or note lists `[step, pitch, length, velocity?]` in `bar` (repeated every bar) or `notes` (from the start of the section). A pitch is a note name (`"F#2"`), a MIDI number, a chord tone (`"1"`, `"3"`, `"5"`, `"7"`, with `+`/`-` for octaves) or `"chord"`.
- A sidecar (`my-song.json.meta.json`) can set `title`, `artist` and `vibe`.

The full reference is the header comment of `src/audio/pattern.ts`.
