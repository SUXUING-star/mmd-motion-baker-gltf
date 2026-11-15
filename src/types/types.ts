// src/types/types.ts


export interface ModelMorphInfo {
  rawName: string;
  targetKey: string;
  isPreset: boolean;
}

export interface LandmarkFrame {
  time: number;
  landmarks: Record<string, [number, number, number]>;
  expressions?: Record<string, number>;
  previewTime?: number;
  previewBlendTarget?: { startTime: number; weight: number };
}

export interface LandmarkData {
  fps: number;
  totalFrames: number;
  duration: number;
  frames: LandmarkFrame[];
  restLandmarks?: Record<string, [number, number, number]>;
  availableMorphs?: ModelMorphInfo[];
  loopMode?: 'overlap' | 'warp';
  loopBridgeFrames?: number;
  loopInPlace?: boolean;
  /** 同相位续播轨 (Track A: E+1 .. E+B) */
  bridgeContinuation?: LandmarkFrame[];
  /** 同相位接回轨 (Track B: S+1 .. S+B) */
  bridgeLeadIn?: LandmarkFrame[];
}
