# Eevee v0.1.1 — Loop & shortcut fixes

Maintenance release with playback loop improvements and keyboard shortcut fixes.

## Changes since v0.1.0

- **Live loop editing** — toggling loop / changing loop In-Out now takes effect during playback (previously only on next start)
- **Audio re-sync on loop** — audio is now re-triggered from `loopIn` via a dedicated `loop_restart` event from the engine, removing the previous frame-jump heuristic
- **Keyboard shortcuts** — `Cmd/Ctrl+C` and `Cmd/Ctrl+V` no longer hijack text selection; standard browser copy/paste now works when text is highlighted

## Downloads

- **macOS** (universal): `Eevee_0.1.1_universal.dmg`
- **Windows** (x64): `Eevee_0.1.1_x64_en-US.msi`

## ⚠️ Installation note (please read)

This release is **unsigned** for both macOS and Windows. See the [README](./README.md#installation) for the one-time setup step needed on first launch.

**macOS** users — after installing, run:
```bash
xattr -cr /Applications/Eevee.app
```

**Windows** users — click **More info** → **Run anyway** if SmartScreen warns.

Code signing is on the roadmap.

## About Eevee

A timeline sequencer for media art and interactive content. Drop keyframes on a timeline and stream the values out via OSC, Serial, and DMX in real time. CSV export for offline playback.

- **Three sequence types** — Value (float/int), Color (RGBA), Flag (point/range markers with text labels)
- **Real-time output** — OSC over UDP, Serial text protocol, DMX via ENTTEC Pro
- **Five interpolation modes** — Linear / Step / Ease In / Ease Out / Ease In-Out
- **Audio sync** — load audio files, waveform displayed, project length auto-fits to audio
- **Multi-tab + Sync** — run multiple projects in parallel, optionally synchronized
- **CSV export** — per-frame value tables for offline playback on microcontrollers
- **FPS-aware editing** — change FPS later and keyframes keep their time position
- **7-language UI** — English, 日本語, 한국어, 中文, Español, Français, Português

## Known limitations

- Undo / Redo coverage is partial (being expanded)
- No MIDI output yet
- No preset / template library yet
- macOS / Windows binaries are unsigned (see installation note)

## Feedback

→ [Open an issue](../../issues)

---

*Eevee — Timeline Sequencer for Media Art and Interactive Content.*
