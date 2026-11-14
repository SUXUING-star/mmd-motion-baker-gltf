// src/utils/mathSolver.ts
import * as THREE from 'three';
import { solveFingers } from '../solvers/fingerSolver';
import { solveHips } from '../solvers/hipsSolver';
import { solveLimbs } from '../solvers/limbSolver';
import { ensureQuatContinuity, getV, hasBone } from '../solvers/mathUtils';
import { solveSpine } from '../solvers/spineSolver';
import { StandardBone } from '../types/boneMapping';
import { HUMANOID_BONES, HumanoidBoneName, LandmarkData } from '../types/types';

function isLandmarkLoopClosed(data: LandmarkData): boolean {
  if (data.loopBridgeFrames && data.loopBridgeFrames > 0) return true;
  const { frames } = data;
  if (frames.length < 6) return false;
  const first = frames[0].landmarks;
  const last = frames[frames.length - 1].landmarks;
  let sumSq = 0;
  let count = 0;
  for (const k in first) {
    if (last[k]) {
      const dx = first[k][0] - last[k][0];
      const dy = first[k][1] - last[k][1];
      const dz = first[k][2] - last[k][2];
      sumSq += dx * dx + dy * dy + dz * dz;
      count++;
    }
  }
  return count > 0 && sumSq / count < 1e-4;
}

