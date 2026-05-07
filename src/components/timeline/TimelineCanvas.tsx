import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../store';
import { interpolateValue } from '../../lib/interpolation';
import { clamp } from '../../lib/utils';
import { RULER_H, WAVEFORM_H, ROW_H } from '../../lib/constants';
import { useT } from '../../lib/i18n';
import { playAudio } from '../../lib/audio';
import { generateId } from '../../lib/utils';
import type { Interpolation, Sequence, Keyframe, Flag, ColorKeyframe } from '../../types';

// ─── Constants ───────────────────────────────────────────────────────

const KF_HALF = 5;
const VALUE_PAD = 10;
const SNAP_PX = 10;
const BZ_R = 4;
const LEFT_PAD = 8; // px buffer so frame 0 isn't flush with the left edge

// ─── Coordinate helpers ──────────────────────────────────────────────

function frameToX(frame: number, viewStart: number, zoom: number): number {
  return LEFT_PAD + (frame - viewStart) / zoom;
}

function xToFrame(x: number, viewStart: number, zoom: number): number {
  return viewStart + (x - LEFT_PAD) * zoom;
}

function valueToY(value: number, rowTop: number, seq: Sequence, rowH: number): number {
  const range = seq.max - seq.min || 1;
  const t = (value - seq.min) / range;
  const usableH = rowH - 2 * VALUE_PAD;
  return rowTop + rowH - VALUE_PAD - t * usableH;
}

function yToValue(y: number, rowTop: number, seq: Sequence, rowH: number): number {
  const usableH = rowH - 2 * VALUE_PAD;
  const t = (rowTop + rowH - VALUE_PAD - y) / usableH;
  return clamp(seq.min + t * (seq.max - seq.min), seq.min, seq.max);
}

function getRowTop(seqIndex: number, vertScroll: number, rowHArr: number[], contentTop: number): number {
  let top = contentTop - vertScroll;
  for (let i = 0; i < seqIndex; i++) top += rowHArr[i];
  return top;
}

function getRowIndexAt(y: number, vertScroll: number, rowHArr: number[], contentTop: number): number {
  let top = contentTop - vertScroll;
  for (let i = 0; i < rowHArr.length; i++) {
    if (y < top + rowHArr[i]) return i;
    top += rowHArr[i];
  }
  return rowHArr.length - 1;
}

// ─── Bezier handle helpers ────────────────────────────────────────────

interface BzHandlePos {
  kx: number; ky: number; nkx: number; nky: number;
  h1x: number; h1y: number; h2x: number; h2y: number;
}

function getBzHandles(
  kf: Keyframe, nextKf: Keyframe,
  rowTop: number, seq: Sequence, rowH: number,
  vStart: number, z: number
): BzHandlePos {
  const kx = frameToX(kf.frame, vStart, z);
  const ky = valueToY(kf.value, rowTop, seq, rowH);
  const nkx = frameToX(nextKf.frame, vStart, z);
  const nky = valueToY(nextKf.value, rowTop, seq, rowH);
  const cp1x = kf.cp1x ?? 0.25;
  const cp1y = kf.cp1y ?? 0.25;
  const cp2x = kf.cp2x ?? 0.75;
  const cp2y = kf.cp2y ?? 0.75;
  return {
    kx, ky, nkx, nky,
    h1x: kx + cp1x * (nkx - kx),
    h1y: ky + cp1y * (nky - ky),
    h2x: kx + cp2x * (nkx - kx),
    h2y: ky + cp2y * (nky - ky),
  };
}

// ─── Value grid helpers ──────────────────────────────────────────────

function getValueGridInterval(min: number, max: number): number {
  const range = max - min;
  if (range === 0) return 1;
  const rough = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let nice: number;
  if (norm < 1.5) nice = 1;
  else if (norm < 3.5) nice = 2;
  else if (norm < 7.5) nice = 5;
  else nice = 10;
  return nice * mag;
}

function formatGridLabel(v: number, interval: number): string {
  if (interval >= 1) return String(Math.round(v));
  const decimals = Math.max(0, -Math.floor(Math.log10(interval)));
  return v.toFixed(decimals);
}

// ─── Snap helper ─────────────────────────────────────────────────────

function getSnappedFrame(
  rawFrame: number,
  sequences: Sequence[],
  zoom: number,
  options: {
    excludeSeqId?: string;
    excludeFrames?: Set<number>;
    excludeFlagId?: string;
    gridSize?: number;
  } = {}
): { frame: number; snapped: boolean } {
  const threshold = SNAP_PX * zoom;
  let best = rawFrame;
  let bestDist = threshold;

  for (const seq of sequences) {
    if (seq.id !== options.excludeSeqId) {
      for (const kf of seq.keyframes) {
        if (options.excludeFrames?.has(kf.frame)) continue;
        const dist = Math.abs(kf.frame - rawFrame);
        if (dist < bestDist) { bestDist = dist; best = kf.frame; }
      }
    }
    for (const f of seq.flags) {
      if (f.id === options.excludeFlagId) continue;
      let d = Math.abs(f.frame - rawFrame);
      if (d < bestDist) { bestDist = d; best = f.frame; }
      if (f.duration > 0) {
        d = Math.abs((f.frame + f.duration) - rawFrame);
        if (d < bestDist) { bestDist = d; best = f.frame + f.duration; }
      }
    }
  }

  if (options.gridSize && options.gridSize > 0) {
    const gridFrame = Math.round(rawFrame / options.gridSize) * options.gridSize;
    const dist = Math.abs(gridFrame - rawFrame);
    if (dist < bestDist) { bestDist = dist; best = gridFrame; }
  }

  return { frame: best, snapped: best !== rawFrame };
}

// ─── Ruler helpers ───────────────────────────────────────────────────

function getRulerTick(zoom: number, fps: number): { major: number; minor: number } {
  const minPxMajor = 55;
  const candidates = [1, 2, 5, 10, 15, 30, fps, fps * 2, fps * 5, fps * 10, fps * 30, fps * 60];
  const deduped = [...new Set(candidates)].sort((a, b) => a - b);
  const major = deduped.find((c) => c / zoom >= minPxMajor) ?? deduped[deduped.length - 1];
  const minor = Math.max(1, Math.round(major / 5));
  return { major, minor };
}

function formatRulerLabel(frame: number, fps: number): string {
  const totalSec = frame / fps;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
  return `${s.toFixed(s < 10 ? 2 : 1)}s`;
}

// ─── Hit tests ───────────────────────────────────────────────────────

interface KfHit { seqId: string; seqIndex: number; frame: number; value: number; }

function hitTestKeyframe(
  x: number, y: number,
  sequences: Sequence[],
  viewStart: number, zoom: number, vertScroll: number,
  rowHArr: number[], contentTop: number
): KfHit | null {
  const hitR = KF_HALF + 6;
  for (let i = 0; i < sequences.length; i++) {
    const seq = sequences[i];
    const rowH = rowHArr[i];
    const rowTop = getRowTop(i, vertScroll, rowHArr, contentTop);
    for (const kf of seq.keyframes) {
      const kx = frameToX(kf.frame, viewStart, zoom);
      const ky = valueToY(kf.value, rowTop, seq, rowH);
      if ((x - kx) ** 2 + (y - ky) ** 2 <= hitR ** 2) {
        return { seqId: seq.id, seqIndex: i, frame: kf.frame, value: kf.value };
      }
    }
  }
  return null;
}

interface BzHit {
  seqId: string; seqIndex: number;
  frame: number; nextFrame: number;
  handle: 'cp1' | 'cp2';
}

