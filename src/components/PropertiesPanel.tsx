import { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../store';
import { useT, translations } from '../lib/i18n';
import { nameToOscAddress } from '../lib/utils';
import type { Interpolation } from '../types';

// ─── Bezier Editor ────────────────────────────────────────────────────

const BE_W = 170;
const BE_H = 130;
const BE_PAD = 18;
const BE_IW = BE_W - 2 * BE_PAD;
const BE_IH = BE_H - 2 * BE_PAD;

function bToC(bx: number, by: number) {
  return { cx: BE_PAD + bx * BE_IW, cy: BE_H - BE_PAD - by * BE_IH };
}
function cToB(cx: number, cy: number) {
  return {
    bx: Math.max(0, Math.min(1, (cx - BE_PAD) / BE_IW)),
    by: Math.max(0, Math.min(1, (BE_H - BE_PAD - cy) / BE_IH)),
  };
}

const PRESETS = [
  { label: 'Ease',    cp: [0.25, 0.1, 0.25, 1.0] },
  { label: 'EaseIn',  cp: [0.42, 0.0, 1.00, 1.0] },
  { label: 'EaseOut', cp: [0.00, 0.0, 0.58, 1.0] },
  { label: 'EI-EO',  cp: [0.42, 0.0, 0.58, 1.0] },
  { label: 'Linear', cp: [0.33, 0.33, 0.67, 0.67] },
  { label: 'Bounce', cp: [0.68, -0.55, 0.27, 1.55] },
] as const;

interface BezierEditorProps {
  cp1x: number; cp1y: number;
  cp2x: number; cp2y: number;
  color: string;
  onChange: (cp1x: number, cp1y: number, cp2x: number, cp2y: number) => void;
}

function BezierEditor({ cp1x, cp1y, cp2x, cp2y, color, onChange }: BezierEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<'cp1' | 'cp2' | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== BE_W * dpr) {
      canvas.width = BE_W * dpr;
      canvas.height = BE_H * dpr;
      canvas.style.width = `${BE_W}px`;
      canvas.style.height = `${BE_H}px`;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, BE_W, BE_H);

    // Grid
    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 1;
    for (const t of [0.25, 0.5, 0.75]) {
      ctx.beginPath();
      ctx.moveTo(BE_PAD + t * BE_IW, BE_PAD);
      ctx.lineTo(BE_PAD + t * BE_IW, BE_H - BE_PAD);
      ctx.moveTo(BE_PAD, BE_H - BE_PAD - t * BE_IH);
      ctx.lineTo(BE_PAD + BE_IW, BE_H - BE_PAD - t * BE_IH);
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = '#333';
    ctx.strokeRect(BE_PAD, BE_PAD, BE_IW, BE_IH);

    // Linear reference
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.moveTo(BE_PAD, BE_H - BE_PAD);
    ctx.lineTo(BE_PAD + BE_IW, BE_PAD);
    ctx.stroke();
    ctx.setLineDash([]);

    const p0 = bToC(0, 0);
    const p3 = bToC(1, 1);
    const p1 = bToC(cp1x, cp1y);
    const p2 = bToC(cp2x, cp2y);

    // Handle lines
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p0.cx, p0.cy);
    ctx.lineTo(p1.cx, p1.cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p3.cx, p3.cy);
    ctx.lineTo(p2.cx, p2.cy);
    ctx.stroke();

    // Bezier curve (60 samples)
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const mt = 1 - t;
      const bx = 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t;
      const by = 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t;
      const { cx, cy } = bToC(bx, by);
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Endpoints
    for (const { cx, cy } of [p0, p3]) {
      ctx.fillStyle = '#666';
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // cp1 handle (green)
    ctx.fillStyle = '#4ade80';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p1.cx, p1.cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // cp2 handle (blue)
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(p2.cx, p2.cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }, [cp1x, cp1y, cp2x, cp2y, color]);

  useEffect(() => { draw(); }, [draw]);

  const getLocal = (e: MouseEvent | React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
  };

  const hitHandle = (cx: number, cy: number) => {
    const r = 9;
    const { cx: c1x, cy: c1y } = bToC(cp1x, cp1y);
    const { cx: c2x, cy: c2y } = bToC(cp2x, cp2y);
    if (Math.hypot(cx - c1x, cy - c1y) < r) return 'cp1';
    if (Math.hypot(cx - c2x, cy - c2y) < r) return 'cp2';
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const { cx, cy } = getLocal(e);
    const hit = hitHandle(cx, cy);
    if (!hit) return;
    e.stopPropagation();
    dragging.current = hit;

    const onMove = (me: MouseEvent) => {
      const { cx: mx, cy: my } = getLocal(me);
      const { bx, by } = cToB(mx, my);
      if (dragging.current === 'cp1') onChange(bx, by, cp2x, cp2y);
      else onChange(cp1x, cp1y, bx, by);
    };
    const onUp = () => {
      dragging.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          style={{ width: BE_W, height: BE_H, cursor: 'crosshair', display: 'block' }}
          onMouseDown={handleMouseDown}
        />
        <div className="absolute top-1 left-2 text-[9px] text-[#444] pointer-events-none">
          <span style={{ color: '#4ade80' }}>●</span> Out &nbsp;
          <span style={{ color: '#60a5fa' }}>●</span> In
        </div>
      </div>
      {/* Presets */}
      <div className="flex flex-wrap gap-1">
        {PRESETS.map(({ label, cp }) => (
          <button
            key={label}
            onClick={() => onChange(cp[0], cp[1], cp[2], cp[3])}
            className="text-[10px] px-1.5 py-0.5 bg-[#2a2a2a] hover:bg-[#383838] rounded text-[#999] hover:text-white transition-colors"
          >
            {label}
          </button>
        ))}
      </div>
      {/* Numeric inputs */}
      <div className="grid grid-cols-2 gap-1 text-[10px]">
        <div>
          <div className="text-[#4ade80] mb-0.5">cp1</div>
          <div className="flex gap-1">
            <NumInput label="x" value={cp1x} min={0} max={1} step={0.01}
              onCommit={(v) => onChange(v, cp1y, cp2x, cp2y)} />
            <NumInput label="y" value={cp1y} min={-2} max={2} step={0.01}
              onCommit={(v) => onChange(cp1x, v, cp2x, cp2y)} />
          </div>
        </div>
        <div>
          <div className="text-[#60a5fa] mb-0.5">cp2</div>
          <div className="flex gap-1">
            <NumInput label="x" value={cp2x} min={0} max={1} step={0.01}
              onCommit={(v) => onChange(cp1x, cp1y, v, cp2y)} />
            <NumInput label="y" value={cp2y} min={-2} max={2} step={0.01}
              onCommit={(v) => onChange(cp1x, cp1y, cp2x, v)} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Commit-on-blur numeric input ─────────────────────────────────────

interface NumInputProps {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (v: number) => void;
}

function NumInput({ label, value, min, max, step = 1, onCommit }: NumInputProps) {
  const [local, setLocal] = useState('');
  const [focused, setFocused] = useState(false);

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (!isNaN(n)) {
      const clamped = min != null && max != null ? Math.max(min, Math.min(max, n)) : n;
      onCommit(clamped);
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      {label && <span className="text-[#555]">{label}</span>}
      <input
        type="number"
        value={focused ? local : String(value)}
        step={step}
        onFocus={() => { setFocused(true); setLocal(String(value)); }}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={(e) => { setFocused(false); commit(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.currentTarget.blur(); }
          if (e.key === 'Escape') { setFocused(false); }
          e.stopPropagation();
        }}
        className="w-full text-xs"
        style={{ minWidth: 0 }}
      />
    </div>
  );
}

// ─── PropertiesPanel ──────────────────────────────────────────────────

export default function PropertiesPanel() {
  const selectedId = useAppStore((s) => s.selectedSequenceId);
  const sequences = useAppStore((s) => s.project.sequences);
  const projectName = useAppStore((s) => s.project.projectName);
  const selectedKeyframes = useAppStore((s) => s.selectedKeyframes);
  const language = useAppStore((s) => s.language);
  const updateSequence = useAppStore((s) => s.updateSequence);
  const updateKeyframe = useAppStore((s) => s.updateKeyframe);
  const removeKeyframe = useAppStore((s) => s.removeKeyframe);
  const updateColorKeyframe = useAppStore((s) => s.updateColorKeyframe);
  const removeColorKeyframe = useAppStore((s) => s.removeColorKeyframe);
  const selectedFlag = useAppStore((s) => s.selectedFlag);
  const updateFlag = useAppStore((s) => s.updateFlag);
  const removeFlag = useAppStore((s) => s.removeFlag);
  const setSelectedFlag = useAppStore((s) => s.setSelectedFlag);
  const fps = useAppStore((s) => s.project.fps);
  const durationFrames = useAppStore((s) => s.project.durationFrames);
  const t = useT();

  const seq = sequences.find((s) => s.id === selectedId);
  const selKfFrames = selectedId ? [...(selectedKeyframes.get(selectedId) ?? [])] : [];
  const selKf = seq?.keyframes.filter((k) => selKfFrames.includes(k.frame)) ?? [];
  const kf = selKf.length === 1 ? selKf[0] : null;

  const roundedValue = (v: number) =>
    seq?.valueType === 'int' ? Math.round(v) : v;

  return (
    <div className="w-[220px] shrink-0 bg-[#1e1e1e] border-l border-[#3d3d3d] overflow-y-auto flex flex-col">
      {/* Sequence properties */}
      <Section title="Sequence">
        {seq ? (
          <div className="flex flex-col gap-2">
            <Field label="Name">
              <input
                type="text"
                value={seq.name}
                onChange={(e) => updateSequence(seq.id, { name: e.target.value, oscAddress: nameToOscAddress(e.target.value) })}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full"
              />
            </Field>
            <Field label="Color">
              <input
                type="color"
                value={seq.color}
                onChange={(e) => updateSequence(seq.id, { color: e.target.value })}
              />
            </Field>
            <Field label="OSC Address">
              <input
                type="text"
                value={seq.oscAddress}
                onChange={(e) => updateSequence(seq.id, { oscAddress: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full font-mono text-xs"
              />
              <span className="font-mono text-[10px] text-[#4ade80] truncate">
                {nameToOscAddress(projectName || 'tab')}{seq.oscAddress.startsWith('/') ? seq.oscAddress : '/' + seq.oscAddress}
              </span>
            </Field>
            {seq.kind !== 'flag' && <>
            <Field label={seq.kind === 'color' ? 'DMX Channel (R, G, B, A)' : 'DMX Channel'}>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={seq.dmxChannel === 0 ? '' : seq.dmxChannel}
                  placeholder="0 = off"
                  min={0}
                  max={512}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    updateSequence(seq.id, { dmxChannel: isNaN(v) ? 0 : Math.min(512, Math.max(0, v)) });
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full font-mono text-xs"
                />
                {seq.dmxChannel > 0 && (
                  <span className="text-[10px] text-[#4ade80] shrink-0">ch{seq.dmxChannel}</span>
                )}
              </div>
            </Field>
            {seq.kind === 'color' && (
              <Field label="Color Format">
                <div className="flex rounded overflow-hidden border border-[#3d3d3d]">
                  {([
                    { v: 'float' as const, label: 'FLOAT 0–1' },
                    { v: 'int' as const, label: 'INT 0–255' },
                  ]).map(({ v, label }) => (
                    <button
                      key={v}
                      onClick={() => updateSequence(seq.id, { colorFormat: v })}
                      className={`flex-1 py-0.5 text-[10px] transition-colors ${
                        seq.colorFormat === v
                          ? 'bg-[#a78bfa] text-black font-semibold'
                          : 'bg-[#2a2a2a] text-[#888] hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            {seq.kind !== 'color' && <>
            <Field label="Value Type">
              <div className="flex rounded overflow-hidden border border-[#3d3d3d]">
                {(['int', 'float'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => updateSequence(seq.id, { valueType: t })}
                    className={`flex-1 py-0.5 text-xs transition-colors ${
                      seq.valueType === t
                        ? 'bg-[#4ade80] text-black font-semibold'
                        : 'bg-[#2a2a2a] text-[#888] hover:text-white'
                    }`}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Min">
                <NumInput value={seq.min} step={0.1}
                  onCommit={(v) => updateSequence(seq.id, { min: v })} />
              </Field>
              <Field label="Max">
                <NumInput value={seq.max} step={0.1}
                  onCommit={(v) => updateSequence(seq.id, { max: v })} />
              </Field>
            </div>
            <Field label="Default">
              <NumInput value={seq.defaultValue} step={0.1}
                onCommit={(v) => updateSequence(seq.id, { defaultValue: v })} />
            </Field>
            </>}
            </>}
          </div>
        ) : (
          <p className="text-[#555] text-xs">{t('selectSequence')}</p>
        )}
      </Section>

      {/* Flag properties */}
      {seq?.kind === 'flag' && (
        <Section title="Flag">
          {(() => {
            const flag = selectedFlag && selectedFlag.seqId === seq.id
              ? seq.flags.find((f) => f.id === selectedFlag.flagId)
              : null;
            if (!flag) {
              return <p className="text-[#555] text-xs">{t('dblClickToAdd')}</p>;
            }
            return (
              <div className="flex flex-col gap-2">
                <Field label="Text">
                  <input
                    type="text"
                    value={flag.text}
                    onChange={(e) => updateFlag(seq.id, flag.id, { text: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="w-full"
                    placeholder="cue / lyric / state..."
                  />
                </Field>
                <Field label="Frame">
                  <NumInput
                    value={flag.frame}
                    min={0}
                    max={durationFrames}
                    step={1}
                    onCommit={(v) => updateFlag(seq.id, flag.id, { frame: Math.round(v) })}
                  />
                </Field>
                <Field label={`Duration (${(flag.duration / fps).toFixed(3)}s)`}>
                  <NumInput
                    value={flag.duration}
                    min={0}
                    max={durationFrames}
                    step={1}
                    onCommit={(v) => updateFlag(seq.id, flag.id, { duration: Math.max(0, Math.round(v)) })}
                  />
                </Field>
                <button
                  onClick={() => { removeFlag(seq.id, flag.id); setSelectedFlag(null); }}
                  className="text-xs text-[#ef4444] hover:text-[#f87171] py-1 border border-[#3d3d3d] rounded hover:border-[#ef4444] transition-colors"
                >
                  {t('deleteFlag')}
                </button>
              </div>
            );
          })()}
        </Section>
      )}

      {/* Color keyframe properties */}
      {seq?.kind === 'color' && (
        <Section title="Color Keyframe">
          <ColorKfEditor
            seq={seq}
            selFrames={selKfFrames}
            fps={fps}
            durationFrames={durationFrames}
            onUpdate={(f, u) => updateColorKeyframe(seq.id, f, u)}
            onRemove={(f) => removeColorKeyframe(seq.id, f)}
            t={t}
          />
        </Section>
      )}

      {/* Keyframe properties */}
      {seq?.kind !== 'flag' && seq?.kind !== 'color' && (
      <Section title={`Keyframe${selKf.length > 1 ? ` (${selKf.length})` : ''}`}>
        {kf && seq ? (
          <div className="flex flex-col gap-2">

            <Field label="Frame">
              <NumInput
                value={kf.frame}
                min={0}
                max={durationFrames}
                step={1}
                onCommit={(v) => updateKeyframe(seq.id, kf.frame, { frame: Math.round(v) })}
              />
            </Field>
            <Field label="Value">
              <NumInput
                value={roundedValue(kf.value)}
                min={seq.min}
                max={seq.max}
                step={seq.valueType === 'int' ? 1 : 0.001}
                onCommit={(v) => updateKeyframe(seq.id, kf.frame, { value: v })}
              />
            </Field>
            <Field label={`Time (${(kf.frame / fps).toFixed(3)}s)`} />
            <Field label="Interpolation">
              <div className="relative">
                <select
                  value={kf.interpolation}
                  onChange={(e) =>
                    updateKeyframe(seq.id, kf.frame, {
                      interpolation: e.target.value as Interpolation,
                    })
                  }
                  className="w-full appearance-none bg-[#2a2a2a] border border-[#3d3d3d] rounded px-2 py-1 text-xs text-[#e0e0e0] cursor-pointer outline-none focus:border-[#555] pr-6"
                >
                  <option value="step">Step (Hold)</option>
                  <option value="linear">Linear</option>
                  <option value="smooth">Smooth</option>
                  <option value="bezier">Bezier (Custom)</option>
                </select>
                <SelectArrow />
              </div>
            </Field>

            {/* Bezier editor */}
            {kf.interpolation === 'bezier' && (
              <BezierEditor
                cp1x={kf.cp1x ?? 0.25}
                cp1y={kf.cp1y ?? 0.25}
                cp2x={kf.cp2x ?? 0.75}
                cp2y={kf.cp2y ?? 0.75}
                color={seq.color}
                onChange={(c1x, c1y, c2x, c2y) =>
                  updateKeyframe(seq.id, kf.frame, {
                    cp1x: c1x, cp1y: c1y, cp2x: c2x, cp2y: c2y,
                  })
                }
              />
            )}

            <button
              onClick={() => { removeKeyframe(seq.id, kf.frame); }}
              className="text-xs text-[#ef4444] hover:text-[#f87171] py-1 border border-[#3d3d3d] rounded hover:border-[#ef4444] transition-colors"
            >
              {t('deleteKeyframe')}
            </button>
          </div>
        ) : selKf.length > 1 && seq ? (
          <div className="flex flex-col gap-2">
            <p className="text-[#888] text-xs">{translations[language].selectedCount(selKf.length)}</p>
            <Field label={t('interpAll')}>
              <div className="relative">
              <select
                defaultValue=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  selKf.forEach((k) =>
                    updateKeyframe(seq.id, k.frame, {
                      interpolation: e.target.value as Interpolation,
                    })
                  );
                }}
                className="w-full appearance-none bg-[#2a2a2a] border border-[#3d3d3d] rounded px-2 py-1 text-xs text-[#e0e0e0] cursor-pointer outline-none focus:border-[#555] pr-6"
              >
                <option value="" disabled>{t('changeInterp')}</option>
                <option value="step">Step (Hold)</option>
                <option value="linear">Linear</option>
                <option value="smooth">Smooth</option>
                <option value="bezier">Bezier (Custom)</option>
              </select>
              <SelectArrow />
              </div>
            </Field>
            <button
              onClick={() => selKf.forEach((k) => removeKeyframe(seq.id, k.frame))}
              className="text-xs text-[#ef4444] hover:text-[#f87171] py-1 border border-[#3d3d3d] rounded hover:border-[#ef4444] transition-colors"
            >
              {t('deleteAllSelected')}
            </button>
          </div>
        ) : (
          <p className="text-[#555] text-xs">{t('dblClickToAdd')}</p>
        )}
      </Section>
      )}

    </div>
  );
}

function rgbToHex(r: number, g: number, b: number) {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return { r: 1, g: 1, b: 1 };
  return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
}

function ColorKfEditor({
  seq, selFrames, fps, durationFrames, onUpdate, onRemove, t,
}: {
  seq: any;
  selFrames: number[];
  fps: number;
  durationFrames: number;
  onUpdate: (frame: number, updates: any) => void;
  onRemove: (frame: number) => void;
  t: (k: any) => string;
}) {
  const ckfs = seq.colorKeyframes.filter((k: any) => selFrames.includes(k.frame));
  if (ckfs.length === 0) {
    return <p className="text-[#555] text-xs">{t('dblClickToAdd')}</p>;
  }
  const kf = ckfs[0];
  const hex = rgbToHex(kf.r, kf.g, kf.b);
  return (
    <div className="flex flex-col gap-2">
      <Field label="Color">
        <input
          type="color"
          value={hex}
          onChange={(e) => {
            const { r, g, b } = hexToRgb(e.target.value);
            ckfs.forEach((k: any) => onUpdate(k.frame, { r, g, b }));
          }}
          className="w-full h-7 rounded cursor-pointer"
          style={{ background: hex }}
        />
      </Field>
      <Field label={`Alpha (${kf.a.toFixed(2)})`}>
        <input
          type="range"
          min={0} max={1} step={0.01}
          value={kf.a}
          onChange={(e) => {
            const a = parseFloat(e.target.value);
            ckfs.forEach((k: any) => onUpdate(k.frame, { a }));
          }}
          className="w-full"
        />
      </Field>
      <Field label="Frame">
        <NumInput
          value={kf.frame}
          min={0}
          max={durationFrames}
          step={1}
          onCommit={(v) => onUpdate(kf.frame, { frame: Math.round(v) })}
        />
      </Field>
      <Field label={`Time (${(kf.frame / fps).toFixed(3)}s)`} />
      <button
        onClick={() => ckfs.forEach((k: any) => onRemove(k.frame))}
        className="text-xs text-[#ef4444] hover:text-[#f87171] py-1 border border-[#3d3d3d] rounded hover:border-[#ef4444] transition-colors"
      >
        {t('deleteKeyframe')}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="border-b border-[#2a2a2a]">
      <div className="px-3 py-1.5 text-[10px] font-semibold text-[#666] uppercase tracking-wider bg-[#242424]">
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] text-[#666] uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}


function SelectArrow() {
  return (
    <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#555]">
      <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
        <path d="M4 6L0 2h8z" />
      </svg>
    </div>
  );
}
