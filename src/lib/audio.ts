let audioCtx: AudioContext | null = null;
let audioBuffer: AudioBuffer | null = null;
let sourceNode: AudioBufferSourceNode | null = null;

// Per-tab audio buffers kept in memory
const tabBuffers = new Map<string, AudioBuffer>();

export function setAudioBuffer(buffer: AudioBuffer) {
  audioBuffer = buffer;
}

export function registerTabBuffer(tabId: string, buffer: AudioBuffer) {
  tabBuffers.set(tabId, buffer);
}

export function unregisterTabBuffer(tabId: string) {
  tabBuffers.delete(tabId);
}

export function activateTabAudio(tabId: string) {
  stopAudio();
  audioBuffer = tabBuffers.get(tabId) ?? null;
}

export function clearAudioBuffer() {
  stopAudio();
  audioBuffer = null;
}

export function playAudio(offsetSeconds: number) {
  if (!audioBuffer) return;
  stopAudio();
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const clampedOffset = Math.max(0, Math.min(offsetSeconds, audioBuffer.duration));
  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(audioCtx.destination);
  sourceNode.start(0, clampedOffset);
}

export function stopAudio() {
  if (sourceNode) {
    try { sourceNode.stop(); } catch { /* already stopped */ }
    sourceNode.disconnect();
    sourceNode = null;
  }
}
