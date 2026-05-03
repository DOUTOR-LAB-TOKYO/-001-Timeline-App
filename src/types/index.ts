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

export interface Sequence {
  id: string;
  name: string;
  enabled: boolean;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  color: string;
  oscAddress: string;
  valueType: 'float' | 'int';
  min: number;
  max: number;
  defaultValue: number;
  keyframes: Keyframe[];
}

export interface OscConfig {
  ip: string;
  port: number;
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
