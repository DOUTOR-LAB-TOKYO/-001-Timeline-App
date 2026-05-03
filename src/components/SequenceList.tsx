import { useState } from 'react';
import { Plus, Trash2, EyeOff, Volume2, VolumeX, Lock, Unlock } from 'lucide-react';
import { useAppStore } from '../store';
import { cn } from '../lib/utils';

const RULER_H = 32;
const ROW_H = 70;

export default function SequenceList() {
  const sequences = useAppStore((s) => s.project.sequences);
  const selectedId = useAppStore((s) => s.selectedSequenceId);
  const addSequence = useAppStore((s) => s.addSequence);
  const removeSequence = useAppStore((s) => s.removeSequence);
  const updateSequence = useAppStore((s) => s.updateSequence);
  const setSelectedSequence = useAppStore((s) => s.setSelectedSequence);

  return (
    <div className="flex flex-col w-[190px] shrink-0 bg-[#1e1e1e] border-r border-[#3d3d3d] overflow-hidden">
      {/* Ruler placeholder */}
      <div
        className="flex items-center justify-between px-2 shrink-0 border-b border-[#3d3d3d] bg-[#242424]"
        style={{ height: RULER_H }}
      >
        <span className="text-[#666] text-xs">Sequences</span>
        <button
          onClick={addSequence}
          className="flex items-center justify-center w-5 h-5 rounded text-[#888] hover:text-white hover:bg-[#333]"
          title="シーケンス追加"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Sequence rows */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {sequences.map((seq) => (
          <SequenceRow
            key={seq.id}
            seq={seq}
            selected={seq.id === selectedId}
            onSelect={() => setSelectedSequence(seq.id)}
            onUpdate={(updates) => updateSequence(seq.id, updates)}
            onRemove={() => removeSequence(seq.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SequenceRow({
  seq,
  selected,
  onSelect,
  onUpdate,
  onRemove,
}: {
  seq: ReturnType<typeof useAppStore.getState>['project']['sequences'][0];
  selected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<typeof seq>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(seq.name);

  const handleNameDblClick = () => {
    setNameVal(seq.name);
    setEditing(true);
  };

  const commitName = () => {
    setEditing(false);
    if (nameVal.trim()) onUpdate({ name: nameVal.trim() });
  };

  return (
    <div
      onClick={onSelect}
      className={cn(
        'flex flex-col justify-center px-2 border-b border-[#2a2a2a] cursor-pointer transition-colors',
        selected ? 'bg-[#2d2d2d]' : 'bg-[#1e1e1e] hover:bg-[#252525]',
        !seq.enabled && 'opacity-50'
      )}
      style={{ height: ROW_H }}
    >
      {/* Top row: color + name */}
      <div className="flex items-center gap-1.5 mb-1">
        <input
          type="color"
          value={seq.color}
          onChange={(e) => onUpdate({ color: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          className="w-3 h-3 rounded-full shrink-0 cursor-pointer border-0 p-0"
          style={{ appearance: 'none', background: seq.color }}
          title="色変更"
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
          <span
            className="flex-1 text-xs truncate"
            onDoubleClick={handleNameDblClick}
            title={seq.name}
          >
            {seq.name}
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="opacity-0 group-hover:opacity-100 hover:opacity-100 text-[#666] hover:text-[#ef4444] transition-colors"
          title="削除"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Bottom row: controls */}
      <div className="flex items-center gap-1">
        <IconBtn
          active={!seq.enabled}
          onClick={(e) => { e.stopPropagation(); onUpdate({ enabled: !seq.enabled }); }}
          title={seq.enabled ? '無効化' : '有効化'}
        >
          <EyeOff size={11} />
        </IconBtn>
        <IconBtn
          active={seq.muted}
          activeColor="text-[#f59e0b]"
          onClick={(e) => { e.stopPropagation(); onUpdate({ muted: !seq.muted }); }}
          title={seq.muted ? 'ミュート解除' : 'ミュート'}
        >
          {seq.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
        </IconBtn>
        <IconBtn
          active={seq.locked}
          activeColor="text-[#60a5fa]"
          onClick={(e) => { e.stopPropagation(); onUpdate({ locked: !seq.locked }); }}
          title={seq.locked ? 'ロック解除' : 'ロック'}
        >
          {seq.locked ? <Lock size={11} /> : <Unlock size={11} />}
        </IconBtn>
        <span className="ml-auto text-[#555] text-[10px] font-mono truncate max-w-[80px]" title={seq.oscAddress}>
          {seq.oscAddress}
        </span>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  active,
  activeColor = 'text-[#4ade80]',
  onClick,
  title,
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