function hitTestBzHandle(
  x: number, y: number,
  sequences: Sequence[],
  vStart: number, zoom: number, vertScroll: number,
  selectedKeyframes: Map<string, Set<number>>,
  rowHArr: number[], contentTop: number
): BzHit | null {
  const hitR = BZ_R + 5;
  for (let i = 0; i < sequences.length; i++) {
    const seq = sequences[i];
    const rowH = rowHArr[i];
    const rowTop = getRowTop(i, vertScroll, rowHArr, contentTop);
    const sorted = [...seq.keyframes].sort((a, b) => a.frame - b.frame);
    for (let j = 0; j < sorted.length - 1; j++) {
      const kf = sorted[j];
      if (kf.interpolation !== 'bezier') continue;
      if (!(selectedKeyframes.get(seq.id)?.has(kf.frame) ?? false)) continue;
      const nextKf = sorted[j + 1];
      const { h1x, h1y, h2x, h2y } = getBzHandles(kf, nextKf, rowTop, seq, rowH, vStart, zoom);
      if ((x - h1x) ** 2 + (y - h1y) ** 2 <= hitR ** 2) {
        return { seqId: seq.id, seqIndex: i, frame: kf.frame, nextFrame: nextKf.frame, handle: 'cp1' };
      }
      if ((x - h2x) ** 2 + (y - h2y) ** 2 <= hitR ** 2) {
        return { seqId: seq.id, seqIndex: i, frame: kf.frame, nextFrame: nextKf.frame, handle: 'cp2' };
      }
    }
  }
  return null;
}

// ─── Color helpers ───────────────────────────────────────────────────

const COLOR_KF_HALF = 5;

function colorCss(c: { r: number; g: number; b: number; a: number }) {
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
}

function interpolateColorBetween(a: ColorKeyframe, b: ColorKeyframe, frame: number) {
  if (a.interpolation === 'step') return { r: a.r, g: a.g, b: a.b, a: a.a };
  const span = b.frame - a.frame || 1;
  const t = clamp((frame - a.frame) / span, 0, 1);
  const tt = a.interpolation === 'smooth' ? t * t * (3 - 2 * t) : t;
  return {
    r: a.r + (b.r - a.r) * tt,
    g: a.g + (b.g - a.g) * tt,
    b: a.b + (b.b - a.b) * tt,
    a: a.a + (b.a - a.a) * tt,
  };
}

interface ColorKfHit { seqId: string; seqIndex: number; frame: number; }

function hitTestColorKeyframe(
  x: number, y: number,
  sequences: Sequence[],
  viewStart: number, zoom: number, vertScroll: number,
  rowHArr: number[], contentTop: number
): ColorKfHit | null {
  for (let i = 0; i < sequences.length; i++) {
    const seq = sequences[i];
    if (seq.kind !== 'color') continue;
    const rowTop = getRowTop(i, vertScroll, rowHArr, contentTop);
    const rowH = rowHArr[i];
    if (y < rowTop || y > rowTop + rowH) continue;
    const cy = rowTop + rowH - COLOR_KF_HALF - 4;
    for (const kf of seq.colorKeyframes) {
      const cx = frameToX(kf.frame, viewStart, zoom);
      if (Math.abs(x - cx) <= COLOR_KF_HALF + 4 && Math.abs(y - cy) <= COLOR_KF_HALF + 4) {
        return { seqId: seq.id, seqIndex: i, frame: kf.frame };
      }
    }
  }
  return null;
}

// ─── Flag hit test ───────────────────────────────────────────────────

const FLAG_PAD_Y = 6;
const FLAG_RESIZE_PX = 6;
const FLAG_MIN_PX = 8;

interface FlagHit { seqId: string; seqIndex: number; flag: Flag; edge: 'body' | 'right'; }

function hitTestFlag(
  x: number, y: number,
  sequences: Sequence[],
  viewStart: number, zoom: number, vertScroll: number,
  rowHArr: number[], contentTop: number
): FlagHit | null {
  for (let i = 0; i < sequences.length; i++) {
    const seq = sequences[i];
    if (seq.kind !== 'flag') continue;
    const rowTop = getRowTop(i, vertScroll, rowHArr, contentTop);
    const rowH = rowHArr[i];
    if (y < rowTop + FLAG_PAD_Y || y > rowTop + rowH - FLAG_PAD_Y) continue;
    for (const f of seq.flags) {
      const x1 = frameToX(f.frame, viewStart, zoom);
      const w = Math.max(FLAG_MIN_PX, f.duration / zoom);
      const x2 = x1 + w;
      if (x < x1 - 2 || x > x2 + 2) continue;
      if (f.duration > 0 && x >= x2 - FLAG_RESIZE_PX && x <= x2 + 2) {
        return { seqId: seq.id, seqIndex: i, flag: f, edge: 'right' };
      }
      return { seqId: seq.id, seqIndex: i, flag: f, edge: 'body' };
    }
  }
  return null;
}

// ─── Drag state ──────────────────────────────────────────────────────

type DragType = 'idle' | 'seek' | 'kf' | 'pan' | 'marquee' | 'bz' | 'flagMove' | 'flagResize' | 'colorKfMove';

interface MultiInitPos { seqId: string; frame: number; value: number; }

interface DragState {
  type: DragType;
  startX: number; startY: number; startViewStart: number;
  kfSeqId?: string; kfSeqIndex?: number; kfCurFrame?: number;
  snapLocked?: number; snapTargetFrame?: number;
  kfMultiInitPositions?: MultiInitPos[];
  kfAnchorInitFrame?: number;
  kfPrevDelta?: number;
  bzSeqId?: string; bzFrame?: number; bzHandle?: 'cp1' | 'cp2'; bzNextFrame?: number;
  flagSeqId?: string; flagId?: string; flagInitFrame?: number; flagInitDuration?: number;
  ckfSeqId?: string; ckfSeqIndex?: number; ckfCurFrame?: number;
  curX?: number; curY?: number;
}

// ─── Clipboard (module-level) ────────────────────────────────────────

interface ClipEntry { seqId: string; relFrame: number; kf: Keyframe; }
let kfClipboard: ClipEntry[] = [];

// ─── Interp options ──────────────────────────────────────────────────

const INTERP_OPTIONS: { value: Interpolation; label: string }[] = [
  { value: 'step',   label: 'Step'   },
  { value: 'linear', label: 'Linear' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'bezier', label: 'Bezier' },
];

// ─── Component ───────────────────────────────────────────────────────

