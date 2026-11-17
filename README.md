# Thunes

A 3D dance party in the browser. Put up to eight dancers on a stage, give each one a character and a dance, pick a song, and tweak everything until it looks right. Built with three.js, TypeScript and Vite, with no UI framework.

Everything you see out of the box is a placeholder generated in code: six characters, twelve dances and six songs. The app is a framework for your own characters, dance animations and music.

## Run it

```sh
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # typecheck + production bundle in dist/
npm run preview    # serve the production bundle
```

## What you can do

- **Dancers.** Add, remove, swap and clone dancers from the dock at the bottom. Click a dancer to select it; drag it to move it.
- **Dances.** Each dancer's dance is chosen independently of its character. Any dance plays on any character.
- **Per-dancer controls.** Position, rotation, scale, speed, phase offset, loop trim, mirror, shine, metal, tint, head/hand/foot size, shake, and a vertex warp effect.
- **Music.** The drawer at the bottom left lists the songs. Dancers lock to the song's beat (this can be switched off).
- **Scene.** Fourteen backdrops plus a custom colour, four floor styles, brightness, exposure, fog, strobe and an auto-orbiting camera.
- **Look / Grab / Both.** Choose whether dragging orbits the camera, moves dancers, or both.
- **Save and share.** Scenes are saved in this browser. A share link carries the whole scene in the URL, so no server is needed.
- **Undo and redo** for everything that changes the scene.

The strobe never runs until the viewer agrees to it, and never exceeds three flashes per second.

## Adding your own characters, dances and music

There are two ways, and both are described in detail in [docs/ADDING-ASSETS.md](docs/ADDING-ASSETS.md).

1. **Drop files into the project.** They appear in the app automatically.

   | Folder | Formats |
   |---|---|
   | `public/assets/characters/` | `.glb`, `.gltf`, `.fbx` |
   | `public/assets/dances/` | `.glb`, `.gltf`, `.fbx`, `.bvh`, or a `.json` dance scheme |
   | `public/assets/music/` | `.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.flac`, `.opus`, or a `.json` song pattern |

   An optional `<file name>.meta.json` next to a file sets its display name, category, tempo and so on.

2. **Upload in the browser.** Drag files onto the page, or use the upload card in the picker and the music drawer. Uploads are stored on that device only.

Characters need a humanoid skeleton in a T-pose or A-pose with recognisable bone names. Mixamo, Ready Player Me, VRM/Unity-style, Unreal-style, Blender `.L`/`.R`, common BVH and 3ds Max Biped naming are recognised. Dances are retargeted onto whichever character performs them.

`public/assets/dances/example-side-sway.json` is a small example of a dance written as data.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `1`–`8` | Select a dancer |
| Arrow keys | Nudge the selected dancer (hold Shift for bigger steps) |
| `[` `]` | Rotate the selected dancer |
| `Delete` / `Backspace` | Remove the selected dancer |
| `Cmd/Ctrl+D` | Clone the selected dancer |
| `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z` | Undo, redo |
| `S` | Put all dancers back in step |
| `M` | Mute |
| `H` | Hide or show the interface |
| `Esc` | Close the top panel, then deselect |

## Project layout

```
src/
  types.ts, config.ts   shared contracts: state model, slider ranges, defaults
  core/                 store with undo, share-link encoding, saved scenes, preferences
  rig/                  canonical skeleton, bone-name recognition, normalising, retargeting
  characters/           the placeholder characters
  dances/               the dance format, its compiler and the placeholder dances
  audio/                audio engine, beat clock, synthesiser, placeholder songs, tempo detection
  assets/               registry, model loaders, drop-in folder discovery, browser uploads
  stage/                renderer, backdrops, floor, lights, strobe, dancers, interaction, thumbnails
  ui/                   design system, controls, shell and panels
lab/                    dev-only pages for inspecting one subsystem at a time (/lab/<name>.html)
scripts/e2e/            browser checks driven through the installed Google Chrome
scripts/vite/           the Vite plugin that discovers files in public/assets
tests/unit/             unit tests
docs/ADDING-ASSETS.md   how to add your own content
```

## Tests

```sh
npm test            # unit tests
npm run e2e         # boots the app in headless Chrome and checks it renders without errors
npm run e2e:all     # every browser script (a few minutes)
```

The browser scripts use the Google Chrome installed on the machine; nothing is downloaded.

Some tests exercise real rigged models and are skipped unless `THUNES_FIXTURES` points at a folder containing them (`Xbot.glb`, `Michelle.glb`, `Soldier.glb`, `Samba Dancing.fbx`, `RobotExpressive.glb`, `pirouette.bvh` from the three.js examples). Those files are not part of this repository.

## Known limits

- Draco-compressed glTF files are not supported; re-export without Draco or with Meshopt.
- A `.gltf` with separate `.bin` or texture files cannot be uploaded in the browser; put it in `public/assets/` or convert it to `.glb`.
- Retargeting does not plant feet, so feet can slide slightly on characters whose proportions differ a lot from the dance's original rig.
- Detected tempos are folded into 80–160 BPM. Set `bpm` in a sidecar file if a song is detected at half or double its real tempo.
- Songs are synthesised in the browser the first time they play, so the first one starts about two seconds after you press Enter.
