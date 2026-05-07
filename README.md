# Eevee

A timeline sequencer for media art and interactive content.

Drop keyframes on a timeline and stream the values out via **OSC**, **Serial**, and **DMX** in real time. Plus CSV export for offline playback on microcontrollers.

Built for driving robots, moving lights, TouchDesigner / Unity scenes, or anything OSC-shaped.

![Eevee screenshot placeholder](docs/hero.png)

## Features

- **Keyframe-based timeline** — Linear / Step / Ease In / Out / In-Out interpolation
- **Three sequence types**:
  - **Value** — float / int parameters
  - **Color** — RGBA with FLOAT (0–1) or INT (0–255) output
  - **Flag** — point or range markers with text labels for triggers and cues
- **Real-time output**:
  - **OSC** over UDP, with auto-prefixed addresses per project (`/projectname/seq/1`)
  - **Serial** as `/address:value\n` text protocol — Arduino / Teensy / M5Stack friendly
  - **DMX** via ENTTEC Pro USB adapters (full 512ch universe)
- **Audio sync** — load MP3 / WAV / FLAC / AAC / OGG / M4A, auto-fits project length to audio, waveform on the timeline
- **Multi-tab + Sync** — open multiple projects in tabs, optionally play them all in sync
- **CSV export** — write per-frame value tables for offline / SD-card playback
- **FPS-aware** — change FPS later and keyframes keep their time position
- **7 languages** — English / 日本語 / 한국어 / 中文 / Español / Français / Português

## Download

Get the latest build from the [Releases page](../../releases/latest):

- **macOS** (Apple Silicon & Intel): `Eevee_x.y.z_universal.dmg`
- **Windows** (x64): `Eevee_x.y.z_x64_en-US.msi`

## Installation

### macOS

The app is currently distributed unsigned. After downloading the `.dmg`:

1. Open the `.dmg` and drag **Eevee** to your Applications folder
2. Open Terminal and run:

   ```bash
   xattr -cr /Applications/Eevee.app
   ```

3. Launch Eevee from Applications

> Without step 2, macOS Gatekeeper will refuse to open the app ("damaged" / "unidentified developer"). The `xattr` command removes the quarantine attribute that Safari adds to downloaded files. The app is safe — it's just not yet signed with an Apple Developer certificate.

### Windows

1. Run the `.msi` installer
2. If Windows SmartScreen shows a warning, click **More info** → **Run anyway**
3. Launch Eevee from the Start menu

> The SmartScreen warning appears because the app isn't signed with an EV code-signing certificate. The app itself is safe.

## Quick Start

1. **Set a project name** in the toolbar — it auto-prefixes all OSC addresses
2. **Add a sequence** with the **+** button on the left panel (Value / Color / Flag)
3. **Click the timeline** to drop keyframes; drag to edit
4. **Configure output** via the gear icon → OSC / Serial / DMX tabs
5. **Press Space** (or the play button) to play

For OSC sending, the simplest setup is:

- Settings → OSC → Enabled, IP `127.0.0.1`, Port `7000`
- In TouchDesigner, add an **OSC In CHOP**, set Network Port to `7000`, target your sequence's full address (e.g. `/myproject/seq/1`)

## Use cases

| Workflow | Output | Notes |
|---|---|---|
| Robot control | Serial / CSV | Joint angles, motor speeds; CSV for SD-card playback on microcontrollers |
| Moving lights | DMX (ENTTEC Pro) | Pan / tilt / intensity as Value sequences, color as Color sequence (4ch) |
| TouchDesigner / Unity / openFrameworks | OSC | Drive scene parameters in sync with audio |
| Installations | Mixed | Drive multiple machines from one timeline using Multi-tab + Sync |

## Sequence types in detail

### Value
Numeric keyframes. Set `float` or `int` value type, optional Min/Max for DMX scaling, default value, and a relative OSC sub-address.

### Color
RGBA keyframes. Output format toggle: **FLOAT** (0–1) or **INT** (0–255).
- **OSC**: split into `/addr/r`, `/addr/g`, `/addr/b`, `/addr/a`
- **DMX**: 4 consecutive channels (R, G, B, A) starting from the assigned channel

### Flag
Markers on specific frames, with text labels.
- **Point flags** emit a 1.0 → 0.0 OSC pulse (compatible with TouchDesigner OSC In CHOP, which only accepts numeric args)
- **Range flags** emit `1.0` on entering and `0.0` on exiting; drag to resize
- The label text is sent as a string argument alongside the float, so you can read it on the OSC In DAT side

## Building from source

Requires Node.js 18+ and Rust (latest stable).

```bash
npm install
npm run tauri dev      # development mode with hot reload
npm run tauri build    # production build
```

Build output:
- macOS: `src-tauri/target/release/bundle/dmg/`
- Windows: `src-tauri/target/release/bundle/msi/`

## Roadmap

- MIDI output
- Bezier curve editor
- Preset / template library
- Live performance trigger UI
- Code signing for macOS and Windows builds

## Feedback & support

Bug reports, feature requests, and use-case stories are very welcome.

→ Open an issue on the [Issues tab](../../issues)

## License

[MIT](./LICENSE) © DOUTOR LAB TOKYO

---

*Eevee — Timeline Sequencer for Media Art and Interactive Content.*