export default function TimelineCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [vertScroll, setVertScroll] = useState(0);
  const [cursor, setCursor] = useState<string>('crosshair');
  const didFitInitialViewRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; seqId: string; frame: number; interp: Interpolation; isMulti: boolean;
  } | null>(null);

  const project = useAppStore((s) => s.project);
  const { sequences, fps, durationFrames } = project;
  const currentFrame = useAppStore((s) => s.currentFrame);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const viewStartFrame = useAppStore((s) => s.viewStartFrame);
  const zoom = useAppStore((s) => s.zoom);
  const selectedKeyframes = useAppStore((s) => s.selectedKeyframes);
  const rowHeights = useAppStore((s) => s.rowHeights);
  const setCurrentFrame = useAppStore((s) => s.setCurrentFrame);
  const setViewStartFrame = useAppStore((s) => s.setViewStartFrame);
  const setZoom = useAppStore((s) => s.setZoom);
  const setSelectedSequence = useAppStore((s) => s.setSelectedSequence);
  const toggleKeyframeSelection = useAppStore((s) => s.toggleKeyframeSelection);
  const setSelectedKeyframesBatch = useAppStore((s) => s.setSelectedKeyframesBatch);
  const clearKeyframeSelection = useAppStore((s) => s.clearKeyframeSelection);
  const addKeyframe = useAppStore((s) => s.addKeyframe);
  const moveKeyframe = useAppStore((s) => s.moveKeyframe);
  const moveKeyframesBatch = useAppStore((s) => s.moveKeyframesBatch);
  const updateKeyframe = useAppStore((s) => s.updateKeyframe);
  const snapGridSize = useAppStore((s) => s.snapGridSize);
  const setSnapGridSize = useAppStore((s) => s.setSnapGridSize);
  const waveformSamples = useAppStore((s) => s.waveformSamples);
  const selectedFlag = useAppStore((s) => s.selectedFlag);

  const contentTop = waveformSamples ? RULER_H + WAVEFORM_H : RULER_H;
  const tl = useT();

  // Per-row height array (index matches sequences array)
  const rowHArr = useMemo(
    () => sequences.map((s) => rowHeights.get(s.id) ?? ROW_H),
    [sequences, rowHeights]
  );

  const drag = useRef<DragState>({ type: 'idle', startX: 0, startY: 0, startViewStart: 0 });
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const seekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seekTo = useCallback((frame: number) => {
    setCurrentFrame(frame);
    const { isPlaying, getPlaybackJSON, loopEnabled, loopIn, loopOut, project } = useAppStore.getState();
    if (!isPlaying) return;
    // デバウンスしてドラッグ中の連続 invoke を抑制
    if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
    seekDebounceRef.current = setTimeout(async () => {
      await invoke('stop_playback').catch(() => {});
      if (!useAppStore.getState().audioMuted) playAudio(frame / project.fps);
      await invoke('start_playback', {
        projectJson: getPlaybackJSON(),
        startFrame: frame,
        loopEnabled,
        loopIn,
        loopOut,
      }).catch(console.error);
    }, 80);
  }, [setCurrentFrame]);

  // ─── Resize ──────────────────────────────────────────────────────

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ─── Draw ────────────────────────────────────────────────────────

  const drawRef = useRef<() => void>(() => {});

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const W = size.w, H = size.h;

    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    }

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const vStart = viewStartFrame;
    const z = zoom;
    const { major, minor } = getRulerTick(z, fps);
    const d = drag.current;

    ctx.fillStyle = '#181818';
    ctx.fillRect(0, 0, W, H);

    // ── Waveform strip ──────────────────────────────────────────
    if (waveformSamples && waveformSamples.length > 0) {
      const wTop = RULER_H;
      const wH = WAVEFORM_H;
      const midY = wTop + wH / 2;
      const ampH = (wH / 2) * 0.85;

      ctx.fillStyle = '#1c1c1c';
      ctx.fillRect(0, wTop, W, wH);

      // Total pixel width of the audio (from frame 0 to durationFrames)
      const totalPx = durationFrames / z;
      const startX = frameToX(0, vStart, z);
      const endX = frameToX(durationFrames, vStart, z);

      if (endX > 0 && startX < W) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(Math.max(0, startX), wTop, Math.min(W, endX) - Math.max(0, startX), wH);
        ctx.clip();

        const numSamples = waveformSamples.length;
        // Map each canvas pixel x to a sample index
        const waveStep = isPlaying ? 2 : 1;
        ctx.fillStyle = '#3a7a5a';
        ctx.beginPath();
        let firstPoint = true;
        // Draw top half (positive)
        for (let px = Math.max(0, Math.floor(startX)); px <= Math.min(W, Math.ceil(endX)); px += waveStep) {
          const t = (px - startX) / (totalPx > 0 ? totalPx : 1);
          const sIdx = Math.min(numSamples - 1, Math.floor(t * numSamples));
          const amp = waveformSamples[sIdx] * ampH;
          if (firstPoint) { ctx.moveTo(px, midY - amp); firstPoint = false; }
          else ctx.lineTo(px, midY - amp);
        }
        // Draw bottom half (mirrored)
        for (let px = Math.min(W, Math.ceil(endX)); px >= Math.max(0, Math.floor(startX)); px -= waveStep) {
          const t = (px - startX) / (totalPx > 0 ? totalPx : 1);
          const sIdx = Math.min(numSamples - 1, Math.floor(t * numSamples));
          const amp = waveformSamples[sIdx] * ampH;
          ctx.lineTo(px, midY + amp);
        }
        ctx.closePath();
        ctx.fill();

        // Bright outline on top edge
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        firstPoint = true;
        for (let px = Math.max(0, Math.floor(startX)); px <= Math.min(W, Math.ceil(endX)); px += waveStep) {
          const t = (px - startX) / (totalPx > 0 ? totalPx : 1);
          const sIdx = Math.min(numSamples - 1, Math.floor(t * numSamples));
          const amp = waveformSamples[sIdx] * ampH;
          if (firstPoint) { ctx.moveTo(px, midY - amp); firstPoint = false; }
          else ctx.lineTo(px, midY - amp);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      // Bottom border
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(0, wTop + wH - 1, W, 1);
    }

    // ── Sequence rows ───────────────────────────────────────────
    for (let i = 0; i < sequences.length; i++) {
      const seq = sequences[i];
      const rowH = rowHArr[i];
      const rowTop = getRowTop(i, vertScroll, rowHArr, contentTop);
      const rowBot = rowTop + rowH;
      if (rowBot <= RULER_H || rowTop >= H) continue;

      const clipTop = Math.max(RULER_H, rowTop);
      const clipBot = Math.min(H, rowBot);

      ctx.fillStyle = i % 2 === 0 ? '#1a1a1a' : '#1d1d1d';
      ctx.fillRect(0, clipTop, W, clipBot - clipTop);
      ctx.fillStyle = '#282828';
      ctx.fillRect(0, rowBot - 1, W, 1);

      // ─ Color row ──────────────────────────────────────────
      if (seq.kind === 'color') {
        if (!seq.enabled || seq.muted) continue;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, clipTop, W, clipBot - clipTop); ctx.clip();
        const stripTop = rowTop + 6;
        const stripBot = rowTop + rowH - COLOR_KF_HALF * 2 - 6;
        const stripH = Math.max(8, stripBot - stripTop);

        // Checkerboard (alpha visualization)
        const cell = 6;
        for (let cy = stripTop; cy < stripTop + stripH; cy += cell) {
          for (let cx = 0; cx < W; cx += cell) {
            const dark = ((Math.floor(cx / cell) + Math.floor((cy - stripTop) / cell)) & 1) === 0;
            ctx.fillStyle = dark ? '#1a1a1a' : '#252525';
            ctx.fillRect(cx, cy, cell, Math.min(cell, stripTop + stripH - cy));
          }
        }

        const sortedC = [...seq.colorKeyframes].sort((a, b) => a.frame - b.frame);
        if (sortedC.length > 0) {
          const firstX = frameToX(sortedC[0].frame, vStart, z);
          const lastX = frameToX(sortedC[sortedC.length - 1].frame, vStart, z);
          // Solid extension before first kf
          const c0 = sortedC[0];
          ctx.fillStyle = colorCss(c0);
          ctx.fillRect(0, stripTop, Math.max(0, Math.min(W, firstX)), stripH);
          // Solid extension after last kf
          const cE = sortedC[sortedC.length - 1];
          ctx.fillStyle = colorCss(cE);
          ctx.fillRect(Math.max(0, lastX), stripTop, Math.max(0, W - Math.max(0, lastX)), stripH);
          // Sample per visible segment, not per keyframe per pixel.
          const colorStep = isPlaying ? 6 : 3;
          for (let j = 0; j < sortedC.length - 1; j++) {
            const a = sortedC[j];
            const b = sortedC[j + 1];
            const x1 = frameToX(a.frame, vStart, z);
            const x2 = frameToX(b.frame, vStart, z);
            if (x2 < 0 || x1 > W) continue;
            const sx = Math.max(0, Math.floor(x1));
            const ex = Math.min(W, Math.ceil(x2));
            if (a.interpolation === 'step') {
              ctx.fillStyle = colorCss(a);
              ctx.fillRect(sx, stripTop, Math.max(1, ex - sx), stripH);
              continue;
            }
            for (let px = sx; px <= ex; px += colorStep) {
              const nextPx = Math.min(ex + 1, px + colorStep);
              const frame = xToFrame(px + (nextPx - px) / 2, vStart, z);
              ctx.fillStyle = colorCss(interpolateColorBetween(a, b, frame));
              ctx.fillRect(px, stripTop, Math.max(1, nextPx - px), stripH);
            }
          }
        }

        // Border
        ctx.strokeStyle = '#3a3a3a';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, stripTop + 0.5, W - 1, stripH - 1);

        // Diamond markers
        const dy = rowTop + rowH - COLOR_KF_HALF - 4;
        for (const kf of sortedC) {
          const dx = frameToX(kf.frame, vStart, z);
          if (dx < -COLOR_KF_HALF - 1 || dx > W + COLOR_KF_HALF + 1) continue;
          ctx.save();
          ctx.translate(dx, dy);
          ctx.beginPath();
          ctx.moveTo(0, -COLOR_KF_HALF); ctx.lineTo(COLOR_KF_HALF, 0);
          ctx.lineTo(0, COLOR_KF_HALF); ctx.lineTo(-COLOR_KF_HALF, 0);
          ctx.closePath();
          ctx.fillStyle = `rgb(${Math.round(kf.r*255)},${Math.round(kf.g*255)},${Math.round(kf.b*255)})`;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.fill(); ctx.stroke();
          ctx.restore();
        }

        ctx.restore();
        continue;
      }

      // ─ Flag row ───────────────────────────────────────────
      if (seq.kind === 'flag') {
        if (!seq.enabled || seq.muted) continue;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, clipTop, W, clipBot - clipTop); ctx.clip();
        const fTop = rowTop + FLAG_PAD_Y;
        const fH = rowH - FLAG_PAD_Y * 2;
        ctx.font = `11px ui-sans-serif, system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        for (const f of seq.flags) {
          const x1 = frameToX(f.frame, vStart, z);
          const w = Math.max(FLAG_MIN_PX, f.duration / z);
          if (x1 + w < 0 || x1 > W) continue;
          const isSelected = selectedFlag?.seqId === seq.id && selectedFlag?.flagId === f.id;
          ctx.fillStyle = f.duration > 0 ? `${seq.color}55` : seq.color;
          ctx.fillRect(x1, fTop, w, fH);
          ctx.strokeStyle = isSelected ? '#fff' : seq.color;
          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.strokeRect(x1 + 0.5, fTop + 0.5, w - 1, fH - 1);
          if (f.text) {
            ctx.save();
            const clipX = Math.max(0, x1 + 4);
            const clipR = Math.min(W, x1 + w - 4);
            ctx.beginPath();
            ctx.rect(clipX, fTop, Math.max(0, clipR - clipX), fH);
            ctx.clip();
            ctx.fillStyle = '#e0e0e0';
            ctx.textAlign = 'center';
            const flagCenter = x1 + w / 2;
            const textW = ctx.measureText(f.text).width;
            const halfW = textW / 2;
            // Clamp center so text stays inside the visible/clipped band
            const minCenter = clipX + halfW;
            const maxCenter = clipR - halfW;
            const textX = minCenter > maxCenter
              ? (clipX + clipR) / 2
              : Math.max(minCenter, Math.min(maxCenter, flagCenter));
            ctx.fillText(f.text, textX, fTop + fH / 2);
            ctx.textAlign = 'start';
            ctx.restore();
          }
        }
        ctx.restore();
        continue;
      }

      // Value grid lines + labels
      {
        const valInterval = getValueGridInterval(seq.min, seq.max);
        const firstMult = Math.ceil((seq.min + valInterval * 0.01) / valInterval);
        const lastMult  = Math.floor((seq.max - valInterval * 0.01) / valInterval);
        ctx.save();
        ctx.beginPath(); ctx.rect(0, clipTop, W, clipBot - clipTop); ctx.clip();
        ctx.font = `9px ui-monospace, 'SF Mono', Menlo, monospace`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        for (let m = firstMult; m <= lastMult; m++) {
          const v = m * valInterval;
          const gy = Math.round(valueToY(v, rowTop, seq, rowH)) + 0.5;
          const isZero = v === 0;
          ctx.setLineDash(isZero ? [3, 4] : []);
          ctx.strokeStyle = isZero ? '#2e2e2e' : '#232323';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = isZero ? '#3a3a3a' : '#2c2c2c';
          ctx.fillText(formatGridLabel(v, valInterval), 4, gy - 5);
        }
        ctx.restore();
      }

      if (!seq.enabled || seq.muted) continue;

      const sorted = [...seq.keyframes].sort((a, b) => a.frame - b.frame);
      if (sorted.length === 0) continue;

      const firstKf = sorted[0], lastKf = sorted[sorted.length - 1];
      const startPx = Math.max(-1, frameToX(firstKf.frame, vStart, z));
      const endPx = Math.min(W + 1, frameToX(lastKf.frame, vStart, z));

      // Curve
      ctx.save();
      ctx.beginPath(); ctx.rect(0, clipTop, W, clipBot - clipTop); ctx.clip();
      ctx.beginPath();
      ctx.strokeStyle = seq.color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85;
      let started = false;
      const curveStep = isPlaying ? 2 : 1;
      for (let px = Math.floor(startPx) - 1; px <= Math.ceil(endPx) + 1; px += curveStep) {
        const f = xToFrame(px, vStart, z);
        if (f < firstKf.frame || f > lastKf.frame) continue;
        const val = interpolateValue(sorted, f);
        const cy = valueToY(val, rowTop, seq, rowH);
        if (!started) { ctx.moveTo(px, cy); started = true; } else ctx.lineTo(px, cy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();

      // Bezier handles (for selected bezier kfs)
      for (let j = 0; j < sorted.length - 1; j++) {
        const kf = sorted[j];
        if (kf.interpolation !== 'bezier') continue;
        const isKfSelected = selectedKeyframes.get(seq.id)?.has(kf.frame) ?? false;
        const isBzDragging = d.type === 'bz' && d.bzSeqId === seq.id && d.bzFrame === kf.frame;
        if (!isKfSelected && !isBzDragging) continue;

        const nextKf = sorted[j + 1];
        const { kx, ky, nkx, nky, h1x, h1y, h2x, h2y } = getBzHandles(kf, nextKf, rowTop, seq, rowH, vStart, z);

        ctx.save();
        ctx.beginPath(); ctx.rect(0, clipTop - BZ_R * 2, W, clipBot - clipTop + BZ_R * 4); ctx.clip();

        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(kx, ky); ctx.lineTo(h1x, h1y);
        ctx.moveTo(nkx, nky); ctx.lineTo(h2x, h2y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#fff';
        ctx.fillStyle = '#60a5fa';
        ctx.beginPath(); ctx.arc(h1x, h1y, BZ_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(h2x, h2y, BZ_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }

      // Keyframe diamonds
      for (const kf of sorted) {
        const kx = frameToX(kf.frame, vStart, z);
        if (kx < -KF_HALF - 1 || kx > W + KF_HALF + 1) continue;
        const ky = clamp(valueToY(kf.value, rowTop, seq, rowH), clipTop + KF_HALF, clipBot - KF_HALF);
        const isSelected = selectedKeyframes.get(seq.id)?.has(kf.frame) ?? false;

        ctx.save();
        ctx.translate(kx, ky);
        ctx.beginPath();
        ctx.moveTo(0, -KF_HALF); ctx.lineTo(KF_HALF, 0);
        ctx.lineTo(0, KF_HALF); ctx.lineTo(-KF_HALF, 0);
        ctx.closePath();
        if (isSelected) {
          ctx.fillStyle = '#ffffff'; ctx.strokeStyle = seq.color; ctx.lineWidth = 1.5;
          ctx.fill(); ctx.stroke();
        } else {
          ctx.fillStyle = seq.color; ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
          ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      }
    }

    // ── Grid lines ─────────────────────────────────────────────
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
    const firstMajor = Math.ceil(vStart / major) * major;
    for (let f = firstMajor; frameToX(f, vStart, z) <= W; f += major) {
      const x = frameToX(f, vStart, z);
      ctx.beginPath(); ctx.moveTo(x + 0.5, contentTop); ctx.lineTo(x + 0.5, H); ctx.stroke();
    }

    const durX = Math.round(frameToX(durationFrames, vStart, z));
    if (durX >= 0 && durX <= W) {
      ctx.strokeStyle = '#505050'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(durX + 0.5, contentTop); ctx.lineTo(durX + 0.5, H); ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Ruler ──────────────────────────────────────────────────
    ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, W, RULER_H);
    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(0, RULER_H - 1, W, 1);
    ctx.font = `10px ui-monospace, 'SF Mono', Menlo, monospace`;
    ctx.textBaseline = 'middle';

    const firstMinor = Math.ceil(vStart / minor) * minor;
    for (let f = firstMinor; frameToX(f, vStart, z) <= W; f += minor) {
      const x = frameToX(f, vStart, z);
      ctx.fillStyle = '#3a3a3a'; ctx.fillRect(Math.round(x), RULER_H - 5, 1, 4);
    }
    for (let f = firstMajor; frameToX(f, vStart, z) <= W; f += major) {
      const x = frameToX(f, vStart, z);
      ctx.fillStyle = '#555'; ctx.fillRect(Math.round(x), RULER_H - 10, 1, 9);
      ctx.fillStyle = '#888';
      ctx.textAlign = x < 24 ? 'left' : 'center';
      ctx.fillText(formatRulerLabel(f, fps), x, RULER_H / 2 - 1);
    }

    // ── Playhead ───────────────────────────────────────────────
    const phX = Math.round(frameToX(currentFrame, vStart, z));
    if (phX >= -1 && phX <= W + 1) {
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(phX + 0.5, 0); ctx.lineTo(phX + 0.5, H); ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(phX - 5, 0); ctx.lineTo(phX + 6, 0); ctx.lineTo(phX + 0.5, 11);
      ctx.closePath(); ctx.fill();
    }

    // ── Snap indicator ─────────────────────────────────────────
    if ((d.type === 'kf' || d.type === 'flagMove' || d.type === 'flagResize' || d.type === 'colorKfMove') && d.snapTargetFrame !== undefined) {
      const snapX = frameToX(d.snapTargetFrame, vStart, z);
      ctx.save();
      ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(snapX + 0.5, contentTop); ctx.lineTo(snapX + 0.5, H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#4ade80'; ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(snapX, contentTop); ctx.lineTo(snapX + 5, contentTop + 8);
      ctx.lineTo(snapX, contentTop + 16); ctx.lineTo(snapX - 5, contentTop + 8);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // ── Marquee ────────────────────────────────────────────────
    if (d.type === 'marquee' && d.curX !== undefined && d.curY !== undefined) {
      const rx = Math.min(d.startX, d.curX), ry = Math.min(d.startY, d.curY);
      const rw = Math.abs(d.curX - d.startX), rh = Math.abs(d.curY - d.startY);
      ctx.fillStyle = 'rgba(59,130,246,0.07)'; ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = 'rgba(59,130,246,0.55)'; ctx.lineWidth = 1;
      ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
    }
  }, [size, sequences, fps, durationFrames, currentFrame, viewStartFrame, zoom, selectedKeyframes, vertScroll, rowHArr, waveformSamples, contentTop, selectedFlag, isPlaying]);

  useEffect(() => { drawRef.current = draw; }, [draw]);
  useEffect(() => { draw(); }, [draw]);

  // 初回サイズ確定時だけ全体をフィット
  useEffect(() => {
    if (didFitInitialViewRef.current || size.w === 0 || durationFrames === 0) return;
    const usableW = size.w - LEFT_PAD * 2;
    setZoom(durationFrames / usableW);
    setViewStartFrame(0);
    didFitInitialViewRef.current = true;
  }, [durationFrames, size.w]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Helpers ────────────────────────────────────────────────────

  const getXY = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // ─── Context menu close on outside click ──────────────────────

  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      const menu = document.querySelector('[data-kf-menu]');
      if (menu?.contains(e.target as Node)) return;
      setContextMenu(null);
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [contextMenu]);

  // ─── Mouse down ──────────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setContextMenu(null);
      const { x, y } = getXY(e);
      const vStart = viewStartFrame, z = zoom;

      // Ruler seek (ruler area + waveform strip)
      if (y < contentTop) {
        lastTapRef.current = null;
        const frame = clamp(Math.round(xToFrame(x, vStart, z)), 0, durationFrames);
        seekTo(frame);
        drag.current = { type: 'seek', startX: x, startY: y, startViewStart: vStart };
        setCursor('col-resize');
        return;
      }

      // Hit test color keyframes
      const ckfHit = hitTestColorKeyframe(x, y, sequences, vStart, z, vertScroll, rowHArr, contentTop);
      if (ckfHit) {
        lastTapRef.current = null;
        setSelectedSequence(ckfHit.seqId);
        toggleKeyframeSelection(ckfHit.seqId, ckfHit.frame, e.shiftKey || e.metaKey || e.ctrlKey);
        const seq = sequences.find((s) => s.id === ckfHit.seqId);
        if (seq?.locked) return;
        drag.current = {
          type: 'colorKfMove', startX: x, startY: y, startViewStart: vStart,
          ckfSeqId: ckfHit.seqId, ckfSeqIndex: ckfHit.seqIndex, ckfCurFrame: ckfHit.frame,
        };
        setCursor('grab');
        return;
      }

      // Hit test flags first (only flag-kind sequences)
      const flagHit = hitTestFlag(x, y, sequences, vStart, z, vertScroll, rowHArr, contentTop);
      if (flagHit) {
        lastTapRef.current = null;
        setSelectedSequence(flagHit.seqId);
        useAppStore.getState().setSelectedFlag({ seqId: flagHit.seqId, flagId: flagHit.flag.id });
        const seq = sequences.find((s) => s.id === flagHit.seqId);
        if (seq?.locked) return;
        drag.current = {
          type: flagHit.edge === 'right' ? 'flagResize' : 'flagMove',
          startX: x, startY: y, startViewStart: vStart,
          flagSeqId: flagHit.seqId,
          flagId: flagHit.flag.id,
          flagInitFrame: flagHit.flag.frame,
          flagInitDuration: flagHit.flag.duration,
        };
        setCursor(flagHit.edge === 'right' ? 'ew-resize' : 'grab');
        return;
      }

      // Hit test bezier handles first
      const bzHit = hitTestBzHandle(x, y, sequences, vStart, z, vertScroll, useAppStore.getState().selectedKeyframes, rowHArr, contentTop);
      if (bzHit) {
        lastTapRef.current = null;
        const seq = sequences.find((s) => s.id === bzHit.seqId);
        if (seq?.locked) return;
        drag.current = {
          type: 'bz', startX: x, startY: y, startViewStart: vStart,
          bzSeqId: bzHit.seqId, bzFrame: bzHit.frame,
          bzHandle: bzHit.handle, bzNextFrame: bzHit.nextFrame,
        };
        setCursor('crosshair');
        return;
      }

      // Hit test keyframes
      const hit = hitTestKeyframe(x, y, sequences, vStart, z, vertScroll, rowHArr, contentTop);
      if (hit) {
        lastTapRef.current = null;
        const currentSel = useAppStore.getState().selectedKeyframes;
        const clickedIsSelected = currentSel.get(hit.seqId)?.has(hit.frame) ?? false;
        const totalSelected = [...currentSel.values()].reduce((s, set) => s + set.size, 0);
        const isMultiDrag = clickedIsSelected && totalSelected > 1 && !e.shiftKey && !e.metaKey && !e.ctrlKey;

        if (isMultiDrag) {
          const freshSeqs = useAppStore.getState().project.sequences;
          const positions: MultiInitPos[] = [];
          const excludeFrames = new Set<number>();
          for (const [sid, frames] of currentSel) {
            const seq = freshSeqs.find((s) => s.id === sid);
            if (!seq) continue;
            for (const f of frames) {
              const kf = seq.keyframes.find((k) => k.frame === f);
              if (kf) { positions.push({ seqId: sid, frame: f, value: kf.value }); excludeFrames.add(f); }
            }
          }
          drag.current = {
            type: 'kf', startX: x, startY: y, startViewStart: vStart,
            kfSeqId: hit.seqId, kfSeqIndex: hit.seqIndex, kfCurFrame: hit.frame,
            kfMultiInitPositions: positions, kfAnchorInitFrame: hit.frame, kfPrevDelta: 0,
          };
        } else {
          const multi = e.shiftKey || e.metaKey || e.ctrlKey;
          setSelectedSequence(hit.seqId);
          toggleKeyframeSelection(hit.seqId, hit.frame, multi);
          drag.current = {
            type: 'kf', startX: x, startY: y, startViewStart: vStart,
            kfSeqId: hit.seqId, kfSeqIndex: hit.seqIndex, kfCurFrame: hit.frame,
          };
        }
        setCursor('grab');
        return;
      }

      // Double-click detection (replaces onDoubleClick which is unreliable on trackpad)
      const now = Date.now();
      const last = lastTapRef.current;
      const isDoubleTap = last != null &&
        (now - last.time) < 350 &&
        Math.hypot(x - last.x, y - last.y) < 8;
      lastTapRef.current = { time: now, x, y };

      if (isDoubleTap) {
        lastTapRef.current = null;
        const rowIndex = getRowIndexAt(y, vertScroll, rowHArr, contentTop);
        if (rowIndex >= 0 && rowIndex < sequences.length) {
          const seq = sequences[rowIndex];
          if (!seq.locked) {
            const frame = clamp(Math.round(xToFrame(x, vStart, z)), 0, durationFrames);
            if (seq.kind === 'color') {
              const gridSize = useAppStore.getState().snapGridSize;
              const snap = getSnappedFrame(frame, sequences, z, { gridSize });
              const sortedC = [...seq.colorKeyframes].sort((a, b) => a.frame - b.frame);
              const prev = [...sortedC].reverse().find((k) => k.frame <= frame) ?? sortedC[0];
              const baseColor = prev ? { r: prev.r, g: prev.g, b: prev.b, a: prev.a } : { r: 1, g: 1, b: 1, a: 1 };
              useAppStore.getState().addColorKeyframe(seq.id, {
                frame: clamp(snap.frame, 0, durationFrames),
                ...baseColor,
                interpolation: 'linear',
              });
              setSelectedSequence(seq.id);
              toggleKeyframeSelection(seq.id, clamp(snap.frame, 0, durationFrames), false);
            } else if (seq.kind === 'flag') {
              const defaultDur = Math.round(durationFrames * 0.05);
              const gridSize = useAppStore.getState().snapGridSize;
              const snap = getSnappedFrame(frame, sequences, z, { gridSize });
              const newId = generateId();
              useAppStore.getState().addFlag(seq.id, {
                id: newId,
                frame: clamp(snap.frame, 0, durationFrames - defaultDur),
                duration: defaultDur,
                text: '',
              });
              useAppStore.getState().setSelectedFlag({ seqId: seq.id, flagId: newId });
            } else {
              const rowTop = getRowTop(rowIndex, vertScroll, rowHArr, contentTop);
              const value = clamp(yToValue(y, rowTop, seq, rowHArr[rowIndex]), seq.min, seq.max);
              addKeyframe(seq.id, { frame, value, interpolation: 'linear' });
            }
            setSelectedSequence(seq.id);
          }
        }
        return;
      }

      // Row selection
      const rowIndex = getRowIndexAt(y, vertScroll, rowHArr, contentTop);
      if (rowIndex >= 0 && rowIndex < sequences.length) {
        setSelectedSequence(sequences[rowIndex].id);
      }

      if (e.altKey) {
        drag.current = { type: 'pan', startX: x, startY: y, startViewStart: vStart };
        setCursor('grabbing');
        return;
      }

      if (!e.shiftKey) clearKeyframeSelection();
      drag.current = { type: 'marquee', startX: x, startY: y, startViewStart: vStart, curX: x, curY: y };
      setCursor('crosshair');
    },
    [sequences, viewStartFrame, zoom, vertScroll, durationFrames, rowHArr,
     setCurrentFrame, setSelectedSequence, toggleKeyframeSelection, clearKeyframeSelection, addKeyframe, contentTop]
  );

  // ─── Mouse move ──────────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const d = drag.current;
      if (d.type === 'idle') return;
      const { x, y } = getXY(e);
      const z = zoom;

      if (d.type === 'seek') {
        seekTo(clamp(Math.round(xToFrame(x, d.startViewStart, z)), 0, durationFrames));
        return;
      }

      if (d.type === 'colorKfMove' && d.ckfSeqId && d.ckfCurFrame !== undefined) {
        const freshSeqs = useAppStore.getState().project.sequences;
        const seq = freshSeqs.find((s) => s.id === d.ckfSeqId);
        if (!seq || seq.locked) return;
        const continuousFrame = clamp(xToFrame(x, d.startViewStart, z), 0, durationFrames);
        const rawFrame = Math.round(continuousFrame);
        const gridSize = useAppStore.getState().snapGridSize;
        const snap = getSnappedFrame(rawFrame, freshSeqs, z, { excludeSeqId: d.ckfSeqId, gridSize });
        const finalFrame = snap.frame;
        if (finalFrame !== d.ckfCurFrame && !seq.colorKeyframes.some((k) => k.frame === finalFrame)) {
          useAppStore.getState().moveColorKeyframe(d.ckfSeqId, d.ckfCurFrame, finalFrame);
          // remap selection
          const sel = useAppStore.getState().selectedKeyframes;
          const frames = sel.get(d.ckfSeqId);
          if (frames?.has(d.ckfCurFrame)) {
            const next = new Set(frames);
            next.delete(d.ckfCurFrame); next.add(finalFrame);
            const m = new Map(sel); m.set(d.ckfSeqId, next);
            setSelectedKeyframesBatch(m);
          }
          drag.current = { ...d, ckfCurFrame: finalFrame, snapTargetFrame: snap.snapped ? finalFrame : undefined };
        } else {
          drag.current = { ...d, snapTargetFrame: snap.snapped ? snap.frame : undefined };
        }
        drawRef.current();
        return;
      }

      if ((d.type === 'flagMove' || d.type === 'flagResize') && d.flagSeqId && d.flagId) {
        const dxFrames = (x - d.startX) * z;
        const updateFlag = useAppStore.getState().updateFlag;
        const freshSeqs = useAppStore.getState().project.sequences;
        const seq = freshSeqs.find((s) => s.id === d.flagSeqId);
        if (!seq || seq.locked) return;
        const gridSize = useAppStore.getState().snapGridSize;
        const initFrame = d.flagInitFrame ?? 0;
        const initDur = d.flagInitDuration ?? 0;

        if (d.type === 'flagMove') {
          const rawFrame = clamp(Math.round(initFrame + dxFrames), 0, durationFrames - initDur);
          // Snap the leading edge (start), and also test trailing edge for snap-to-edge
          const snapStart = getSnappedFrame(rawFrame, freshSeqs, z, { excludeFlagId: d.flagId, gridSize });
          const snapEnd = initDur > 0
            ? getSnappedFrame(rawFrame + initDur, freshSeqs, z, { excludeFlagId: d.flagId, gridSize })
            : { frame: rawFrame + initDur, snapped: false };
          let finalFrame = rawFrame;
          let snapTarget: number | undefined;
          // Pick whichever edge has a smaller pixel distance, if any snapped
          const distStart = snapStart.snapped ? Math.abs(snapStart.frame - rawFrame) : Infinity;
          const distEnd = snapEnd.snapped ? Math.abs(snapEnd.frame - (rawFrame + initDur)) : Infinity;
          if (distStart <= distEnd && snapStart.snapped) {
            finalFrame = snapStart.frame;
            snapTarget = snapStart.frame;
          } else if (snapEnd.snapped) {
            finalFrame = snapEnd.frame - initDur;
            snapTarget = snapEnd.frame;
          }
          finalFrame = clamp(finalFrame, 0, durationFrames - initDur);
          updateFlag(d.flagSeqId, d.flagId, { frame: finalFrame });
          drag.current = { ...d, snapTargetFrame: snapTarget };
        } else {
          const rawEnd = clamp(Math.round(initFrame + initDur + dxFrames), initFrame, durationFrames);
          const snap = getSnappedFrame(rawEnd, freshSeqs, z, { excludeFlagId: d.flagId, gridSize });
          const finalEnd = clamp(snap.frame, initFrame, durationFrames);
          updateFlag(d.flagSeqId, d.flagId, { duration: finalEnd - initFrame });
          drag.current = { ...d, snapTargetFrame: snap.snapped ? finalEnd : undefined };
        }
        drawRef.current();
        return;
      }

      if (d.type === 'bz' && d.bzSeqId && d.bzFrame !== undefined && d.bzNextFrame !== undefined && d.bzHandle) {
        const freshSeqs = useAppStore.getState().project.sequences;
        const seqIdx = freshSeqs.findIndex((s) => s.id === d.bzSeqId);
        if (seqIdx < 0) return;
        const seq = freshSeqs[seqIdx];
        if (seq.locked) return;
        const kf = seq.keyframes.find((k) => k.frame === d.bzFrame);
        const nextKf = seq.keyframes.find((k) => k.frame === d.bzNextFrame);
        if (!kf || !nextKf) return;

        const frameSpan = nextKf.frame - kf.frame;
        const valueSpan = nextKf.value - kf.value;
        const mouseFrame = xToFrame(x, d.startViewStart, z);
        const rowTop = getRowTop(seqIdx, vertScroll, rowHArr, contentTop);
        const mouseValue = yToValue(y, rowTop, seq, rowHArr[seqIdx]);

        const normX = frameSpan > 0 ? clamp((mouseFrame - kf.frame) / frameSpan, 0, 1) : 0;
        const normY = Math.abs(valueSpan) > 1e-10 ? (mouseValue - kf.value) / valueSpan : 0;

        if (d.bzHandle === 'cp1') {
          updateKeyframe(d.bzSeqId, d.bzFrame, { cp1x: normX, cp1y: normY });
        } else {
          updateKeyframe(d.bzSeqId, d.bzFrame, { cp2x: normX, cp2y: normY });
        }
        drawRef.current();
        return;
      }

      if (d.type === 'kf' && d.kfSeqId != null && d.kfSeqIndex != null) {
        const freshSeqs = useAppStore.getState().project.sequences;
        const seq = freshSeqs.find((s) => s.id === d.kfSeqId);
        if (!seq || seq.locked) return;

        // Use startViewStart so frame position stays stable even if view shifts mid-drag
        const continuousFrame = clamp(xToFrame(x, d.startViewStart, z), 0, durationFrames);
        const rawFrame = Math.round(continuousFrame);

        let finalFrame: number;
        let isSnapped: boolean;

        const gridSize = useAppStore.getState().snapGridSize;

        const snapOpts = d.kfMultiInitPositions
          ? {
              excludeFrames: new Set(d.kfMultiInitPositions.map((p) => p.frame + (d.kfPrevDelta ?? 0))),
              gridSize,
            }
          : { excludeSeqId: d.kfSeqId, gridSize };

        if (d.snapLocked !== undefined) {
          // Use continuous (unrounded) frame for pixel distance so snap releases at exactly SNAP_PX
          const pixelDist = Math.abs(continuousFrame - d.snapLocked) / z;
          if (pixelDist <= SNAP_PX) {
            finalFrame = d.snapLocked; isSnapped = true;
          } else {
            const r = getSnappedFrame(rawFrame, freshSeqs, z, snapOpts);
            finalFrame = r.frame; isSnapped = r.snapped;
          }
        } else {
          const r = getSnappedFrame(rawFrame, freshSeqs, z, snapOpts);
          finalFrame = r.frame; isSnapped = r.snapped;
        }

        if (d.kfMultiInitPositions) {
          const frameDelta = finalFrame - d.kfAnchorInitFrame!;
          if (frameDelta !== d.kfPrevDelta) {
            const prevDelta = d.kfPrevDelta ?? 0;
            const moves = d.kfMultiInitPositions.map((p) => ({
              seqId: p.seqId,
              fromFrame: clamp(p.frame + prevDelta, 0, durationFrames),
              toFrame: clamp(p.frame + frameDelta, 0, durationFrames),
              value: p.value,
            }));
            moveKeyframesBatch(moves);
            drag.current = {
              ...d,
              kfCurFrame: finalFrame,
              kfPrevDelta: frameDelta,
              snapLocked: isSnapped ? finalFrame : undefined,
              snapTargetFrame: isSnapped ? finalFrame : undefined,
            };
          }
        } else {
          const wouldCollide = finalFrame !== d.kfCurFrame! &&
            seq.keyframes.some((k) => k.frame === finalFrame);
          if (wouldCollide) {
            drag.current = { ...d, snapLocked: undefined, snapTargetFrame: undefined };
            drawRef.current();
            return;
          }
          const rowTop = getRowTop(d.kfSeqIndex, vertScroll, rowHArr, contentTop);
          const rowH = rowHArr[d.kfSeqIndex];
          let newValue = clamp(yToValue(y, rowTop, seq, rowH), seq.min, seq.max);

          // Vertical (value) snap to grid lines when snap is enabled
          if (gridSize > 0) {
            const valInterval = getValueGridInterval(seq.min, seq.max);
            const snappedVal = clamp(
              Math.round(newValue / valInterval) * valInterval,
              seq.min, seq.max
            );
            const dy = Math.abs(
              valueToY(newValue, rowTop, seq, rowH) - valueToY(snappedVal, rowTop, seq, rowH)
            );
            if (dy <= SNAP_PX) newValue = snappedVal;
          }

          moveKeyframe(d.kfSeqId, d.kfCurFrame!, finalFrame, newValue);
          drag.current = {
            ...d,
            kfCurFrame: finalFrame,
            snapLocked: isSnapped ? finalFrame : undefined,
            snapTargetFrame: isSnapped ? finalFrame : undefined,
          };
        }
        drawRef.current();
        return;
      }

      if (d.type === 'marquee') {
        drag.current = { ...d, curX: x, curY: y };
        drawRef.current();
        return;
      }

      if (d.type === 'pan') {
        const delta = (x - d.startX) * z;
        setViewStartFrame(d.startViewStart - delta);
      }
    },
    [viewStartFrame, zoom, vertScroll, durationFrames, rowHArr,
     setCurrentFrame, setViewStartFrame, moveKeyframe, moveKeyframesBatch, updateKeyframe, contentTop]
  );

  // ─── Mouse up ────────────────────────────────────────────────────

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const d = drag.current;

      if (d.type === 'kf' && d.kfMultiInitPositions && d.kfPrevDelta !== undefined) {
        const delta = d.kfPrevDelta;
        const newSel = new Map<string, Set<number>>();
        for (const p of d.kfMultiInitPositions) {
          const frames = newSel.get(p.seqId) ?? new Set<number>();
          frames.add(clamp(p.frame + delta, 0, durationFrames));
          newSel.set(p.seqId, frames);
        }
        setSelectedKeyframesBatch(newSel);
      }

      if (d.type === 'marquee' && d.curX !== undefined && d.curY !== undefined) {
        const mx1 = Math.min(d.startX, d.curX), mx2 = Math.max(d.startX, d.curX);
        const my1 = Math.min(d.startY, d.curY), my2 = Math.max(d.startY, d.curY);
        const vStart = viewStartFrame, z = zoom;
        const addMode = e.shiftKey || e.metaKey || e.ctrlKey;

        const batch = new Map<string, Set<number>>(
          addMode ? useAppStore.getState().selectedKeyframes : new Map()
        );
        let firstSeqId: string | null = null;

        for (let i = 0; i < sequences.length; i++) {
          const seq = sequences[i];
          const rowTop = getRowTop(i, vertScroll, rowHArr, contentTop);
          const rowH = rowHArr[i];
          for (const kf of seq.keyframes) {
            const kx = frameToX(kf.frame, vStart, z);
            const ky = valueToY(kf.value, rowTop, seq, rowH);
            if (kx >= mx1 && kx <= mx2 && ky >= my1 && ky <= my2) {
              const frames = batch.get(seq.id) ?? new Set<number>();
              frames.add(kf.frame);
              batch.set(seq.id, frames);
              if (!firstSeqId) firstSeqId = seq.id;
            }
          }
        }
        setSelectedKeyframesBatch(batch);
        if (firstSeqId) setSelectedSequence(firstSeqId);
      }

      drag.current = { type: 'idle', startX: 0, startY: 0, startViewStart: 0 };
      setCursor('crosshair');
      drawRef.current();
    },
    [sequences, viewStartFrame, zoom, vertScroll, durationFrames, rowHArr,
     setSelectedKeyframesBatch, setSelectedSequence, contentTop]
  );

  // ─── Right-click context menu ─────────────────────────────────────

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const { x, y } = getXY(e);
      if (y < contentTop) return;
      const flagHit = hitTestFlag(x, y, sequences, viewStartFrame, zoom, vertScroll, rowHArr, contentTop);
      if (flagHit) {
        const seq = sequences.find((s) => s.id === flagHit.seqId);
        if (seq?.locked) return;
        useAppStore.getState().removeFlag(flagHit.seqId, flagHit.flag.id);
        drawRef.current();
        return;
      }
      const ckfHitR = hitTestColorKeyframe(x, y, sequences, viewStartFrame, zoom, vertScroll, rowHArr, contentTop);
      if (ckfHitR) {
        const seq = sequences.find((s) => s.id === ckfHitR.seqId);
        if (seq?.locked) return;
        useAppStore.getState().removeColorKeyframe(ckfHitR.seqId, ckfHitR.frame);
        drawRef.current();
        return;
      }
      const hit = hitTestKeyframe(x, y, sequences, viewStartFrame, zoom, vertScroll, rowHArr, contentTop);
      if (!hit) return;
      const seq = sequences.find((s) => s.id === hit.seqId);
      const kf = seq?.keyframes.find((k) => k.frame === hit.frame);
      if (!kf) return;
      const { selectedKeyframes: sel } = useAppStore.getState();
      const totalSelected = [...sel.values()].reduce((s, set) => s + set.size, 0);
      const clickedIsSelected = sel.get(hit.seqId)?.has(hit.frame) ?? false;
      const rect = wrapRef.current!.getBoundingClientRect();
      setContextMenu({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        seqId: hit.seqId,
        frame: hit.frame,
        interp: kf.interpolation,
        isMulti: totalSelected > 1 && clickedIsSelected,
      });
    },
    [sequences, viewStartFrame, zoom, vertScroll, rowHArr, contentTop]
  );

  // ─── Wheel ──────────────────────────────────────────────────────

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const { x } = getXY(e);
      const pivotFrame = xToFrame(x, viewStartFrame, zoom);
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        setZoom(zoom * factor, pivotFrame);
      } else if (e.shiftKey) {
        const totalH = rowHArr.reduce((a, b) => a + b, 0);
        const maxV = Math.max(0, totalH - (size.h - contentTop));
        setVertScroll((s) => clamp(s + e.deltaY * 0.5, 0, maxV));
      } else {
        const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        setViewStartFrame(viewStartFrame + delta * zoom * 0.4);
      }
    },
    [viewStartFrame, zoom, rowHArr, size.h, setZoom, setViewStartFrame, contentTop]
  );

  // ─── Keyboard: delete / copy / paste ────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { removeKeyframe, removeColorKeyframe, selectedKeyframes: sel, project: proj, clearKeyframeSelection: clearSel } = useAppStore.getState();
        for (const [sid, frames] of sel) {
          const seq = proj.sequences.find((s) => s.id === sid);
          if (!seq || seq.locked) continue;
          if (seq.kind === 'color') {
            frames.forEach((f) => removeColorKeyframe(sid, f));
          } else {
            frames.forEach((f) => removeKeyframe(sid, f));
          }
        }
        clearSel();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        const { selectedKeyframes: sel, project: proj } = useAppStore.getState();
        const entries: ClipEntry[] = [];
        let minFrame = Infinity;
        for (const [sid, frames] of sel) {
          const seq = proj.sequences.find((s) => s.id === sid);
          if (!seq) continue;
          for (const f of frames) {
            const kf = seq.keyframes.find((k) => k.frame === f);
            if (kf) { entries.push({ seqId: sid, relFrame: f, kf: { ...kf } }); if (f < minFrame) minFrame = f; }
          }
        }
        if (entries.length > 0) {
          kfClipboard = entries.map((en) => ({ ...en, relFrame: en.relFrame - minFrame }));
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        if (kfClipboard.length === 0) return;
        const { selectedSequenceId: sid, currentFrame: cf, addKeyframes: addKfs } = useAppStore.getState();
        if (!sid) return;
        const kfsToAdd = kfClipboard.map((en) => ({ ...en.kf, frame: cf + en.relFrame }));
        addKfs(sid, kfsToAdd);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── Render ─────────────────────────────────────────────────────

  const GRID_OPTIONS = [
    { label: 'Off', value: 0 },
    { label: '1f',  value: 1 },
    { label: '5f',  value: 5 },
    { label: '10f', value: 10 },
    { label: '15f', value: 15 },
    { label: '30f', value: 30 },
    { label: '60f', value: 60 },
  ];

  return (
    <div ref={wrapRef} className="flex-1 overflow-hidden relative bg-[#181818]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block"
        style={{ cursor }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
      />

      {/* ── Snap grid control ── */}
      <div className="absolute bottom-2 right-2 z-30 flex items-center gap-1.5 bg-[#1e1e1e]/80 backdrop-blur border border-[#333] rounded px-2 py-1">
        <span className="text-[10px] text-[#555] font-mono select-none">SNAP</span>
        <div className="flex gap-px">
          {GRID_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              className={`px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors ${
                snapGridSize === value
                  ? 'bg-[#4ade80] text-black font-bold'
                  : 'text-[#555] hover:text-[#aaa]'
              }`}
              onMouseDown={(e) => { e.preventDefault(); setSnapGridSize(value); }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Right-click context menu ── */}
      {contextMenu && (
        <div
          data-kf-menu
          className="absolute z-50 bg-[#252525] border border-[#4a4a4a] rounded-lg shadow-xl py-1 min-w-[120px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.isMulti && (
            <div className="px-3 py-1 text-[10px] text-[#555] border-b border-[#3a3a3a] mb-0.5 select-none">
              {tl('applyToMulti')}
            </div>
          )}
          {INTERP_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 transition-colors ${
                contextMenu.interp === value
                  ? 'text-[#4ade80] font-semibold'
                  : 'text-[#aaa] hover:text-white hover:bg-[#333]'
              }`}
              onMouseDown={(ev) => {
                ev.preventDefault();
                if (contextMenu.isMulti) {
                  const { selectedKeyframes: sel } = useAppStore.getState();
                  for (const [sid, frames] of sel) {
                    for (const f of frames) {
                      updateKeyframe(sid, f, { interpolation: value });
                    }
                  }
                } else {
                  updateKeyframe(contextMenu.seqId, contextMenu.frame, { interpolation: value });
                }
                setContextMenu(null);
              }}
            >
              <InterpMini type={value} active={contextMenu.interp === value} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tiny SVG curve icons ─────────────────────────────────────────────

function InterpMini({ type, active }: { type: Interpolation; active: boolean }) {
  const color = active ? '#4ade80' : 'currentColor';
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" style={{ flexShrink: 0 }}>
      {type === 'step' && (
        <path d="M1 10 H8 V2 H17" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {type === 'linear' && (
        <line x1="1" y1="10" x2="17" y2="2" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      )}
      {type === 'smooth' && (
        <path d="M1 10 C5 10 13 2 17 2" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      )}
      {type === 'bezier' && (
        <path d="M1 10 C3 10 6 2 17 2" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}
