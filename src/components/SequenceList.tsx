import { useState, useRef } from 'react';
import { Plus, Trash2, Copy, EyeOff, Volume2, VolumeX, Lock, Unlock, GripVertical } from 'lucide-react';
import { useAppStore } from '../store';
import { useT } from '../lib/i18n';
import { cn, nameToOscAddress } from '../lib/utils';
import { RULER_H, WAVEFORM_H, ROW_H, MIN_ROW_H, MAX_ROW_H } from '../lib/constants';

export default function SequenceList() {
  const sequences = useAppStore((s) => s.project.sequences);
  const selectedId = useAppStore((s) => s.selectedSequenceId);
  const rowHeights = useAppStore((s) => s.rowHeights);
  const addSequence = useAppStore((s) => s.addSequence);
  const removeSequence = useAppStore((s) => s.removeSequence);
  const updateSequence = useAppStore((s) => s.updateSequence);
  const reorderSequence = useAppStore((s) => s.reorderSequence);
  const setRowHeight = useAppStore((s) => s.setRowHeight);
  const setSelectedSequence = useAppStore((s) => s.setSelectedSequence);
  const copySequence = useAppStore((s) => s.copySequence);
  const pasteSequence = useAppStore((s) => s.pasteSequence);
  const sequenceClipboard = useAppStore((s) => s.sequenceClipboard);
  const waveformSamples = useAppStore((s) => s.waveformSamples);
  const t = useT();
  const headerH = waveformSamples ? RULER_H + WAVEFORM_H : RULER_H;

  const listRef = useRef<HTMLDivElement>(null);
  const seqDrag = useRef<{ fromIndex: number; toIndex: number } | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // ── Reorder drag ──────────────────────────────────────────────────

  const handleGripMouseDown = (e: React.MouseEvent, fromIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    seqDrag.current = { fromIndex, toIndex: fromIndex };
    setDraggingIndex(fromIndex);

    const onMove = (ev: MouseEvent) => {
      if (!seqDrag.current || !listRef.current) return;
      const rect = listRef.current.getBoundingClientRect();
      const scrollTop = listRef.current.scrollTop;
      const relY = ev.clientY - rect.top + scrollTop;
      // Find the insert-before index using current row heights
      const rh = useAppStore.getState().rowHeights;
      const seqs = useAppStore.getState().project.sequences;
      let cumH = 0;
      let insertBefore = seqs.length;
      for (let i = 0; i < seqs.length; i++) {
        const h = rh.get(seqs[i].id) ?? ROW_H;
        if (relY < cumH + h / 2) { insertBefore = i; break; }
        cumH += h;
      }
      seqDrag.current.toIndex = insertBefore;
      setDropIndex(insertBefore);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (seqDrag.current) {
        const { fromIndex: fi, toIndex } = seqDrag.current;
        const actualTo = toIndex > fi ? toIndex - 1 : toIndex;
        if (actualTo !== fi) reorderSequence(fi, actualTo);
      }
      seqDrag.current = null;
      setDraggingIndex(null);
      setDropIndex(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Compute cumulative Y position for drop indicator
  const getDropIndicatorY = (idx: number) => {
    let y = 0;
    for (let i = 0; i < idx && i < sequences.length; i++) {
      y += rowHeights.get(sequences[i].id) ?? ROW_H;
    }
    return y;
  };

  return (
    <div className="flex flex-col w-[190px] shrink-0 bg-[#1e1e1e] border-r border-[#3d3d3d] overflow-hidden">
      <div
        className="flex items-center justify-between px-2 shrink-0 border-b border-[#3d3d3d] bg-[#242424]"
        style={{ height: headerH }}
      >
        <span className="text-[#666] text-xs">{t('sequences')}</span>
        <div className="flex items-center gap-0.5">
          {sequenceClipboard && (
            <button
              onClick={pasteSequence}
              className="flex items-center justify-center w-5 h-5 rounded text-[#888] hover:text-white hover:bg-[#333]"
              title={t('pasteSeq')(sequenceClipboard.name)}
            >
              <Copy size={11} />
            </button>
          )}
          <button
            onClick={addSequence}
            className="flex items-center justify-center w-5 h-5 rounded text-[#888] hover:text-white hover:bg-[#333]"
            title={t('addSequence')}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto overflow-x-hidden relative">
        {sequences.map((seq, index) => (
          <SequenceRow
            key={seq.id}
            seq={seq}
            rowH={rowHeights.get(seq.id) ?? ROW_H}
            selected={seq.id === selectedId}
            isDragging={index === draggingIndex}
            onSelect={() => setSelectedSequence(seq.id)}
            onUpdate={(updates) => updateSequence(seq.id, updates)}
            onRemove={() => removeSequence(seq.id)}
            onCopy={() => copySequence(seq.id)}
            onGripMouseDown={(e) => handleGripMouseDown(e, index)}
            onResizeStart={(e) => handleResizeStart(e, seq.id, rowHeights.get(seq.id) ?? ROW_H)}
          />
        ))}

        {/* Drop indicator */}
        {dropIndex !== null && (
          <div
            className="absolute left-0 right-0 h-0.5 bg-[#4ade80] pointer-events-none z-10"
            style={{ top: getDropIndicatorY(dropIndex) - 1 }}
          />
        )}
      </div>
    </div>
  );

  // ── Row resize ────────────────────────────────────────────────────

  function handleResizeStart(e: React.MouseEvent, seqId: string, startH: number) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      const newH = Math.min(MAX_ROW_H, Math.max(MIN_ROW_H, startH + (ev.clientY - startY)));
      setRowHeight(seqId, newH);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
}

function SequenceRow({
  seq, rowH, selected, isDragging, onSelect, onUpdate, onRemove, onCopy, onGripMouseDown, onResizeStart,
}: {
  seq: ReturnType<typeof useAppStore.getState>['project']['sequences'][0];
  rowH: number;
  selected: boolean;
  isDragging: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<typeof seq>) => void;
  onRemove: () => void;
  onCopy: () => void;
  onGripMouseDown: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(seq.name);
  const t = useT();

  const handleNameDblClick = () => { setNameVal(seq.name); setEditing(true); };
  const commitName = () => {
    setEditing(false);
    const name = nameVal.trim();
    if (name) {
      const oscAddress = nameToOscAddress(name);
      onUpdate({ name, oscAddress });
    }
  };

  const handleRowMouseDown = (e: React.MouseEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT') return;
    onGripMouseDown(e);
  };

  return (
    <div
      onClick={onSelect}
      onMouseDown={handleRowMouseDown}
      className={cn(
        'relative flex flex-col justify-center px-2 border-b border-[#2a2a2a] cursor-grab active:cursor-grabbing transition-colors select-none',
        selected ? 'bg-[#2d2d2d]' : 'bg-[#1e1e1e] hover:bg-[#252525]',
        !seq.enabled && 'opacity-50',
        isDragging && 'opacity-30',
      )}
      style={{ height: rowH }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {/* Drag indicator */}
        <GripVertical size={11} className="shrink-0 text-[#3a3a3a] pointer-events-none" />

        <input
          type="color"
          value={seq.color}
          onChange={(e) => onUpdate({ color: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          className="w-3 h-3 rounded-full shrink-0 cursor-pointer border-0 p-0"
          style={{ appearance: 'none', background: seq.color }}
        />
        {editing ? (
          <input
            type="text"
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            className="flex-1 text-xs h-5 px-1"
          />
        ) : (
          <span className="flex-1 text-xs truncate" onDoubleClick={handleNameDblClick} title={seq.name}>
            {seq.name}
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(); }}
          className="opacity-0 hover:opacity-100 text-[#666] hover:text-[#4ade80] transition-colors"
          title={t('copySeq')}
        >
          <Copy size={11} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="opacity-0 hover:opacity-100 text-[#666] hover:text-[#ef4444] transition-colors"
          title={t('deleteSequence')}
        >
          <Trash2 size={11} />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <IconBtn
          active={!seq.enabled}
          onClick={(e) => { e.stopPropagation(); onUpdate({ enabled: !seq.enabled }); }}
          title={seq.enabled ? t('disable') : t('enable')}
        >
          <EyeOff size={11} />
        </IconBtn>
        <IconBtn
          active={seq.muted}
          activeColor="text-[#f59e0b]"
          onClick={(e) => { e.stopPropagation(); onUpdate({ muted: !seq.muted }); }}
          title={seq.muted ? t('unmute') : t('mute')}
        >
          {seq.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
        </IconBtn>
        <IconBtn
          active={seq.locked}
          activeColor="text-[#60a5fa]"
          onClick={(e) => { e.stopPropagation(); onUpdate({ locked: !seq.locked }); }}
          title={seq.locked ? t('unlock') : t('lock')}
        >
          {seq.locked ? <Lock size={11} /> : <Unlock size={11} />}
        </IconBtn>
        <span className="ml-auto text-[#555] text-[10px] font-mono truncate max-w-[80px]" title={seq.oscAddress}>
          {seq.oscAddress}
        </span>
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize group/resize z-10"
        onMouseDown={onResizeStart}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute bottom-0 left-0 right-0 h-px bg-[#2a2a2a] group-hover/resize:bg-[#555] transition-colors" />
      </div>
    </div>
  );
}

function IconBtn({
  children, active, activeColor = 'text-[#4ade80]', onClick, title,
}: {
  children: React.ReactNode;
  active?: boolean;
  activeColor?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center justify-center w-5 h-5 rounded text-[#555] hover:text-[#aaa] transition-colors',
        active && activeColor
      )}
    >
      {children}
    </button>
  );
}
