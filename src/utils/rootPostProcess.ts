// src/utils/rootPostProcess.ts
import * as THREE from 'three';
import { HumanoidBoneName, StandardBone } from '../types/boneMapping';
import { LandmarkData, LandmarkFrame } from '../types/types';

export type RootCenterMode = 'none' | 'start' | 'average';

export interface RootPostProcessConfig {
  centerMode: RootCenterMode;
  autoGround: boolean;
  clampFloor: boolean;
  /** 手动微调偏移（单位：米） */
  offsetX: number;
  offsetY: number;
  offsetZ: number;
}

export const DEFAULT_ROOT_POST_PROCESS: RootPostProcessConfig = {
  centerMode: 'none',
  autoGround: false,
  clampFloor: false,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
};

export type LandmarkDataWithPostProcess = LandmarkData & {
  rootPostProcess?: RootPostProcessConfig;
  smoothStrength?: number;
};

export interface RootDiagnosticStats {
  scaleFactor: number;
  rawStartX: number;
  rawStartZ: number;
  rawMinFootY: number;
  adjustedStartX: number;
  adjustedStartZ: number;
  adjustedMinFootY: number;
  isSinking: boolean;
  isFarFromOrigin: boolean;
}

export interface RootPostProcessPlan {
  stats: RootDiagnosticStats;
  baseDxMmd: number;
  baseDyMmd: number;
  baseDzMmd: number;
  manualDxMmd: number;
  manualDyMmd: number;
  manualDzMmd: number;
  getFrameOffsetMmd: (frameIdx: number) => [number, number, number];
  getFrameOffsetMeters: (frameIdx: number) => [number, number, number];
}

export function isRootPostProcessActive(cfg?: RootPostProcessConfig | null): boolean {
  if (!cfg) return false;
  return (
    cfg.centerMode !== 'none' ||
    cfg.autoGround ||
    cfg.clampFloor ||
    Math.abs(cfg.offsetX) > 1e-5 ||
    Math.abs(cfg.offsetY) > 1e-5 ||
    Math.abs(cfg.offsetZ) > 1e-5
  );
}

function getLmPoint(
  lm: Record<string, [number, number, number]> | undefined,
  keys: string[]
): [number, number, number] | undefined {
  if (!lm) return undefined;
  for (const k of keys) {
    if (lm[k]) return lm[k];
  }
  return undefined;
}

function getHipsPoint(lm: Record<string, [number, number, number]>): [number, number, number] {
  return (
    getLmPoint(lm, [StandardBone.Hips, 'hips', StandardBone.Root, 'root', 'センター']) || [0, 9.5, 0]
  );
}

export function computeMmdScaleAndClearance(data: LandmarkData): {
  scaleFactor: number;
  ankleClearanceMmd: number;
  toeClearanceMmd: number;
} {
  const frames = data.frames;
  if (!frames || frames.length === 0) {
    return { scaleFactor: 0.1, ankleClearanceMmd: 0.7, toeClearanceMmd: 0.15 };
  }

  const f0 = frames[0].landmarks;
  const pPelvis0Y = getHipsPoint(f0)[1];
  const lAnkle0 = getLmPoint(f0, [StandardBone.LeftFoot, 'leftFoot', '左足首'])?.[1] ?? 1.0;
  const rAnkle0 = getLmPoint(f0, [StandardBone.RightFoot, 'rightFoot', '右足首'])?.[1] ?? 1.0;
  const ankleBaseY = (lAnkle0 + rAnkle0) * 0.5;

  const mmdLegSpan = Math.max(0.5, pPelvis0Y - ankleBaseY);
  const scaleFactor = 0.87 / mmdLegSpan;

  const rest = data.restLandmarks;
  const rLA = getLmPoint(rest, [StandardBone.LeftFoot, 'leftFoot', '左足首'])?.[1];
  const rRA = getLmPoint(rest, [StandardBone.RightFoot, 'rightFoot', '右足首'])?.[1];
  let ankleClearanceMmd = 0.07 / scaleFactor;
  if (rLA !== undefined || rRA !== undefined) {
    const avg =
      rLA !== undefined && rRA !== undefined ? (rLA + rRA) * 0.5 : (rLA ?? rRA)!;
    if (avg >= 0.15 && avg <= 2.2) {
      ankleClearanceMmd = avg;
    }
  }

  const rLT = getLmPoint(rest, ['leftToes', 'LeftToes', '左つま先', '左足先EX'])?.[1];
  const rRT = getLmPoint(rest, ['rightToes', 'RightToes', '右つま先', '右足先EX'])?.[1];
  let toeClearanceMmd = 0.015 / scaleFactor;
  if (rLT !== undefined || rRT !== undefined) {
    const avg =
      rLT !== undefined && rRT !== undefined ? (rLT + rRT) * 0.5 : (rLT ?? rRT)!;
    if (avg >= 0 && avg <= 0.8) {
      toeClearanceMmd = avg;
    }
  }

  return { scaleFactor, ankleClearanceMmd, toeClearanceMmd };
}

