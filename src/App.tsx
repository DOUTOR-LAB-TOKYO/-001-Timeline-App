import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from './store';
import Toolbar from './components/Toolbar';
import SequenceList from './components/SequenceList';
import TimelineCanvas from './components/timeline/TimelineCanvas';
import PropertiesPanel from './components/PropertiesPanel';
import LogPanel from './components/LogPanel';
import type { FrameUpdatePayload } from './types';

export default function App() {
  const setCurrentFrame = useAppStore((s) => s.setCurrentFrame);
  const setIsPlaying = useAppStore((s) => s.setIsPlaying);

  useEffect(() => {
    const unlistenFrame = listen<FrameUpdatePayload>('frame_update', (e) => {
      setCurrentFrame(e.payload.frame);
    });
    const unlistenStop = listen('playback_stopped', () => {
      setIsPlaying(false);
    });
    return () => {
      unlistenFrame.then((fn) => fn());
      unlistenStop.then((fn) => fn());
    };
  }, [setCurrentFrame, setIsPlaying]);

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      const { isPlaying, setIsPlaying: setPlay, getProjectJSON, currentFrame, addLog } = useAppStore.getState();
      if (isPlaying) {
        await invoke('stop_playback').catch(console.error);
        setPlay(false);
      } else {
        setPlay(true);
        await invoke('start_playback', {
          projectJson: getProjectJSON(),
          startFrame: currentFrame,
        }).catch((err) => {
          addLog(`再生エラー: ${err}`, 'error');
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
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <SequenceList />
        <TimelineCanvas />
        <PropertiesPanel />
      </div>
      <LogPanel />
    </div>
  );
}
