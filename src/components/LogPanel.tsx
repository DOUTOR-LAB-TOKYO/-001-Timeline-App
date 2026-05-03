import { useRef, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { useAppStore } from '../store';
import { cn } from '../lib/utils';

export default function LogPanel() {
  const logs = useAppStore((s) => s.logs);
  const clearLogs = useAppStore((s) => s.clearLogs);
  const oscConfig = useAppStore((s) => s.project.oscConfig);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [logs.length]);

  return (
    <div className="h-24 bg-[#141414] border-t border-[#3d3d3d] flex flex-col shrink-0">
      <div className="flex items-center justify-between px-3 py-1 border-b border-[#2a2a2a]">
        <span className="text-[10px] text-[#555] uppercase tracking-wider">Log</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[10px]">
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                isPlaying ? 'bg-[#4ade80] animate-pulse' : 'bg-[#555]'
              )}
            />
            <span className="text-[#555]">{isPlaying ? 'Playing' : 'Stopped'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                oscConfig.enabled ? 'bg-[#60a5fa]' : 'bg-[#555]'
              )}
            />
            <span className="text-[#555]">
              OSC {oscConfig.enabled ? `${oscConfig.ip}:${oscConfig.port}` : 'off'}
            </span>
          </div>
          <button
            onClick={clearLogs}
            className="text-[#555] hover:text-[#aaa] transition-colors"
            title="ログをクリア"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-1 font-mono text-[10px] leading-4">
        {logs.map((log) => (
          <div
            key={log.id}
            className={cn(
              'whitespace-nowrap',
              log.type === 'error' && 'text-[#ef4444]',
              log.type === 'warn' && 'text-[#f59e0b]',
              log.type === 'info' && 'text-[#888]'
            )}
          >
            <span className="text-[#444] mr-2">
              {new Date(log.timestamp).toLocaleTimeString('ja-JP', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
            {log.message}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