function getFrameContactFloorYMmd(
  frame: LandmarkFrame,
  ankleClearanceMmd: number,
  toeClearanceMmd: number
): number {
  const lm = frame.landmarks;
  const candidates: number[] = [];

  const lAnkle = getLmPoint(lm, [StandardBone.LeftFoot, 'leftFoot', '左足首']);
  const rAnkle = getLmPoint(lm, [StandardBone.RightFoot, 'rightFoot', '右足首']);
  const lToe = getLmPoint(lm, ['leftToes', 'LeftToes', '左つま先', '左足先EX']);
  const rToe = getLmPoint(lm, ['rightToes', 'RightToes', '右つま先', '右足先EX']);

  if (lAnkle) candidates.push(lAnkle[1] - ankleClearanceMmd);
  if (rAnkle) candidates.push(rAnkle[1] - ankleClearanceMmd);
  if (lToe) candidates.push(lToe[1] - toeClearanceMmd);
  if (rToe) candidates.push(rToe[1] - toeClearanceMmd);

  if (candidates.length === 0) {
    return getHipsPoint(lm)[1] - ankleClearanceMmd * 12;
  }
  return Math.min(...candidates);
}

/**
 * 基于 LandmarkData 分析当前区间位置与脚底最低高度，生成 3D 预览偏移方案
 */
