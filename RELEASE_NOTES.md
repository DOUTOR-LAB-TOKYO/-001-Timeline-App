# Eevee v0.1.0 — Initial public release (alpha)

First public release of **Eevee**, a timeline sequencer for media art and interactive content.

Drop keyframes on a timeline and stream the values out via OSC, Serial, and DMX in real time. CSV export for offline playback.

## What's in this release

- **Three sequence types** — Value (float/int), Color (RGBA, float or int format), Flag (point/range markers with text labels)
- **Real-time output** — OSC over UDP, Serial text protocol, DMX via ENTTEC Pro
- **Five interpolation modes** — Linear / Step / Ease In / Ease Out / Ease In-Out
- **Audio sync** — load audio files, waveform displayed, project length auto-fits to audio
- **Multi-tab + Sync** — run multiple projects in parallel, optionally synchronized
- **CSV export** — per-frame value tables for offline playback on microcontrollers
- **FPS-aware editing** — change FPS later and keyframes keep their time position
- **7-language UI** — English, 日本語, 한국어, 中文, Español, Français, Português

## Downloads

- **macOS** (universal): `Eevee_0.1.0_universal.dmg`
- **Windows** (x64): `Eevee_0.1.0_x64_en-US.msi`

## ⚠️ Installation note (please read)

This release is **unsigned** for both macOS and Windows. See the [README](./README.md#installation) for the one-time setup step needed on first launch.

**macOS** users — after installing, run:
```bash
xattr -cr /Applications/Eevee.app
```

**Windows** users — click **More info** → **Run anyway** if SmartScreen warns.

Code signing is on the roadmap.

## Known limitations

- Undo / Redo coverage is partial (being expanded)
- No MIDI output yet
- No preset / template library yet
- macOS / Windows binaries are unsigned (see installation note)

## Feedback

This is an alpha release — feedback, bug reports, and feature requests are very welcome.

→ [Open an issue](../../issues)

---

*Eevee — Timeline Sequencer for Media Art and Interactive Content.*
