export type Interpolation = 'step' | 'linear' | 'smooth' | 'bezier';

export interface Keyframe {
  frame: number;
  value: number;
  interpolation: Interpolation;
  // Cubic bezier control points (normalized 0–1, only used when interpolation='bezier')
  cp1x?: number;
  cp1y?: number;
  cp2x?: number;
  cp2y?: number;
}

export type SequenceKind = 'value' | 'flag' | 'color';

export interface ColorKeyframe {
  frame: number;
  r: number; // 0..1
  g: number;
  b: number;
  a: number;
  interpolation: Interpolation;
}

export interface Flag {
  id: string;
  frame: number;       // start frame
  duration: number;    // 0 = point, >0 = range
  text: string;
}

export interface Sequence {
  id: string;
  kind: SequenceKind;  // default 'value' for legacy projects
  name: string;
  enabled: boolean;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  color: string;
  oscAddress: string;
  dmxChannel: number; // 0 = disabled, 1-512
  valueType: 'float' | 'int';
  min: number;
  max: number;
  defaultValue: number;
  keyframes: Keyframe[];
  flags: Flag[];
  colorKeyframes: ColorKeyframe[];
  colorFormat: 'float' | 'int'; // float = 0..1, int = 0..255 (used for color kind)
}

export interface OscConfig {
  ip: string;
  port: number;
  enabled: boolean;
}

export interface SerialConfig {
  port: string;
  baudRate: number;
  enabled: boolean;
}

export interface DmxConfig {
  port: string;
  enabled: boolean;
}

export interface Project {
  projectName: string;
  fps: number;
  durationFrames: number;
  audioFile: string | null;
  videoFile: string | null;
  sequences: Sequence[];
  oscConfig: OscConfig;
  serialConfig: SerialConfig;
  dmxConfig: DmxConfig;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  message: string;
  type: 'info' | 'warn' | 'error';
}

export interface FrameUpdatePayload {
  frame: number;
  values: Record<string, number>;
}