export function analyzeRootPostProcess(
  data: LandmarkData,
  cfg: RootPostProcessConfig,
  startFrame = 0,
  endFrame?: number
): RootPostProcessPlan {
  const frames = data.frames;
  if (!frames || frames.length === 0) {
    return {
      stats: {
        scaleFactor: 0.1,
        rawStartX: 0,
        rawStartZ: 0,
        rawMinFootY: 0,
        adjustedStartX: 0,
        adjustedStartZ: 0,
        adjustedMinFootY: 0,
        isSinking: false,
        isFarFromOrigin: false,
      },
      baseDxMmd: 0,
      baseDyMmd: 0,
      baseDzMmd: 0,
      manualDxMmd: 0,
      manualDyMmd: 0,
      manualDzMmd: 0,
      getFrameOffsetMmd: () => [0, 0, 0],
      getFrameOffsetMeters: () => [0, 0, 0],
    };
  }

  const s = Math.max(0, Math.min(startFrame, frames.length - 1));
  const e = Math.max(s, Math.min(endFrame ?? frames.length - 1, frames.length - 1));
  const { scaleFactor, ankleClearanceMmd, toeClearanceMmd } = computeMmdScaleAndClearance(data);
  const invScale = 1 / scaleFactor;

  const frameFloorY = new Float32Array(frames.length);
  let sumX = 0;
  let sumZ = 0;
  let rawMinFootYMmd = Infinity;

  for (let i = 0; i < frames.length; i++) {
    const floorY = getFrameContactFloorYMmd(frames[i], ankleClearanceMmd, toeClearanceMmd);
    frameFloorY[i] = floorY;
    if (i >= s && i <= e) {
      const hips = getHipsPoint(frames[i].landmarks);
      sumX += hips[0];
      sumZ += hips[2];
      if (floorY < rawMinFootYMmd) rawMinFootYMmd = floorY;
    }
  }

  const rangeCount = Math.max(1, e - s + 1);
  const startHips = getHipsPoint(frames[s].landmarks);
  const meanX = sumX / rangeCount;
  const meanZ = sumZ / rangeCount;

  let baseDxMmd = 0;
  let baseDzMmd = 0;
  if (cfg.centerMode === 'start') {
    baseDxMmd = -startHips[0];
    baseDzMmd = -startHips[2];
  } else if (cfg.centerMode === 'average') {
    baseDxMmd = -meanX;
    baseDzMmd = -meanZ;
  }

  const baseDyMmd = cfg.autoGround && Number.isFinite(rawMinFootYMmd) ? -rawMinFootYMmd : 0;

  const manualDxMmd = (Number.isFinite(cfg.offsetX) ? cfg.offsetX : 0) * invScale;
  const manualDyMmd = (Number.isFinite(cfg.offsetY) ? cfg.offsetY : 0) * invScale;
  const manualDzMmd = (Number.isFinite(cfg.offsetZ) ? cfg.offsetZ : 0) * invScale;

  const getClampLiftMmd = (idx: number): number => {
    if (!cfg.clampFloor) return 0;
    const safeIdx = Math.max(0, Math.min(idx, frames.length - 1));
    const yAfterAuto = frameFloorY[safeIdx] + baseDyMmd;
    return yAfterAuto < 0 ? -yAfterAuto : 0;
  };

  let adjMinFootYMmd = Infinity;
  for (let i = s; i <= e; i++) {
    const adjY = frameFloorY[i] + baseDyMmd + getClampLiftMmd(i) + manualDyMmd;
    if (adjY < adjMinFootYMmd) adjMinFootYMmd = adjY;
  }

  const rawStartX = startHips[0] * scaleFactor;
  const rawStartZ = startHips[2] * scaleFactor;
  const rawMinFootY = rawMinFootYMmd * scaleFactor;

  const adjustedStartX = (startHips[0] + baseDxMmd + manualDxMmd) * scaleFactor;
  const adjustedStartZ = (startHips[2] + baseDzMmd + manualDzMmd) * scaleFactor;
  const adjustedMinFootY = adjMinFootYMmd * scaleFactor;

  const getFrameOffsetMmd = (frameIdx: number): [number, number, number] => [
    baseDxMmd + manualDxMmd,
    baseDyMmd + getClampLiftMmd(frameIdx) + manualDyMmd,
    baseDzMmd + manualDzMmd,
  ];

  const getFrameOffsetMeters = (frameIdx: number): [number, number, number] => {
    const [dx, dy, dz] = getFrameOffsetMmd(frameIdx);
    return [dx * scaleFactor, dy * scaleFactor, dz * scaleFactor];
  };

  return {
    stats: {
      scaleFactor,
      rawStartX,
      rawStartZ,
      rawMinFootY,
      adjustedStartX,
      adjustedStartZ,
      adjustedMinFootY,
      isSinking: rawMinFootY < -0.05,
      isFarFromOrigin: Math.hypot(rawStartX, rawStartZ) > 0.5,
    },
    baseDxMmd,
    baseDyMmd,
    baseDzMmd,
    manualDxMmd,
    manualDyMmd,
    manualDzMmd,
    getFrameOffsetMmd,
    getFrameOffsetMeters,
  };
}

export function offsetLandmarks(
  landmarks: Record<string, [number, number, number]>,
  dx: number,
  dy: number,
  dz: number
): Record<string, [number, number, number]> {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6 && Math.abs(dz) < 1e-6) {
    return landmarks;
  }
  const shifted: Record<string, [number, number, number]> = {};
  for (const [k, v] of Object.entries(landmarks)) {
    shifted[k] = [v[0] + dx, v[1] + dy, v[2] + dz];
  }
  return shifted;
}

/**
 * 导出前对已求解的 Humanoid 骨骼轨迹应用精确 FK 贴地、钳位、原点归位及手动微调（原地修改 hipsPositions）
 */
