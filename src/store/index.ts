import { create } from 'zustand';
import type { Project, Sequence, Keyframe, LogEntry } from '../types';
import type { Language } from '../lib/i18n';
import { generateId, clamp, nameToOscAddress } from '../lib/utils';
import { activateTabAudio, unregisterTabBuffer } from '../lib/audio';

const DEFAULT_COLORS = [
  '#4ade80', '#60a5fa', '#f59e0b', '#f472b6', '#a78bfa',
  '#34d399', '#fb923c', '#38bdf8', '#e879f9', '#facc15',
];

const DEFAULT_FPS = 30;
const DEFAULT_DURATION = DEFAULT_FPS * 12; // 12 seconds = 360 frames

function createDefaultSequence(index: number): Sequence {
  return {
    id: generateId(),
    name: `Seq ${index + 1}`,
    enabled: true,
    muted: false,
    solo: false,
    locked: false,
    color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
    oscAddress: `/seq/${index + 1}`,
    dmxChannel: 0,
    valueType: 'int',
    min: 0,
    max: 100,
    defaultValue: 0,
    keyframes: [],
  };
}

function createDefaultProject(): Project {
  return {
    projectName: 'Untitled',
    fps: DEFAULT_FPS,
    durationFrames: DEFAULT_DURATION,
    audioFile: null,
    videoFile: null,
    sequences: [createDefaultSequence(0)],
    oscConfig: { ip: '127.0.0.1', port: 9000, enabled: false },
    serialConfig: { port: '', baudRate: 9600, enabled: false },
    dmxConfig: { port: '', enabled: false },
  };
}

// ─── Tab snapshot ────────────────────────────────────────────────────

export interface TabSnapshot {
  id: string;
  project: Project;
  projectFilePath: string | null;
  audioFilePath: string | null;
  waveformSamples: Float32Array | null;
  rowHeights: Map<string, number>;
  selectedSequenceId: string | null;
  selectedKeyframes: Map<string, Set<number>>;
  viewStartFrame: number;
  zoom: number;
  loopEnabled: boolean;
  loopIn: number;
  loopOut: number;
  sequenceClipboard: Sequence | null;
  currentFrame: number;
}

function createDefaultTab(nameIndex = 0): TabSnapshot {
  const project = createDefaultProject();
  if (nameIndex > 0) project.projectName = `Untitled ${nameIndex + 1}`;
  return {
    id: generateId(),
    project,
    projectFilePath: null,
    audioFilePath: null,
    waveformSamples: null,
    rowHeights: new Map(),
    selectedSequenceId: null,
    selectedKeyframes: new Map(),
    viewStartFrame: 0,
    zoom: 4,
    loopEnabled: false,
    loopIn: 0,
    loopOut: project.durationFrames,
    sequenceClipboard: null,
    currentFrame: 0,
  };
}

function snapshotFromState(s: AppStore): Omit<TabSnapshot, 'id'> {
  return {
    project: s.project,
    projectFilePath: s.projectFilePath,
    audioFilePath: s.audioFilePath,
    waveformSamples: s.waveformSamples,
    rowHeights: s.rowHeights,
    selectedSequenceId: s.selectedSequenceId,
    selectedKeyframes: s.selectedKeyframes,
    viewStartFrame: s.viewStartFrame,
    zoom: s.zoom,
    loopEnabled: s.loopEnabled,
    loopIn: s.loopIn,
    loopOut: s.loopOut,
    sequenceClipboard: s.sequenceClipboard,
    currentFrame: s.currentFrame,
  };
}

function restoreFromSnapshot(tab: TabSnapshot): Partial<AppStore> {
  return {
    project: tab.project,
    projectFilePath: tab.projectFilePath,
    audioFilePath: tab.audioFilePath,
    waveformSamples: tab.waveformSamples,
    rowHeights: tab.rowHeights,
    selectedSequenceId: tab.selectedSequenceId,
    selectedKeyframes: tab.selectedKeyframes,
    viewStartFrame: tab.viewStartFrame,
    zoom: tab.zoom,
    loopEnabled: tab.loopEnabled,
    loopIn: tab.loopIn,
    loopOut: tab.loopOut,
    sequenceClipboard: tab.sequenceClipboard,
    currentFrame: tab.currentFrame,
    isPlaying: false,
  };
}

// ─── remapFrame ──────────────────────────────────────────────────────

