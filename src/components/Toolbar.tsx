import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  Play, Square, SkipBack, SkipForward, Repeat,
  FolderOpen, Save, FileText, Download, Settings, Music, X, Link2
} from 'lucide-react';
import { useAppStore } from '../store';
import { useT, getT, translations } from '../lib/i18n';
import { formatTime } from '../lib/utils';
import { cn } from '../lib/utils';
import SettingsModal from './SettingsModal';
import { setAudioBuffer, clearAudioBuffer, registerTabBuffer, unregisterTabBuffer, playAudio, stopAudio } from '../lib/audio';

export default function Toolbar() {
  const project = useAppStore((s) => s.project);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const currentFrame = useAppStore((s) => s.currentFrame);
  const loopEnabled = useAppStore((s) => s.loopEnabled);
  const loopIn = useAppStore((s) => s.loopIn);
  const loopOut = useAppStore((s) => s.loopOut);
  const language = useAppStore((s) => s.language);
  const setCurrentFrame = useAppStore((s) => s.setCurrentFrame);
  const setIsPlaying = useAppStore((s) => s.setIsPlaying);
  const toggleLoop = useAppStore((s) => s.toggleLoop);
  const newProject = useAppStore((s) => s.newProject);
  const loadProjectFromJSON = useAppStore((s) => s.loadProjectFromJSON);
  const getProjectJSON = useAppStore((s) => s.getProjectJSON);
  const getPlaybackJSON = useAppStore((s) => s.getPlaybackJSON);
  const syncPlayback = useAppStore((s) => s.syncPlayback);
  const toggleSyncPlayback = useAppStore((s) => s.toggleSyncPlayback);
  const updateProject = useAppStore((s) => s.updateProject);
  const addLog = useAppStore((s) => s.addLog);
  const projectFilePath = useAppStore((s) => s.projectFilePath);
  const setProjectFilePath = useAppStore((s) => s.setProjectFilePath);
  const audioFilePath = useAppStore((s) => s.audioFilePath);
  const setAudioFilePath = useAppStore((s) => s.setAudioFilePath);
  const setWaveformSamples = useAppStore((s) => s.setWaveformSamples);

  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectConfirm, setNewProjectConfirm] = useState(false);
  const [fpsInput, setFpsInput] = useState<string>(String(project.fps));
  const [durInput, setDurInput] = useState<string>(String(project.durationFrames));
  const fpsFocused = useRef(false);
  const durFocused = useRef(false);

  // 外部からストア値が変わったとき（音声読み込みなど）だけ入力欄を同期
  useEffect(() => { if (!fpsFocused.current) setFpsInput(String(project.fps)); }, [project.fps]);
  useEffect(() => { if (!durFocused.current) setDurInput(String(project.durationFrames)); }, [project.durationFrames]);

  const handlePlay = async () => {
    const T = translations[language];
    if (isPlaying) {
      await invoke('stop_playback').catch(console.error);
      stopAudio();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      playAudio(currentFrame / project.fps);
      await invoke('start_playback', {
        projectJson: getPlaybackJSON(),
        startFrame: currentFrame,
        loopEnabled,
        loopIn,
        loopOut,
      }).catch((e) => {
        addLog(`${T.playError}: ${e}`, 'error');
        stopAudio();
        setIsPlaying(false);
      });
    }
  };

  const handleStop = async () => {
    await invoke('stop_playback').catch(console.error);
    stopAudio();
    setIsPlaying(false);
  };

  const handleSkipBack = () => { handleStop(); setCurrentFrame(0); };
  const handleSkipForward = () => { handleStop(); setCurrentFrame(project.durationFrames); };

  const handleOpenProject = async () => {
    const T = translations[language];
    const path = await open({
      filters: [{ name: 'Timeline Project', extensions: ['tlproj', 'json'] }],
    });
    if (!path) return;
    try {
      const content = await invoke<string>('load_project', { path });
      loadProjectFromJSON(content, path as string);
      addLog(`${T.projectLoaded}: ${path}`);
    } catch (e) {
      addLog(`${T.loadError}: ${e}`, 'error');
    }
  };

  const handleSaveProject = async () => {
    const T = translations[language];
    let filePath = projectFilePath;
    if (!filePath) {
      filePath = await save({
        filters: [{ name: 'Timeline Project', extensions: ['tlproj'] }],
        defaultPath: `${project.projectName}.tlproj`,
      }) as string | null;
    }
    if (!filePath) return;
    try {
      await invoke('save_project', { path: filePath, content: getProjectJSON() });
      setProjectFilePath(filePath);
      addLog(`${T.saved}: ${filePath}`);
    } catch (e) {
      addLog(`${T.saveError}: ${e}`, 'error');
    }
  };

  const handleExportCSV = async () => {
    const T = translations[language];
    const filePath = await save({
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      defaultPath: `${project.projectName}.csv`,
    }) as string | null;
    if (!filePath) return;
    try {
      await invoke('export_csv', { path: filePath, projectJson: getProjectJSON() });
      addLog(`${T.csvExported}: ${filePath}`);
    } catch (e) {
      addLog(`${T.csvError}: ${e}`, 'error');
    }
  };

  const isDirty = project.sequences.some(s => s.keyframes.length > 0)
    || project.sequences.length > 1
    || !!projectFilePath;

  const handleNewProject = () => {
    if (isDirty) { setNewProjectConfirm(true); return; }
    newProject();
  };

  const handleNewProjectSave = async () => {
    await handleSaveProject();
    newProject();
    setNewProjectConfirm(false);
  };

  const handleNewProjectDiscard = () => {
    newProject();
    setNewProjectConfirm(false);
  };

  const handleLoadAudio = async () => {
    const path = await open({
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'] }],
    });
    if (!path) return;
    try {
      const url = convertFileSrc(path as string);
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      const tmpCtx = new AudioContext();
      const decoded = await tmpCtx.decodeAudioData(arrayBuffer);
      await tmpCtx.close();
      setAudioBuffer(decoded);
      registerTabBuffer(useAppStore.getState().activeTabId, decoded);

      const fps = project.fps;
      const durationFrames = Math.round(decoded.duration * fps);

      // Downsample to waveform: peak amplitude per bucket
      const NUM_SAMPLES = 8192;
      const ch = decoded.getChannelData(0);
      const blockSize = Math.max(1, Math.floor(ch.length / NUM_SAMPLES));
      const samples = new Float32Array(NUM_SAMPLES);
      for (let i = 0; i < NUM_SAMPLES; i++) {
        let peak = 0;
        const start = i * blockSize;
        for (let j = start; j < start + blockSize && j < ch.length; j++) {
          const abs = Math.abs(ch[j]);
          if (abs > peak) peak = abs;
        }
        samples[i] = peak;
      }

      setAudioFilePath(path as string);
      setWaveformSamples(samples);
      updateProject({ durationFrames, audioFile: path as string });
      const { language } = useAppStore.getState();
      const tg = getT(language);
      addLog(tg('audioLoaded')((path as string).split('/').pop()!, decoded.duration.toFixed(2), durationFrames));
    } catch (e) {
      const { language } = useAppStore.getState();
      addLog(`${getT(language)('audioLoadError')}: ${e}`, 'error');
    }
  };

  const handleClearAudio = () => {
    clearAudioBuffer();
    unregisterTabBuffer(useAppStore.getState().activeTabId);
    setAudioFilePath(null);
    setWaveformSamples(null);
    updateProject({ audioFile: null });
  };

  const handleFrameInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const frame = parseInt(e.target.value, 10);
    if (!isNaN(frame)) setCurrentFrame(frame);
  };

  const commitFps = (raw: string) => {
    const fps = parseInt(raw, 10);
    if (!isNaN(fps) && fps > 0) updateProject({ fps });
    else setFpsInput(String(project.fps));
  };

  const commitDur = (raw: string) => {
    const dur = parseInt(raw, 10);
    if (!isNaN(dur) && dur > 0) updateProject({ durationFrames: dur });
    else setDurInput(String(project.durationFrames));
  };

  return (
    <>
      <div className="flex items-center gap-2 px-2 h-10 bg-[#1e1e1e] border-b border-[#3d3d3d] shrink-0 overflow-x-auto">
        {/* File ops */}
        <div className="flex items-center gap-1">
          <ToolBtn onClick={handleNewProject} title={t('newProject')}><FileText size={14} /></ToolBtn>
          <ToolBtn onClick={handleOpenProject} title={t('open')}><FolderOpen size={14} /></ToolBtn>
          <ToolBtn onClick={handleSaveProject} title={t('save')}><Save size={14} /></ToolBtn>
          <ToolBtn onClick={handleExportCSV} title={t('exportCSV')}><Download size={14} /></ToolBtn>
        </div>

        <Divider />

        {/* Audio */}
        <div className="flex items-center gap-1">
          <ToolBtn onClick={handleLoadAudio} title={t('loadAudio')} active={!!audioFilePath}>
            <Music size={14} />
          </ToolBtn>
          {audioFilePath && (
            <>
              <span className="text-[10px] text-[#4ade80] font-mono max-w-[120px] truncate select-none" title={audioFilePath}>
                {audioFilePath.split('/').pop()}
              </span>
              <button
                onClick={handleClearAudio}
                className="text-[#555] hover:text-[#f87171] transition-colors"
                title={t('clearAudio')}
              >
                <X size={11} />
              </button>
            </>
          )}
        </div>

        <Divider />

        {/* Transport */}
        <div className="flex items-center gap-1">
          <ToolBtn onClick={handleSkipBack} title={t('skipToStart')}><SkipBack size={14} /></ToolBtn>
          <ToolBtn onClick={handlePlay} title={isPlaying ? t('stop') : t('play')} active={isPlaying} className="w-8">
            {isPlaying ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </ToolBtn>
          <ToolBtn onClick={handleSkipForward} title={t('skipToEnd')}><SkipForward size={14} /></ToolBtn>
          <ToolBtn onClick={toggleLoop} title={t('loop')} active={loopEnabled}><Repeat size={14} /></ToolBtn>
          <ToolBtn onClick={toggleSyncPlayback} title={t('syncPlayback')} active={syncPlayback}><Link2 size={14} /></ToolBtn>
        </div>

        <Divider />

        {/* Frame / Time */}
        <div className="flex items-center gap-1 text-xs font-mono">
          <span className="text-[#888]">F</span>
          <input
            type="number"
            value={currentFrame}
            onChange={handleFrameInput}
            className="w-16 text-right"
            min={0}
            max={project.durationFrames}
          />
          <span className="text-[#4ade80] min-w-[72px]">
            {formatTime(currentFrame, project.fps)}
          </span>
        </div>

        <Divider />

        {/* Project settings */}
        <div className="flex items-center gap-2 text-xs">
          <label className="text-[#888]">FPS</label>
          <input
            type="number" value={fpsInput} className="w-14" min={1} max={240}
            onChange={(e) => setFpsInput(e.target.value)}
            onFocus={() => { fpsFocused.current = true; }}
            onBlur={(e) => { fpsFocused.current = false; commitFps(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } e.stopPropagation(); }}
          />
          <label className="text-[#888]">Frames</label>
          <input
            type="number" value={durInput} className="w-20" min={1}
            onChange={(e) => setDurInput(e.target.value)}
            onFocus={() => { durFocused.current = true; }}
            onBlur={(e) => { durFocused.current = false; commitDur(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } e.stopPropagation(); }}
          />
        </div>

        <Divider />

        {/* Project name */}
        <input
          type="text"
          value={project.projectName}
          onChange={(e) => updateProject({ projectName: e.target.value })}
          className="w-32"
          placeholder={t('projectNamePlaceholder')}
        />

        <div className="ml-auto flex items-center">
          <ToolBtn onClick={() => setSettingsOpen(true)} title={t('settings')}>
            <Settings size={14} />
          </ToolBtn>
        </div>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {newProjectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#1e1e1e] border border-[#3d3d3d] rounded-lg shadow-xl p-5 w-72 flex flex-col gap-4">
            <p className="text-sm text-[#ccc]">{t('saveBeforeNew')}</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleNewProjectSave}
                className="w-full py-1.5 text-xs rounded bg-[#4ade80] text-black hover:bg-[#22c55e] transition-colors"
              >
                {t('saveAndNew')}
              </button>
              <button
                onClick={handleNewProjectDiscard}
                className="w-full py-1.5 text-xs rounded bg-[#2a2a2a] text-[#ccc] hover:bg-[#3a3a3a] transition-colors"
              >
                {t('discardAndNew')}
              </button>
              <button
                onClick={() => setNewProjectConfirm(false)}
                className="w-full py-1.5 text-xs rounded bg-transparent text-[#666] hover:text-[#999] transition-colors"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ToolBtn({
  children, onClick, title, active, className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center justify-center w-7 h-7 rounded text-[#aaa] hover:text-white hover:bg-[#333] transition-colors',
        active && 'text-[#4ade80] bg-[#2d3d2d]',
        className
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-[#3d3d3d] mx-1 shrink-0" />;
}