export function solveAllHumanoidQuaternions(data: LandmarkData) {
  const { frames } = data;
  if (frames.length === 0) {
    return { times: [], hipsPositions: [], quatTracksData: {} as any };
  }

  const f0 = frames[0].landmarks;
  const restLm = data.restLandmarks;

  const pPelvis0 = hasBone(f0, StandardBone.Hips)
    ? getV(f0, StandardBone.Hips)
    : getV(f0, StandardBone.Root, new THREE.Vector3(0, 9.5, 0));
  const pPelvis0Y = pPelvis0.y;

  const pLAnkle0Y = getV(f0, StandardBone.LeftFoot, new THREE.Vector3(0, 1.0, 0)).y;
  const pRAnkle0Y = getV(f0, StandardBone.RightFoot, new THREE.Vector3(0, 1.0, 0)).y;
  const ankleBaseY = (pLAnkle0Y + pRAnkle0Y) / 2;

  const mmdLegSpan = Math.max(0.5, pPelvis0Y - ankleBaseY);
  const scaleFactor = 0.87 / mmdLegSpan;

  const frameCount = frames.length;
  const bridgeCount =
    data.loopBridgeFrames && data.loopBridgeFrames > 0 && data.loopBridgeFrames < frameCount - 2
      ? data.loopBridgeFrames
      : 0;
  const bodyEndIdx = frameCount - 1 - bridgeCount;

  const times: number[] = [];
  const hipsPositions: number[] = [];
  const quatTracksData: Record<HumanoidBoneName, number[]> = {} as any;

  HUMANOID_BONES.forEach((k) => (quatTracksData[k] = []));
  const prevQuats: Partial<Record<HumanoidBoneName, THREE.Quaternion>> = {};

  // 1. 仅对主体真实帧（0 .. bodyEndIdx）解算 IK/FK；若无桥接则解算全部帧
  const solveLimit = bridgeCount > 0 ? bodyEndIdx + 1 : frameCount;
  for (let f = 0; f < solveLimit; f++) {
    const frame = frames[f];
    const lm = frame.landmarks;
    times.push(frame.time);

    const hips = solveHips(lm, scaleFactor, ankleBaseY);
    const spine = solveSpine(lm, hips.hipsWorldQ, hips.hipForward, restLm);
    const limbs = solveLimbs(
      lm,
      spine.spineWorldQ,
      hips.hipsWorldQ,
      hips.hipSideOrtho,
      spine.spineUp,
      restLm
    );

    const leftFingers = solveFingers(lm, true);
    const rightFingers = solveFingers(lm, false);

    const localMap = {
      hips: hips.hipsWorldQ,
      ...spine.localRotations,
      ...limbs.localRotations,
      ...leftFingers,
      ...rightFingers,
    } as Record<HumanoidBoneName, THREE.Quaternion>;

    hipsPositions.push(hips.hipsPosition.x, hips.hipsPosition.y, hips.hipsPosition.z);

    HUMANOID_BONES.forEach((k) => {
      const qRaw = localMap[k] || new THREE.Quaternion(0, 0, 0, 1);
      const qContinuous = ensureQuatContinuity(qRaw, prevQuats[k]);
      prevQuats[k] = qContinuous.clone();

      quatTracksData[k].push(qContinuous.x, qContinuous.y, qContinuous.z, qContinuous.w);
    });
  }

  // 2. 若存在循环过渡段，直接在 Humanoid 骨骼四元数空间 + Hips 位移空间执行 SLERP 缝合！
  //    彻底绕过 3D 坐标插值喂给三角函数 IK 带来的膝盖/脚踝非线性突变！
  if (bridgeCount > 0) {
    const fps = data.fps || 30;
    const dt = 1 / fps;
    const T = bridgeCount * dt;

    const h0 = new THREE.Vector3(hipsPositions[0], hipsPositions[1], hipsPositions[2]);
    const h0Next = new THREE.Vector3(hipsPositions[3], hipsPositions[4], hipsPositions[5]);
    const hEnd = new THREE.Vector3(
      hipsPositions[bodyEndIdx * 3],
      hipsPositions[bodyEndIdx * 3 + 1],
      hipsPositions[bodyEndIdx * 3 + 2]
    );
    const hEndPrev = new THREE.Vector3(
      hipsPositions[(bodyEndIdx - 1) * 3],
      hipsPositions[(bodyEndIdx - 1) * 3 + 1],
      hipsPositions[(bodyEndIdx - 1) * 3 + 2]
    );

    const vEnd = hEnd.clone().sub(hEndPrev).divideScalar(dt).multiplyScalar(0.5);
    const vStart = h0Next.clone().sub(h0).divideScalar(dt).multiplyScalar(0.5);

    const qStartMap: Record<string, THREE.Quaternion> = {};
    const qEndMap: Record<string, THREE.Quaternion> = {};
    const qTargetMap: Record<string, THREE.Quaternion> = {};

    HUMANOID_BONES.forEach((k) => {
      const arr = quatTracksData[k];
      const q0 = new THREE.Quaternion(arr[0], arr[1], arr[2], arr[3]).normalize();
      const qE = new THREE.Quaternion(
        arr[bodyEndIdx * 4],
        arr[bodyEndIdx * 4 + 1],
        arr[bodyEndIdx * 4 + 2],
        arr[bodyEndIdx * 4 + 3]
      ).normalize();

      // 取与主体尾帧同半球的最短弧等价四元数（4 分量取反代表同一旋转）
      const qTarget = q0.clone();
      if (qE.dot(q0) < 0) {
        qTarget.set(-qTarget.x, -qTarget.y, -qTarget.z, -qTarget.w);
      }

      qStartMap[k] = q0;
      qEndMap[k] = qE;
      qTargetMap[k] = qTarget;
    });

    const tmpQuat = new THREE.Quaternion();

    for (let step = 1; step <= bridgeCount; step++) {
      const frameIdx = bodyEndIdx + step;
      times.push(frames[frameIdx].time);

      const u = step / bridgeCount;
      // Quintic smootherstep 保证一阶导数与二阶导数在首尾均平滑衔接
      const smoothW = u * u * u * (u * (u * 6 - 15) + 10);

      if (step === bridgeCount) {
        hipsPositions.push(h0.x, h0.y, h0.z);
      } else {
        const u2 = u * u;
        const u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;

        const hx = h00 * hEnd.x + h10 * (T * vEnd.x) + h01 * h0.x + h11 * (T * vStart.x);
        const hy = h00 * hEnd.y + h10 * (T * vEnd.y) + h01 * h0.y + h11 * (T * vStart.y);
        const hz = h00 * hEnd.z + h10 * (T * vEnd.z) + h01 * h0.z + h11 * (T * vStart.z);
        hipsPositions.push(hx, hy, hz);
      }

      HUMANOID_BONES.forEach((k) => {
        tmpQuat.copy(qEndMap[k]).slerp(qTargetMap[k], smoothW).normalize();
        quatTracksData[k].push(tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w);
      });
    }
  }

  // 3. 跨首尾闭环环形平滑滤波（消除尾帧接回首帧的速度折角）
  const isClosedLoop = isLandmarkLoopClosed(data);
  const period = isClosedLoop ? frameCount - 1 : frameCount;

  const resolveIndex = (i: number, offset: number): number => {
    if (isClosedLoop) {
      return ((i + offset) % period + period) % period;
    }
    return Math.max(0, Math.min(frameCount - 1, i + offset));
  };

  if (frameCount > 4) {
    for (let axis = 0; axis < 3; axis++) {
      const smoothed = new Float32Array(frameCount);
      for (let i = 0; i < period; i++) {
        const p0 = hipsPositions[resolveIndex(i, -2) * 3 + axis];
        const p1 = hipsPositions[resolveIndex(i, -1) * 3 + axis];
        const p2 = hipsPositions[i * 3 + axis];
        const p3 = hipsPositions[resolveIndex(i, 1) * 3 + axis];
        const p4 = hipsPositions[resolveIndex(i, 2) * 3 + axis];
        smoothed[i] = (p0 + p1 * 2 + p2 * 4 + p3 * 2 + p4) / 10;
      }
      if (isClosedLoop) {
        smoothed[frameCount - 1] = smoothed[0];
      }
      for (let i = 0; i < frameCount; i++) {
        hipsPositions[i * 3 + axis] = smoothed[i];
      }
    }

    const weights = [1, 3, 6, 3, 1];
    HUMANOID_BONES.forEach((k) => {
      const arr = quatTracksData[k];
      const out = new Float32Array(frameCount * 4);

      for (let i = 0; i < period; i++) {
        const cx = arr[i * 4];
        const cy = arr[i * 4 + 1];
        const cz = arr[i * 4 + 2];
        const cw = arr[i * 4 + 3];

        let sx = 0;
        let sy = 0;
        let sz = 0;
        let sw = 0;

        for (let offset = -2; offset <= 2; offset++) {
          const idx = resolveIndex(i, offset);
          const w = weights[offset + 2];
          let qx = arr[idx * 4];
          let qy = arr[idx * 4 + 1];
          let qz = arr[idx * 4 + 2];
          let qw = arr[idx * 4 + 3];

          if (qx * cx + qy * cy + qz * cz + qw * cw < 0) {
            qx = -qx;
            qy = -qy;
            qz = -qz;
            qw = -qw;
          }

          sx += qx * w;
          sy += qy * w;
          sz += qz * w;
          sw += qw * w;
        }

        const len = Math.hypot(sx, sy, sz, sw) || 1;
        out[i * 4] = sx / len;
        out[i * 4 + 1] = sy / len;
        out[i * 4 + 2] = sz / len;
        out[i * 4 + 3] = sw / len;
      }

      for (let i = 1; i < period; i++) {
        const px = out[(i - 1) * 4];
        const py = out[(i - 1) * 4 + 1];
        const pz = out[(i - 1) * 4 + 2];
        const pw = out[(i - 1) * 4 + 3];

        const cx = out[i * 4];
        const cy = out[i * 4 + 1];
        const cz = out[i * 4 + 2];
        const cw = out[i * 4 + 3];

        if (px * cx + py * cy + pz * cz + pw * cw < 0) {
          out[i * 4] = -cx;
          out[i * 4 + 1] = -cy;
          out[i * 4 + 2] = -cz;
          out[i * 4 + 3] = -cw;
        }
      }

      if (isClosedLoop) {
        const lastPrevIdx = (period - 1) * 4;
        let q0x = out[0];
        let q0y = out[1];
        let q0z = out[2];
        let q0w = out[3];

        const dot =
          out[lastPrevIdx] * q0x +
          out[lastPrevIdx + 1] * q0y +
          out[lastPrevIdx + 2] * q0z +
          out[lastPrevIdx + 3] * q0w;

        if (dot < 0) {
          q0x = -q0x;
          q0y = -q0y;
          q0z = -q0z;
          q0w = -q0w;
        }

        const tailIdx = (frameCount - 1) * 4;
        out[tailIdx] = q0x;
        out[tailIdx + 1] = q0y;
        out[tailIdx + 2] = q0z;
        out[tailIdx + 3] = q0w;
      }

      for (let j = 0; j < out.length; j++) {
        arr[j] = out[j];
      }
    });
  }

  return { times, hipsPositions, quatTracksData };
}