function remapFrame(
  sel: Map<string, Set<number>>,
  seqId: string,
  oldFrame: number,
  newFrame: number
): Map<string, Set<number>> {
  if (oldFrame === newFrame) return sel;
  const frames = sel.get(seqId);
  if (!frames?.has(oldFrame)) return sel;
  const next = new Map(sel);
  const newFrames = new Set(frames);
  newFrames.delete(oldFrame);
  newFrames.add(newFrame);
  next.set(seqId, newFrames);
  return next;
}

// ─── Store interface ─────────────────────────────────────────────────

interface AppStore {
  // Tabs
  tabs: TabSnapshot[];
  activeTabId: string;
  addTab: () => void;
  removeTab: (id: string) => void;
  switchTab: (id: string) => void;

  // Project
  project: Project;
  projectFilePath: string | null;

  updateProject: (updates: Partial<Project>) => void;
  setProjectFilePath: (path: string | null) => void;
  newProject: () => void;
  loadProjectFromJSON: (json: string, filePath?: string) => void;
  getProjectJSON: () => string;

  addSequence: () => void;
  removeSequence: (id: string) => void;
  updateSequence: (id: string, updates: Partial<Sequence>) => void;
  reorderSequence: (fromIndex: number, toIndex: number) => void;

  addKeyframe: (seqId: string, kf: Keyframe) => void;
  removeKeyframe: (seqId: string, frame: number) => void;
  updateKeyframe: (seqId: string, oldFrame: number, updates: Partial<Keyframe>) => void;
  moveKeyframe: (seqId: string, fromFrame: number, toFrame: number, value: number) => void;
  moveKeyframesBatch: (moves: Array<{ seqId: string; fromFrame: number; toFrame: number; value: number }>) => void;
  addKeyframes: (seqId: string, kfs: Keyframe[]) => void;

  // Playback
  isPlaying: boolean;
  currentFrame: number;
  loopEnabled: boolean;
  loopIn: number;
  loopOut: number;

  setCurrentFrame: (frame: number) => void;
  setIsPlaying: (v: boolean) => void;
  toggleLoop: () => void;
  setLoopIn: (frame: number) => void;
  setLoopOut: (frame: number) => void;

  // UI
  selectedSequenceId: string | null;
  selectedKeyframes: Map<string, Set<number>>;
  viewStartFrame: number;
  zoom: number;
  snapGridSize: number;
  language: Language;
  rowHeights: Map<string, number>;

  setSelectedSequence: (id: string | null) => void;
  toggleKeyframeSelection: (seqId: string, frame: number, multi: boolean) => void;
  setSelectedKeyframesBatch: (kfMap: Map<string, Set<number>>) => void;
  clearKeyframeSelection: () => void;
  setViewStartFrame: (frame: number) => void;
  setZoom: (zoom: number, pivotFrame?: number) => void;
  setRowHeight: (seqId: string, height: number) => void;
  setSnapGridSize: (size: number) => void;
  setLanguage: (lang: Language) => void;

  // Audio
  audioFilePath: string | null;
  waveformSamples: Float32Array | null;
  setAudioFilePath: (path: string | null) => void;
  setWaveformSamples: (samples: Float32Array | null) => void;

  // Sequence clipboard
  sequenceClipboard: Sequence | null;
  copySequence: (id: string) => void;
  pasteSequence: () => void;

  // Sync playback across tabs
  syncPlayback: boolean;
  toggleSyncPlayback: () => void;
  getPlaybackJSON: () => string;

  // Logs
  logs: LogEntry[];
  addLog: (message: string, type?: LogEntry['type']) => void;
  clearLogs: () => void;
}

// ─── Initial state ───────────────────────────────────────────────────

const initialTab = createDefaultTab(0);

