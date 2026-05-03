import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  Play, Square, SkipBack, SkipForward, Repeat,
  FolderOpen, Save, FileText, Download
} from 'lucide-react';
import { useAppStore } from '../store';
import { formatTime } from '../lib/utils';
import { cn } from '../lib/utils';

export default function Toolbar() {
  const project = useAppStore((s) => s.project);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const currentFrame = useAppStore((s) => s.currentFrame);
  const loopEnabled = useAppStore((s) => s.loopEnabled);
  const setCurrentFrame = useAppStore((s) => s.setCurrentFrame);
  const setIsPlaying = useAppStore((s) => s.setIsPlaying);
  const toggleLoop = useAppStore((s) => s.toggleLoop);
  const newProject = useAppStore((s) => s.newProject);
  const loadProjectFromJSON = useAppStore((s) => s.loadProjectFromJSON);
  const getProjectJSON = useAppStore((s) => s.getProjectJSON);
  const updateProject = useAppStore((s) => s.updateProject);
  const addLog = useAppStore((s) => s.addLog);
  const projectFilePath = useAppStore((s) => s.projectFilePath);
  const setProjectFilePath = useAppStore((s) => s.setProjectFilePath);

  const handlePlay = async () => {
    if (isPlaying) {
      await invoke('stop_playback').catch(console.error);
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      await invoke('start_playback', {
        projectJson: getProjectJSON(),
        startFrame: currentFrame,
      }).catch((e) => {
        addLog(`再生エラー: ${e}`, 'error');
        setIsPlaying(false);
      });
    }
  };

  const handleStop = async () => {
    await invoke('stop_playback').catch(console.error);
    setIsPlaying(false);
  };

  const handleSkipBack = () => {
    handleStop();
    setCurrentFrame(0);
  };

  const handleSkipForward = () => {
    handleStop();
    setCurrentFrame(project.durationFrames);
  };

  const handleOpenProject = async () => {
    const path = await open({
      filters: [{ name: 'Timeline Project', extensions: ['tlproj', 'json'] }],
    });
    if (!path) return;
    try {
      const content = await invoke<string>('load_project', { path });
      loadProjectFromJSON(content, path as string);
      addLog(`プロジェクト読み込み: ${path}`);
    } catch (e) {
      addLog(`読み込みエラー: ${e}`, 'error');
    }
  };

  const handleSaveProject = async () => {
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
      addLog(`保存: ${filePath}`);
    } catch (e) {
      addLog(`保存エラー: ${e}`, 'error');
    }
  };

  const handleExportCSV = async () => {
    const filePath = await save({
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      defaultPath: `${project.projectName}.csv`,
    }) as string | null;
    if (!filePath) return;
    try {
      await invoke('export_csv', { path: filePath, projectJson: getProjectJSON() });
      addLog(`CSV出力: ${filePath}`);
    } catch (e) {
      addLog(`CSV出力エラー: ${e}`, 'error');
    }
  };

  const handleFrameInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const frame = parseInt(e.target.value, 10);
    if (!isNaN(frame)) setCurrentFrame(frame);
  };

  const handleFpsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fps = parseInt(e.target.value, 10);
    if (!isNaN(fps) && fps > 0) updateProject({ fps });
  };

  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dur = parseInt(e.target.value, 10);
    if (!isNaN(dur) && dur > 0) updateProject({ durationFrames: dur });
  };

  return (
    <div className="flex items-center gap-2 px-2 h-10 bg-[#1e1e1e] border-b border-[#3d3d3d] shrink-0 overflow-x-auto">
      {/* File ops */}
      <div className="flex items-center gap-1">
        <ToolBtn onClick={newProject} title="新規プロジェクト">
          <FileText size={14} />
        </ToolBtn>
        <ToolBtn onClick={handleOpenProject} title="開く">
          <FolderOpen size={14} />
        </ToolBtn>
        <ToolBtn onClick={handleSaveProject} title="保存">
          <Save size={14} />
        </ToolBtn>
        <ToolBtn onClick={handleExportCSV} title="CSV出力">
          <Download size={14} />
        </ToolBtn>
      </div>

      <Divider />

      {/* Transport */}
      <div className="flex items-center gap-1">
        <ToolBtn onClick={handleSkipBack} title="先頭へ">
          <SkipBack size={14} />
        </ToolBtn>
        <ToolBtn onClick={handleStop} title="停止">
          <Square size={14} />
        </ToolBtn>
        <ToolBtn
          onClick={handlePlay}
          title={isPlaying ? '停止' : '再生'}
          active={isPlaying}
          className="w-8"
        >
          {isPlaying ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </ToolBtn>
        <ToolBtn onClick={handleSkipForward} title="末尾へ">
          <SkipForward size={14} />
        </ToolBtn>
        <ToolBtn
          onClick={toggleLoop}
          title="ループ"
          active={loopEnabled}
        >
          <Repeat size={14} />
        </ToolBtn>
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
          type="number"
          value={project.fps}
          onChange={handleFpsChange}
          className="w-14"
          min={1}
          max={240}
        />
        <label className="text-[#888]">Frames</label>
        <input
          type="number"
          value={project.durationFrames}
          onChange={handleDurationChange}
          className="w-20"
          min={1}
        />
      </div>

      <Divider />

      {/* Project name */}
      <input
        type="text"
        value={project.projectName}
        onChange={(e) => updateProject({ projectName: e.target.value })}
        className="w-32"
        placeholder="プロジェクト名"
      />
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  title,
  active,
  className,
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