export function applyRootPostProcessToSolvedHumanoid(
  hipsPositions: number[],
  quatTracksData: Record<HumanoidBoneName, number[]>,
  cfg?: RootPostProcessConfig
): void {
  if (!isRootPostProcessActive(cfg) || !cfg) return;
  const frameCount = Math.floor(hipsPositions.length / 3);
  if (frameCount === 0) return;

  // 与 motionExporter.ts createHumanoidBoneHierarchy 保持严格一致的骨骼局部长度（米）
  const offLUpLeg = new THREE.Vector3(0.1, -0.05, 0);
  const offRUpLeg = new THREE.Vector3(-0.1, -0.05, 0);
  const offLowLeg = new THREE.Vector3(0, -0.42, 0);
  const offFoot = new THREE.Vector3(0, -0.4, 0);
  const offToes = new THREE.Vector3(0, -0.05, 0.14);

  const pHips = new THREE.Vector3();
  const qHips = new THREE.Quaternion();
  const qTmp = new THREE.Quaternion();
  const qWorld = new THREE.Quaternion();
  const pCur = new THREE.Vector3();
  const vTmp = new THREE.Vector3();

  const readQ = (arr: number[] | undefined, idx: number, out: THREE.Quaternion) => {
    if (!arr || idx * 4 + 3 >= arr.length) {
      out.set(0, 0, 0, 1);
      return out;
    }
    const i4 = idx * 4;
    return out.set(arr[i4], arr[i4 + 1], arr[i4 + 2], arr[i4 + 3]).normalize();
  };

  const computeLegMinContactY = (
    i: number,
    upOffset: THREE.Vector3,
    upName: HumanoidBoneName,
    lowName: HumanoidBoneName,
    footName: HumanoidBoneName
  ): number => {
    pCur.copy(pHips).add(vTmp.copy(upOffset).applyQuaternion(qHips));
    qWorld.copy(qHips).multiply(readQ(quatTracksData[upName], i, qTmp));

    pCur.add(vTmp.copy(offLowLeg).applyQuaternion(qWorld));
    qWorld.multiply(readQ(quatTracksData[lowName], i, qTmp));

    pCur.add(vTmp.copy(offFoot).applyQuaternion(qWorld));
    qWorld.multiply(readQ(quatTracksData[footName], i, qTmp));
    const ankleY = pCur.y;

    const toePosY = ankleY + vTmp.copy(offToes).applyQuaternion(qWorld).y;
    return Math.min(ankleY - 0.07, toePosY - 0.02);
  };

  const contactFloorY = new Float32Array(frameCount);
  let minContactY = Infinity;
  let sumX = 0;
  let sumZ = 0;

  for (let i = 0; i < frameCount; i++) {
    const i3 = i * 3;
    pHips.set(hipsPositions[i3], hipsPositions[i3 + 1], hipsPositions[i3 + 2]);
    readQ(quatTracksData.hips, i, qHips);

    sumX += pHips.x;
    sumZ += pHips.z;

    const leftMinY = computeLegMinContactY(
      i,
      offLUpLeg,
      'leftUpperLeg',
      'leftLowerLeg',
      'leftFoot'
    );
    const rightMinY = computeLegMinContactY(
      i,
      offRUpLeg,
      'rightUpperLeg',
      'rightLowerLeg',
      'rightFoot'
    );
    const frameMin = Math.min(leftMinY, rightMinY);
    contactFloorY[i] = frameMin;
    if (frameMin < minContactY) minContactY = frameMin;
  }

  let dx = 0;
  let dz = 0;
  if (cfg.centerMode === 'start') {
    dx = -hipsPositions[0];
    dz = -hipsPositions[2];
  } else if (cfg.centerMode === 'average') {
    dx = -(sumX / frameCount);
    dz = -(sumZ / frameCount);
  }

  const dyBase = cfg.autoGround && Number.isFinite(minContactY) ? -minContactY : 0;
  const offX = Number.isFinite(cfg.offsetX) ? cfg.offsetX : 0;
  const offY = Number.isFinite(cfg.offsetY) ? cfg.offsetY : 0;
  const offZ = Number.isFinite(cfg.offsetZ) ? cfg.offsetZ : 0;

  for (let i = 0; i < frameCount; i++) {
    const i3 = i * 3;
    const afterAutoY = contactFloorY[i] + dyBase;
    const clampLift = cfg.clampFloor && afterAutoY < 0 ? -afterAutoY : 0;

    hipsPositions[i3 + 0] += dx + offX;
    hipsPositions[i3 + 1] += dyBase + clampLift + offY;
    hipsPositions[i3 + 2] += dz + offZ;
  }
}