export const useAppStore = create<AppStore>((set, get) => ({
  // ── Tabs ────────────────────────────────────────────────────────────
  tabs: [initialTab],
  activeTabId: initialTab.id,

  addTab: () =>
    set((s) => {
      const updatedTabs = s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, ...snapshotFromState(s) } : t
      );
      const newTab = createDefaultTab(s.tabs.length);
      activateTabAudio(newTab.id);
      return {
        tabs: [...updatedTabs, newTab],
        activeTabId: newTab.id,
        ...restoreFromSnapshot(newTab),
      };
    }),

  removeTab: (id) =>
    set((s) => {
      if (s.tabs.length <= 1) return {};
      const idx = s.tabs.findIndex((t) => t.id === id);
      const newTabs = s.tabs.filter((t) => t.id !== id);
      unregisterTabBuffer(id);
      if (s.activeTabId !== id) return { tabs: newTabs };
      const target = newTabs[Math.min(idx, newTabs.length - 1)];
      activateTabAudio(target.id);
      return { tabs: newTabs, activeTabId: target.id, ...restoreFromSnapshot(target) };
    }),

  switchTab: (id) =>
    set((s) => {
      if (s.activeTabId === id) return {};
      const updatedTabs = s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, ...snapshotFromState(s) } : t
      );
      const target = updatedTabs.find((t) => t.id === id);
      if (!target) return {};
      activateTabAudio(id);
      return { tabs: updatedTabs, activeTabId: id, ...restoreFromSnapshot(target) };
    }),

  // ── Project ─────────────────────────────────────────────────────────
  project: initialTab.project,
  projectFilePath: null,

  updateProject: (updates) =>
    set((s) => {
      const extra: Partial<typeof s> = {};
      if (updates.durationFrames !== undefined) {
        extra.loopOut = updates.durationFrames;
        if (s.loopIn >= updates.durationFrames) extra.loopIn = 0;
      }
      // OSC / Serial / DMX config は全タブに同期
      const globalKeys = ['oscConfig', 'serialConfig', 'dmxConfig'] as const;
      if (globalKeys.some((k) => k in updates)) {
        extra.tabs = s.tabs.map((t) => ({
          ...t,
          project: {
            ...t.project,
            ...(updates.oscConfig !== undefined && { oscConfig: updates.oscConfig }),
            ...(updates.serialConfig !== undefined && { serialConfig: updates.serialConfig }),
            ...(updates.dmxConfig !== undefined && { dmxConfig: updates.dmxConfig }),
          },
        }));
      }
      return { project: { ...s.project, ...updates }, ...extra };
    }),

  setProjectFilePath: (path) => set({ projectFilePath: path }),

  newProject: () =>
    set({
      project: createDefaultProject(),
      projectFilePath: null,
      currentFrame: 0,
      isPlaying: false,
      selectedSequenceId: null,
      selectedKeyframes: new Map(),
      viewStartFrame: 0,
      zoom: 4,
      audioFilePath: null,
      waveformSamples: null,
      rowHeights: new Map(),
    }),

  loadProjectFromJSON: (json, filePath) => {
    try {
      const project = JSON.parse(json) as Project;
      project.sequences = project.sequences.map((s) => ({
        ...s,
        valueType: (s.valueType ?? 'float') as 'float' | 'int',
      }));
      if (!project.serialConfig) {
        project.serialConfig = { port: '', baudRate: 9600, enabled: false };
      }
      if (!project.dmxConfig) {
        project.dmxConfig = { port: '', enabled: false };
      }
      project.sequences = project.sequences.map((s) => ({
        ...s,
        dmxChannel: s.dmxChannel ?? 0,
      }));
      set({
        project,
        projectFilePath: filePath ?? null,
        currentFrame: 0,
        isPlaying: false,
        selectedSequenceId: project.sequences[0]?.id ?? null,
        selectedKeyframes: new Map(),
      });
    } catch (e) {
      get().addLog(`プロジェクト読み込みエラー: ${e}`, 'error');
    }
  },

  getProjectJSON: () => JSON.stringify(get().project, null, 2),

  addSequence: () =>
    set((s) => ({
      project: {
        ...s.project,
        sequences: [...s.project.sequences, createDefaultSequence(s.project.sequences.length)],
      },
    })),

  removeSequence: (id) =>
    set((s) => {
      const nextRowHeights = new Map(s.rowHeights);
      nextRowHeights.delete(id);
      return {
        project: { ...s.project, sequences: s.project.sequences.filter((seq) => seq.id !== id) },
        selectedSequenceId: s.selectedSequenceId === id ? null : s.selectedSequenceId,
        rowHeights: nextRowHeights,
      };
    }),

  updateSequence: (id, updates) =>
    set((s) => ({
      project: {
        ...s.project,
        sequences: s.project.sequences.map((seq) => seq.id === id ? { ...seq, ...updates } : seq),
      },
    })),

  reorderSequence: (fromIndex, toIndex) =>
    set((s) => {
      const seqs = [...s.project.sequences];
      const [removed] = seqs.splice(fromIndex, 1);
      seqs.splice(toIndex, 0, removed);
      return { project: { ...s.project, sequences: seqs } };
    }),

  addKeyframe: (seqId, kf) =>
    set((s) => ({
      project: {
        ...s.project,
        sequences: s.project.sequences.map((seq) => {
          if (seq.id !== seqId) return seq;
          const filtered = seq.keyframes.filter((k) => k.frame !== kf.frame);
          return { ...seq, keyframes: [...filtered, kf].sort((a, b) => a.frame - b.frame) };
        }),
      },
    })),

  removeKeyframe: (seqId, frame) =>
    set((s) => ({
      project: {
        ...s.project,
        sequences: s.project.sequences.map((seq) =>
          seq.id === seqId
            ? { ...seq, keyframes: seq.keyframes.filter((k) => k.frame !== frame) }
            : seq
        ),
      },
    })),

  updateKeyframe: (seqId, oldFrame, updates) =>
    set((s) => {
      const newFrame = updates.frame ?? oldFrame;
      return {
        project: {
          ...s.project,
          sequences: s.project.sequences.map((seq) =>
            seq.id === seqId
              ? {
                  ...seq,
                  keyframes: seq.keyframes
                    .map((k) => (k.frame === oldFrame ? { ...k, ...updates } : k))
                    .sort((a, b) => a.frame - b.frame),
                }
              : seq
          ),
        },
        selectedKeyframes: remapFrame(s.selectedKeyframes, seqId, oldFrame, newFrame),
      };
    }),

  moveKeyframe: (seqId, fromFrame, toFrame, value) =>
    set((s) => {
      const newSequences = s.project.sequences.map((seq) => {
        if (seq.id !== seqId) return seq;
        const kf = seq.keyframes.find((k) => k.frame === fromFrame);
        if (!kf) return seq;
        const filtered = seq.keyframes.filter((k) => k.frame !== fromFrame && k.frame !== toFrame);
        return { ...seq, keyframes: [...filtered, { ...kf, frame: toFrame, value }].sort((a, b) => a.frame - b.frame) };
      });
      return {
        project: { ...s.project, sequences: newSequences },
        selectedKeyframes: remapFrame(s.selectedKeyframes, seqId, fromFrame, toFrame),
      };
    }),

  moveKeyframesBatch: (moves) =>
    set((s) => {
      const bySeq = new Map<string, typeof moves>();
      for (const m of moves) {
        const arr = bySeq.get(m.seqId) ?? [];
        arr.push(m);
        bySeq.set(m.seqId, arr);
      }
      const newSequences = s.project.sequences.map((seq) => {
        const seqMoves = bySeq.get(seq.id);
        if (!seqMoves) return seq;
        const fromSet = new Set(seqMoves.map((m) => m.fromFrame));
        const toSet = new Set(seqMoves.map((m) => m.toFrame));
        let kfs = seq.keyframes.filter((k) => !fromSet.has(k.frame) && !toSet.has(k.frame));
        for (const m of seqMoves) {
          const orig = seq.keyframes.find((k) => k.frame === m.fromFrame);
          if (orig) kfs.push({ ...orig, frame: m.toFrame, value: m.value });
        }
        return { ...seq, keyframes: kfs.sort((a, b) => a.frame - b.frame) };
      });
      return { project: { ...s.project, sequences: newSequences } };
    }),

  addKeyframes: (seqId, kfs) =>
    set((s) => ({
      project: {
        ...s.project,
        sequences: s.project.sequences.map((seq) => {
          if (seq.id !== seqId) return seq;
          let merged = [...seq.keyframes];
          for (const kf of kfs) {
            merged = merged.filter((k) => k.frame !== kf.frame);
            merged.push(kf);
          }
          return { ...seq, keyframes: merged.sort((a, b) => a.frame - b.frame) };
        }),
      },
    })),

  // ── Playback ────────────────────────────────────────────────────────
  isPlaying: false,
  currentFrame: 0,
  loopEnabled: false,
  loopIn: 0,
  loopOut: DEFAULT_DURATION,

  setCurrentFrame: (frame) => set({ currentFrame: frame }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  toggleLoop: () => set((s) => ({ loopEnabled: !s.loopEnabled })),
  setLoopIn: (frame) => set({ loopIn: frame }),
  setLoopOut: (frame) => set({ loopOut: frame }),

  // ── UI ──────────────────────────────────────────────────────────────
  selectedSequenceId: null,
  selectedKeyframes: new Map(),
  viewStartFrame: 0,
  zoom: 4,
  snapGridSize: 5,
  language: 'en' as Language,
  rowHeights: new Map<string, number>(),

  setSelectedSequence: (id) => set({ selectedSequenceId: id }),
  setSnapGridSize: (size) => set({ snapGridSize: size }),
  setLanguage: (lang) => set({ language: lang }),
  setRowHeight: (seqId, height) =>
    set((s) => {
      const next = new Map(s.rowHeights);
      next.set(seqId, height);
      return { rowHeights: next };
    }),

  toggleKeyframeSelection: (seqId, frame, multi) =>
    set((s) => {
      const prev = new Map(s.selectedKeyframes);
      if (!multi) prev.clear();
      const frames = new Set(prev.get(seqId) ?? []);
      if (frames.has(frame)) frames.delete(frame);
      else frames.add(frame);
      prev.set(seqId, frames);
      return { selectedKeyframes: prev };
    }),

  setSelectedKeyframesBatch: (kfMap) => set({ selectedKeyframes: new Map(kfMap) }),
  clearKeyframeSelection: () => set({ selectedKeyframes: new Map() }),
  setViewStartFrame: (frame) => set({ viewStartFrame: Math.max(0, frame) }),

  setZoom: (zoom, pivotFrame) =>
    set((s) => {
      const next = clamp(zoom, 0.25, 200);
      if (pivotFrame !== undefined) {
        const pivotX = (pivotFrame - s.viewStartFrame) / s.zoom;
        return { zoom: next, viewStartFrame: Math.max(0, pivotFrame - pivotX * next) };
      }
      return { zoom: next };
    }),

  // ── Audio ────────────────────────────────────────────────────────────
  audioFilePath: null,
  waveformSamples: null,
  setAudioFilePath: (path) => set({ audioFilePath: path }),
  setWaveformSamples: (samples) => set({ waveformSamples: samples }),

  // ── Sync playback ────────────────────────────────────────────────────
  syncPlayback: false,
  toggleSyncPlayback: () => set((s) => ({ syncPlayback: !s.syncPlayback })),
  getPlaybackJSON: () => {
    const s = get();
    const prefixSeqs = (seqs: typeof s.project.sequences, projectName: string) => {
      const prefix = nameToOscAddress(projectName || 'tab');
      return seqs.map((seq) => ({
        ...seq,
        oscAddress: prefix + (seq.oscAddress.startsWith('/') ? seq.oscAddress : '/' + seq.oscAddress),
      }));
    };
    if (!s.syncPlayback || s.tabs.length <= 1) {
      return JSON.stringify({ ...s.project, sequences: prefixSeqs(s.project.sequences, s.project.projectName) }, null, 2);
    }
    // Sync: merge all tabs with their respective prefixes
    const allSequences = s.tabs.flatMap((t) => {
      const seqs = t.id === s.activeTabId ? s.project.sequences : t.project.sequences;
      const name = t.id === s.activeTabId ? s.project.projectName : t.project.projectName;
      return prefixSeqs(seqs, name);
    });
    return JSON.stringify({ ...s.project, sequences: allSequences }, null, 2);
  },

  // ── Logs ─────────────────────────────────────────────────────────────
  logs: [],
  addLog: (message, type = 'info') =>
    set((s) => ({
      logs: [...s.logs.slice(-199), { id: generateId(), timestamp: Date.now(), message, type }],
    })),
  clearLogs: () => set({ logs: [] }),

  // ── Sequence clipboard ───────────────────────────────────────────────
  sequenceClipboard: null,

  copySequence: (id) => {
    const seq = get().project.sequences.find((s) => s.id === id);
    if (seq) set({ sequenceClipboard: seq });
  },

  pasteSequence: () => {
    const src = get().sequenceClipboard;
    if (!src) return;
    const newSeq: Sequence = {
      ...src,
      id: generateId(),
      name: `${src.name} copy`,
      oscAddress: `${src.oscAddress}_copy`,
      keyframes: src.keyframes.map((kf) => ({ ...kf })),
    };
    set((s) => ({
      project: { ...s.project, sequences: [...s.project.sequences, newSeq] },
      selectedSequenceId: newSeq.id,
    }));
  },
}));
