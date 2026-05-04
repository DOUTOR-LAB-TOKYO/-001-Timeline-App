import { useState } from 'react';
import { X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store';
import { useT } from '../lib/i18n';
import type { Language } from '../lib/i18n';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'pt', label: 'Português' },
];

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const oscConfig = useAppStore((s) => s.project.oscConfig);
  const serialConfig = useAppStore((s) => s.project.serialConfig);
  const dmxConfig = useAppStore((s) => s.project.dmxConfig);
  const updateProject = useAppStore((s) => s.updateProject);
  const t = useT();

  const [serialPorts, setSerialPorts] = useState<string[]>([]);
  const [serialConnected, setSerialConnected] = useState(false);
  const [serialError, setSerialError] = useState<string | null>(null);

  const [dmxPorts, setDmxPorts] = useState<string[]>([]);
  const [dmxConnected, setDmxConnected] = useState(false);
  const [dmxError, setDmxError] = useState<string | null>(null);

  const refreshPorts = async () => {
    try {
      const list = await invoke<string[]>('list_serial_ports');
      setSerialPorts(list);
    } catch {
      setSerialPorts([]);
    }
  };

  const handleSerialConnect = async () => {
    setSerialError(null);
    try {
      await invoke('open_serial_port', {
        portName: serialConfig.port,
        baudRate: serialConfig.baudRate,
      });
      setSerialConnected(true);
    } catch (e) {
      setSerialError(String(e));
      setSerialConnected(false);
    }
  };

  const handleSerialDisconnect = async () => {
    await invoke('close_serial_port');
    setSerialConnected(false);
  };

  const refreshDmxPorts = async () => {
    try {
      const list = await invoke<string[]>('list_serial_ports');
      setDmxPorts(list);
    } catch { setDmxPorts([]); }
  };

  const handleDmxConnect = async () => {
    setDmxError(null);
    try {
      await invoke('open_dmx_port', { portName: dmxConfig.port });
      setDmxConnected(true);
    } catch (e) {
      setDmxError(String(e));
      setDmxConnected(false);
    }
  };

  const handleDmxDisconnect = async () => {
    await invoke('close_dmx_port');
    setDmxConnected(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#1e1e1e] border border-[#3d3d3d] rounded-xl shadow-2xl w-96 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3d3d3d] shrink-0">
          <span className="text-sm font-semibold text-[#e0e0e0]">{t('settings')}</span>
          <button onClick={onClose} className="text-[#666] hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex flex-col divide-y divide-[#2a2a2a]">

          {/* Language */}
          <Section title={t('language')}>
            <div className="relative">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                className="w-full appearance-none text-xs bg-[#2a2a2a] border border-[#3d3d3d] rounded px-2 py-1 text-[#ccc] cursor-pointer outline-none focus:border-[#555] pr-6"
              >
                {LANGUAGES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#555]">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                  <path d="M4 6L0 2h8z" />
                </svg>
              </div>
            </div>
          </Section>

          {/* OSC */}
          <Section title="OSC">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="osc-enabled"
                  checked={oscConfig.enabled}
                  onChange={(e) =>
                    updateProject({ oscConfig: { ...oscConfig, enabled: e.target.checked } })
                  }
                  className="accent-[#4ade80]"
                />
                <label htmlFor="osc-enabled" className="text-xs cursor-pointer text-[#ccc]">
                  {t('enableOSC')}
                </label>
                <span className={`ml-auto w-2 h-2 rounded-full ${oscConfig.enabled ? 'bg-[#4ade80]' : 'bg-[#555]'}`} />
              </div>
              <Field label="IP">
                <input
                  type="text"
                  value={oscConfig.ip}
                  onChange={(e) =>
                    updateProject({ oscConfig: { ...oscConfig, ip: e.target.value } })
                  }
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full font-mono text-xs"
                />
              </Field>
              <Field label="Port">
                <input
                  type="number"
                  value={oscConfig.port}
                  min={1}
                  max={65535}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) updateProject({ oscConfig: { ...oscConfig, port: v } });
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full font-mono text-xs"
                />
              </Field>
              <p className="text-[9px] text-[#444]">{t('oscMutedNote')}</p>
            </div>
          </Section>

          {/* Serial */}
          <Section title="Serial">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="serial-enabled"
                  checked={serialConfig.enabled}
                  onChange={(e) =>
                    updateProject({ serialConfig: { ...serialConfig, enabled: e.target.checked } })
                  }
                  className="accent-[#4ade80]"
                />
                <label htmlFor="serial-enabled" className="text-xs cursor-pointer text-[#ccc]">
                  {t('enableSend')}
                </label>
                <span className={`ml-auto w-2 h-2 rounded-full ${serialConnected ? 'bg-[#4ade80]' : 'bg-[#555]'}`} />
              </div>

              <Field label="Port">
                <div className="flex gap-1">
                  <div className="relative flex-1">
                    <select
                      value={serialConfig.port}
                      onChange={(e) =>
                        updateProject({ serialConfig: { ...serialConfig, port: e.target.value } })
                      }
                      className="w-full appearance-none text-xs bg-[#2a2a2a] border border-[#3d3d3d] rounded px-2 py-1 text-[#ccc] cursor-pointer outline-none focus:border-[#555] pr-6"
                    >
                      {serialConfig.port && !serialPorts.includes(serialConfig.port) && (
                        <option value={serialConfig.port}>{serialConfig.port}</option>
                      )}
                      {serialPorts.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                      {serialPorts.length === 0 && !serialConfig.port && (
                        <option value="">{t('noPort')}</option>
                      )}
                    </select>
                    <SelectArrow />
                  </div>
                  <button
                    onClick={refreshPorts}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-[#2a2a2a] border border-[#3d3d3d] text-[#888] hover:text-[#ccc] transition-colors"
                    title={t('refreshPorts')}
                  >
                    ↻
                  </button>
                </div>
              </Field>

              <Field label="Baud Rate">
                <div className="relative">
                  <select
                    value={serialConfig.baudRate}
                    onChange={(e) =>
                      updateProject({ serialConfig: { ...serialConfig, baudRate: Number(e.target.value) } })
                    }
                    className="w-full appearance-none text-xs bg-[#2a2a2a] border border-[#3d3d3d] rounded px-2 py-1 text-[#ccc] cursor-pointer outline-none focus:border-[#555] pr-6"
                  >
                    {BAUD_RATES.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                  <SelectArrow />
                </div>
              </Field>

              <button
                onClick={serialConnected ? handleSerialDisconnect : handleSerialConnect}
                disabled={!serialConfig.port}
                className={`w-full py-1.5 text-xs rounded transition-colors ${
                  serialConnected
                    ? 'bg-[#3a1a1a] text-[#f87171] hover:bg-[#4a2a2a]'
                    : 'bg-[#1a3a1a] text-[#4ade80] hover:bg-[#2a4a2a] disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
              >
                {serialConnected ? t('disconnect') : t('connect')}
              </button>

              {serialError && (
                <p className="text-[10px] text-[#f87171] break-all">{serialError}</p>
              )}

              <p className="text-[9px] text-[#444]">
                {t('serialFormatNote')} <span className="font-mono">/address:value\n</span>　{t('serialMutedNote')}
              </p>
            </div>
          </Section>

          {/* DMX */}
          <Section title="DMX (ENTTEC USB Pro)">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="dmx-enabled"
                  checked={dmxConfig.enabled}
                  onChange={(e) =>
                    updateProject({ dmxConfig: { ...dmxConfig, enabled: e.target.checked } })
                  }
                  className="accent-[#4ade80]"
                />
                <label htmlFor="dmx-enabled" className="text-xs cursor-pointer text-[#ccc]">
                  {t('enableSend')}
                </label>
                <span className={`ml-auto w-2 h-2 rounded-full ${dmxConnected ? 'bg-[#4ade80]' : 'bg-[#555]'}`} />
              </div>

              <Field label="Port">
                <div className="flex gap-1">
                  <div className="relative flex-1">
                    <select
                      value={dmxConfig.port}
                      onChange={(e) =>
                        updateProject({ dmxConfig: { ...dmxConfig, port: e.target.value } })
                      }
                      className="w-full appearance-none text-xs bg-[#2a2a2a] border border-[#3d3d3d] rounded px-2 py-1 text-[#ccc] cursor-pointer outline-none focus:border-[#555] pr-6"
                    >
                      {dmxConfig.port && !dmxPorts.includes(dmxConfig.port) && (
                        <option value={dmxConfig.port}>{dmxConfig.port}</option>
                      )}
                      {dmxPorts.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                      {dmxPorts.length === 0 && !dmxConfig.port && (
                        <option value="">{t('noPort')}</option>
                      )}
                    </select>
                    <SelectArrow />
                  </div>
                  <button
                    onClick={refreshDmxPorts}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-[#2a2a2a] border border-[#3d3d3d] text-[#888] hover:text-[#ccc] transition-colors"
                    title={t('refreshPorts')}
                  >
                    ↻
                  </button>
                </div>
              </Field>

              <button
                onClick={dmxConnected ? handleDmxDisconnect : handleDmxConnect}
                disabled={!dmxConfig.port}
                className={`w-full py-1.5 text-xs rounded transition-colors ${
                  dmxConnected
                    ? 'bg-[#3a1a1a] text-[#f87171] hover:bg-[#4a2a2a]'
                    : 'bg-[#1a3a1a] text-[#4ade80] hover:bg-[#2a4a2a] disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
              >
                {dmxConnected ? t('disconnect') : t('connect')}
              </button>

              {dmxError && (
                <p className="text-[10px] text-[#f87171] break-all">{dmxError}</p>
              )}

              <p className="text-[9px] text-[#444]">
                {t('dmxBaudNote')}<br />
                {t('dmxChannelNote')}<br />
                {t('dmxMutedNote')}
              </p>
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-4 flex flex-col gap-2">
      <p className="text-[10px] font-semibold text-[#666] uppercase tracking-wider">{title}</p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-[#555] uppercase tracking-wide">{label}</label>
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
