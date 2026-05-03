import type { Keyframe } from '../types';

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Cubic bezier: x component at parameter t
function bezierX(t: number, p1x: number, p2x: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * t * p1x + 3 * mt * t * t * p2x + t * t * t;
}

// Cubic bezier: y component at parameter t
function bezierY(t: number, p1y: number, p2y: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * t * p1y + 3 * mt * t * t * p2y + t * t * t;
}

// Find bezier t for a given normalized x (binary search, 24 iterations ≈ 1e-7 precision)
function solveBezierT(x: number, p1x: number, p2x: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    bezierX(mid, p1x, p2x) < x ? (lo = mid) : (hi = mid);
  }
  return (lo + hi) / 2;
}

export function interpolateValue(keyframes: Keyframe[], frame: number): number {
  if (keyframes.length === 0) return 0;

  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);

  if (frame <= sorted[0].frame) return sorted[0].value;
  if (frame >= sorted[sorted.length - 1].frame) return sorted[sorted.length - 1].value;

  let prev = sorted[0];
  let next = sorted[1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (frame >= sorted[i].frame && frame < sorted[i + 1].frame) {
      prev = sorted[i];
      next = sorted[i + 1];
      break;
    }
  }

  const t = (frame - prev.frame) / (next.frame - prev.frame);

  switch (prev.interpolation) {
    case 'step':
      return prev.value;
    case 'linear':
      return prev.value + (next.value - prev.value) * t;
    case 'smooth':
      return prev.value + (next.value - prev.value) * smoothstep(t);
    case 'bezier': {
      const cp1x = prev.cp1x ?? 0.25;
      const cp1y = prev.cp1y ?? 0.25;
      const cp2x = prev.cp2x ?? 0.75;
      const cp2y = prev.cp2y ?? 0.75;
      const bt = solveBezierT(t, cp1x, cp2x);
      const progress = bezierY(bt, cp1y, cp2y);
      return prev.value + (next.value - prev.value) * progress;
    }
    default:
      return prev.value + (next.value - prev.value) * t;
  }
}
