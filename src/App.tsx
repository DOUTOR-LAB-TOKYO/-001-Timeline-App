import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from './store';
import { playAudio, stopAudio } from './lib/audio';
import Toolbar from './components/Toolbar';
import TabBar from './components/TabBar';
import SequenceList from './components/SequenceList';
import TimelineCanvas from './components/timeline/TimelineCanvas';
import PropertiesPanel from './components/PropertiesPanel';
import LogPanel from './components/LogPanel';
import type { FrameUpdatePayload } from './types';

export default function App() {
  const setCurrentFrame = useAppStore((s) => s.setCurrentFrame);
  const setIsPlaying = useAppStore((s) => s.setIsPlaying);
  const prevFrameRef = useRef<number>(-1);

  useEffect(() => {
    const unlistenFrame = listen<FrameUpdatePayload>('frame_update', (e) => {
      const newFrame = e.payload.frame;
      const prevFrame = prevFrameRef.current;
      const { isPlaying, loopEnabled, loopIn, project } = useAppStore.getState();

      // ループ検知: 再生中にフレームが大幅に後退 → 音声を再スタート
      if (isPlaying && loopEnabled && prevFrame > 0 && newFrame < prevFrame - 5) {
        playAudio(loopIn / project.fps);
      }

      prevFrameRef.current = newFrame;
      setCurrentFrame(newFrame);
    });
    const unlistenStop = listen('playback_stopped', () => {
      stopAudio();
      prevFrameRef.current = -1;
      setIsPlaying(false);
    });
    return () => {
      unlistenFrame.then((fn) => fn());
      unlistenStop.then((fn) => fn());
    };
  }, [setCurrentFrame, setIsPlaying]);

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // Alt+↑/↓ — move selected sequence
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !inInput) {
        e.preventDefault();
        const { selectedSequenceId, project, reorderSequence } = useAppStore.getState();
        if (!selectedSequenceId) return;
        const idx = project.sequences.findIndex((s) => s.id === selectedSequenceId);
        if (idx === -1) return;
        if (e.key === 'ArrowUp' && idx > 0) reorderSequence(idx, idx - 1);
        if (e.key === 'ArrowDown' && idx < project.sequences.length - 1) reorderSequence(idx, idx + 1);
        return;
      }

      // Cmd/Ctrl+C — copy selected sequence
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !inInput) {
        const { selectedSequenceId, copySequence } = useAppStore.getState();
        if (selectedSequenceId) { e.preventDefault(); copySequence(selectedSequenceId); }
        return;
      }

      // Cmd/Ctrl+V — paste sequence
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && !inInput) {
        const { pasteSequence, sequenceClipboard } = useAppStore.getState();
        if (sequenceClipboard) { e.preventDefault(); pasteSequence(); }
        return;
      }

      // Space — play/stop
      if (e.key !== ' ' || inInput) return;
      e.preventDefault();
      const { isPlaying, setIsPlaying: setPlay, getPlaybackJSON, currentFrame, project, addLog, loopEnabled, loopIn, loopOut } = useAppStore.getState();
      if (isPlaying) {
        await invoke('stop_playback').catch(console.error);
        stopAudio();
        setPlay(false);
      } else {
        setPlay(true);
        playAudio(currentFrame / project.fps);
        await invoke('start_playback', {
          projectJson: getPlaybackJSON(),
          startFrame: currentFrame,
          loopEnabled,
          loopIn,
          loopOut,
        }).catch((err) => {
          addLog(`再生エラー: ${err}`, 'error');
          stopAudio();
          setPlay(false);
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#181818] text-[#e0e0e0]">
      <Toolbar />
      <TabBar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <SequenceList />
        <TimelineCanvas />
        <PropertiesPanel />
      </div>
      <LogPanel />
    </div>
  );
}
