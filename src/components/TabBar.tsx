import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../store';
import { useT } from '../lib/i18n';
import { stopAudio } from '../lib/audio';
import { isProjectDirty } from '../lib/projectDirty';

export default function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const currentProjectName = useAppStore((s) => s.project.projectName);
  const addTab = useAppStore((s) => s.addTab);
  const removeTab = useAppStore((s) => s.removeTab);
  const switchTab = useAppStore((s) => s.switchTab);
  const t = useT();

  const [closeConfirm, setCloseConfirm] = useState<{ tabId: string } | null>(null);

  const stopPlayback = async () => {
    const { isPlaying, setIsPlaying } = useAppStore.getState();
    if (isPlaying) {
      await invoke('stop_playback').catch(() => {});
      stopAudio();
      setIsPlaying(false);
    }
  };

  const handleSwitch = async (id: string) => {
    if (id === activeTabId) return;
    await stopPlayback();
    switchTab(id);
  };

  const handleAdd = async () => {
    await stopPlayback();
    addTab();
  };

  // 実際に閉じる処理
  const closeTab = async (tabId: string) => {
    if (tabId === activeTabId) await stopPlayback();
    removeTab(tabId);
    setCloseConfirm(null);
  };

  // × クリック → dirty チェック
  const handleRemoveClick = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    const state = useAppStore.getState();
    const isActive = tabId === state.activeTabId;
    const tabSnap = state.tabs.find((t) => t.id === tabId);
    if (!tabSnap) return;

    const dirty = isActive
      ? isProjectDirty(state.project, state.lastSavedProjectJSON)
      : isProjectDirty(tabSnap.project, tabSnap.lastSavedProjectJSON);

    if (dirty) {
      setCloseConfirm({ tabId });
    } else {
      closeTab(tabId);
    }
  };

  // 保存してから閉じる
  const handleSaveAndClose = async () => {
    if (!closeConfirm) return;
    const { tabId } = closeConfirm;
    const state = useAppStore.getState();
    const isActive = tabId === state.activeTabId;

    try {
      let filePath: string | null;
      let projectJson: string;
      let projectName: string;

      if (isActive) {
        filePath = state.projectFilePath;
        projectJson = state.getProjectJSON();
        projectName = state.project.projectName;
      } else {
        const snap = state.tabs.find((t) => t.id === tabId);
        if (!snap) { await closeTab(tabId); return; }
        filePath = snap.projectFilePath;
        projectJson = JSON.stringify(snap.project, null, 2);
        projectName = snap.project.projectName;
      }

      if (!filePath) {
        filePath = await save({
          filters: [{ name: 'Timeline Project', extensions: ['tlproj'] }],
          defaultPath: `${projectName}.tlproj`,
        }) as string | null;
      }
      if (!filePath) return; // user cancelled save dialog

      await invoke('save_project', { path: filePath, content: projectJson });
      if (isActive) state.markProjectSaved(filePath);
      else state.markTabProjectSaved(tabId, filePath);
    } catch (e) {
      console.error(e);
      return;
    }

    await closeTab(tabId);
  };

  return (
    <>
      <div className="flex items-center h-7 bg-[#161616] border-b border-[#3d3d3d] shrink-0 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const name = isActive ? currentProjectName : tab.project.projectName;
          return (
            <div
              key={tab.id}
              onClick={() => handleSwitch(tab.id)}
              className={`group flex items-center gap-1.5 px-3 h-full text-xs cursor-pointer shrink-0 border-r border-[#2a2a2a] select-none transition-colors ${
                isActive
                  ? 'bg-[#1e1e1e] text-[#e0e0e0] border-t-2 border-t-[#4ade80]'
                  : 'bg-[#161616] text-[#555] hover:text-[#999] hover:bg-[#1c1c1c] border-t-2 border-t-transparent'
              }`}
            >
              <span className="max-w-[120px] truncate">{name}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => handleRemoveClick(e, tab.id)}
                  className="opacity-0 group-hover:opacity-100 text-[#444] hover:text-[#ccc] transition-all -mr-1 shrink-0"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          );
        })}
        <button
          onClick={handleAdd}
          className="flex items-center justify-center w-7 h-full shrink-0 text-[#444] hover:text-[#888] hover:bg-[#1c1c1c] transition-colors"
          title="New tab"
        >
          <Plus size={11} />
        </button>
      </div>

      {/* 保存確認ダイアログ */}
      {closeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#1e1e1e] border border-[#3d3d3d] rounded-lg shadow-xl p-5 w-72 flex flex-col gap-4">
            <p className="text-sm text-[#ccc]">{t('saveBeforeClose')}</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleSaveAndClose}
                className="w-full py-1.5 text-xs rounded bg-[#4ade80] text-black hover:bg-[#22c55e] transition-colors"
              >
                {t('saveAndClose')}
              </button>
              <button
                onClick={() => closeTab(closeConfirm.tabId)}
                className="w-full py-1.5 text-xs rounded bg-[#2a2a2a] text-[#ccc] hover:bg-[#3a3a3a] transition-colors"
              >
                {t('closeWithoutSaving')}
              </button>
              <button
                onClick={() => setCloseConfirm(null)}
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
