// src/solvers/fingerSolver.ts
import * as THREE from 'three';
import { StandardBone } from '../types/boneMapping';
import { clamp, getV, hasBone, inv, makeOrthoBasis } from './mathUtils';

const PI = Math.PI;

function computeFallbackHandBasis(
  lm: Record<string, [number, number, number]>,
  isLeft: boolean
): THREE.Quaternion | null {
  const wristKey = isLeft ? StandardBone.LeftHand : StandardBone.RightHand;
  const idxKey = isLeft ? StandardBone.LeftIndex1 : StandardBone.RightIndex1;
  const pinkyKey = isLeft ? StandardBone.LeftLittle1 : StandardBone.RightLittle1;
  const midKey = isLeft ? StandardBone.LeftMiddle1 : StandardBone.RightMiddle1;

  if (!hasBone(lm, wristKey) || !hasBone(lm, midKey) || !hasBone(lm, idxKey) || !hasBone(lm, pinkyKey)) {
    return null;
  }

  const pWrist = getV(lm, wristKey);
  const pMiddle1 = getV(lm, midKey);
  const pIndex1 = getV(lm, idxKey);
  const pPinky1 = getV(lm, pinkyKey);

  const dir = new THREE.Vector3().subVectors(pMiddle1, pWrist);
  const sideVecDiff = new THREE.Vector3().subVectors(pIndex1, pPinky1);
  if (dir.lengthSq() < 1e-6 || sideVecDiff.lengthSq() < 1e-6) return null;

  const boneDir = dir.normalize();
  const sideVec = sideVecDiff.normalize();
  const axisX = isLeft ? boneDir.clone() : boneDir.clone().negate();
  const axisY = isLeft
    ? new THREE.Vector3().crossVectors(sideVec, boneDir).normalize()
    : new THREE.Vector3().crossVectors(boneDir, sideVec).normalize();

  if (axisY.lengthSq() < 1e-4 || isNaN(axisY.x)) return null;
  const axisZ = new THREE.Vector3().crossVectors(axisX, axisY).normalize();
  return makeOrthoBasis(axisX, axisY, axisZ);
}

function measureSignedCurl(vLocal: THREE.Vector3, isLeft: boolean): number {
  const fwd = isLeft ? vLocal.x : -vLocal.x;
  const horiz = Math.hypot(fwd, vLocal.z) * (fwd >= 0 ? 1 : -1);
  let curl = Math.atan2(-vLocal.y, horiz);
  if (curl < -PI * 0.5) curl += PI * 2;
  return curl;
}

export function solveFingers(
  lm: Record<string, [number, number, number]>,
  isLeft: boolean,
  handWorldQ?: THREE.Quaternion,
  restLm?: Record<string, [number, number, number]>
) {
  const sideKey = isLeft ? 'left' : 'right';
  const results: Record<string, THREE.Quaternion> = {};

  const activeHandQ =
    handWorldQ || computeFallbackHandBasis(lm, isLeft) || new THREE.Quaternion(0, 0, 0, 1);
  const handInv = inv(activeHandQ);

  const restHandQ = restLm ? computeFallbackHandBasis(restLm, isLeft) : null;
  const restHandInv = restHandQ ? inv(restHandQ) : null;

  const fingerGroups = [
    {
      name: 'Index',
      k1: isLeft ? StandardBone.LeftIndex1 : StandardBone.RightIndex1,
      k2: isLeft ? StandardBone.LeftIndex2 : StandardBone.RightIndex2,
      k3: isLeft ? StandardBone.LeftIndex3 : StandardBone.RightIndex3,
    },
    {
      name: 'Middle',
      k1: isLeft ? StandardBone.LeftMiddle1 : StandardBone.RightMiddle1,
      k2: isLeft ? StandardBone.LeftMiddle2 : StandardBone.RightMiddle2,
      k3: isLeft ? StandardBone.LeftMiddle3 : StandardBone.RightMiddle3,
    },
    {
      name: 'Ring',
      k1: isLeft ? StandardBone.LeftRing1 : StandardBone.RightRing1,
      k2: isLeft ? StandardBone.LeftRing2 : StandardBone.RightRing2,
      k3: isLeft ? StandardBone.LeftRing3 : StandardBone.RightRing3,
    },
    {
      name: 'Little',
      k1: isLeft ? StandardBone.LeftLittle1 : StandardBone.RightLittle1,
      k2: isLeft ? StandardBone.LeftLittle2 : StandardBone.RightLittle2,
      k3: isLeft ? StandardBone.LeftLittle3 : StandardBone.RightLittle3,
    },
  ] as const;

  // 1. 食指、中指、无名指、小指（在手掌局部系下解算带正负号的屈曲 + 扇形张开）
  fingerGroups.forEach(({ name, k1, k2, k3 }) => {
    const has12 = hasBone(lm, k1) && hasBone(lm, k2);
    if (!has12) {
      results[`${sideKey}${name}Proximal`] = new THREE.Quaternion(0, 0, 0, 1);
      results[`${sideKey}${name}Intermediate`] = new THREE.Quaternion(0, 0, 0, 1);
      results[`${sideKey}${name}Distal`] = new THREE.Quaternion(0, 0, 0, 1);
      return;
    }

    const p1 = getV(lm, k1);
    const p2 = getV(lm, k2);
    const d1World = new THREE.Vector3().subVectors(p2, p1);
    if (d1World.lengthSq() < 1e-8) {
      results[`${sideKey}${name}Proximal`] = new THREE.Quaternion(0, 0, 0, 1);
      results[`${sideKey}${name}Intermediate`] = new THREE.Quaternion(0, 0, 0, 1);
      results[`${sideKey}${name}Distal`] = new THREE.Quaternion(0, 0, 0, 1);
      return;
    }

    const d1Local = d1World.normalize().applyQuaternion(handInv).normalize();
    const curlProx = clamp(measureSignedCurl(d1Local, isLeft), -0.2, PI * 0.65);

    // 侧向张开角（扣除 Rest Pose 自带的自然指缝张角，并在深握拳时平滑衰减防万向锁噪点）
    const fwd1 = isLeft ? d1Local.x : -d1Local.x;
    let restSpread = 0;
    if (restLm && restHandInv && hasBone(restLm, k1) && hasBone(restLm, k2)) {
      const rDiff = new THREE.Vector3().subVectors(getV(restLm, k2), getV(restLm, k1));
      if (rDiff.lengthSq() > 1e-8) {
        const rLocal = rDiff.normalize().applyQuaternion(restHandInv).normalize();
        const rFwd = isLeft ? rLocal.x : -rLocal.x;
        restSpread = Math.atan2(rLocal.z, Math.max(0.2, rFwd));
      }
    }
    const rawSpread = Math.atan2(d1Local.z, Math.max(0.2, fwd1));
    const spreadWeight = clamp((fwd1 - 0.1) / 0.4, 0, 1);
    const spreadProx = clamp((rawSpread - restSpread) * spreadWeight, -0.35, 0.35);

    const zRotProx = isLeft ? -curlProx : curlProx;
    const yRotProx = isLeft ? -spreadProx : spreadProx;
    const qProx = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, yRotProx, zRotProx, 'YZX')
    );

    let curlInter = clamp(curlProx * 0.85, 0, PI * 0.65);
    if (hasBone(lm, k3)) {
      const p3 = getV(lm, k3);
      const d2World = new THREE.Vector3().subVectors(p3, p2);
      if (d2World.lengthSq() > 1e-8) {
        const d2InHand = d2World.normalize().applyQuaternion(handInv);
        const d2InProx = d2InHand.applyQuaternion(inv(qProx)).normalize();
        curlInter = clamp(measureSignedCurl(d2InProx, isLeft), -0.1, PI * 0.72);
      }
    }

    const curlDist = clamp(curlInter * 0.75, 0, PI * 0.55);
    const zRotInter = isLeft ? -curlInter : curlInter;
    const zRotDist = isLeft ? -curlDist : curlDist;

    results[`${sideKey}${name}Proximal`] = qProx;
    results[`${sideKey}${name}Intermediate`] = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, 0, zRotInter, 'XYZ')
    );
    results[`${sideKey}${name}Distal`] = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, 0, zRotDist, 'XYZ')
    );
  });

  // 2. 大拇指（在手掌局部系下做 3D 方向增量求解，支持扣向掌心与两节/三节拇指）
  const t0Key = isLeft ? StandardBone.LeftThumb0 : StandardBone.RightThumb0;
  const t1Key = isLeft ? StandardBone.LeftThumb1 : StandardBone.RightThumb1;
  const t2Key = isLeft ? StandardBone.LeftThumb2 : StandardBone.RightThumb2;

  const hasT0 = hasBone(lm, t0Key);
  const hasT1 = hasBone(lm, t1Key);
  const hasT2 = hasBone(lm, t2Key);

  const fallbackThumbDir = new THREE.Vector3(isLeft ? 0.65 : -0.65, -0.25, 0.72).normalize();
  let restDir01 = fallbackThumbDir.clone();
  let restDir12 = fallbackThumbDir.clone();

  if (restLm && restHandInv) {
    if (hasBone(restLm, t0Key) && hasBone(restLm, t1Key)) {
      const r01 = new THREE.Vector3().subVectors(getV(restLm, t1Key), getV(restLm, t0Key));
      if (r01.lengthSq() > 1e-8) {
        restDir01 = r01.normalize().applyQuaternion(restHandInv).normalize();
      }
    }
    if (hasBone(restLm, t1Key) && hasBone(restLm, t2Key)) {
      const r12 = new THREE.Vector3().subVectors(getV(restLm, t2Key), getV(restLm, t1Key));
      if (r12.lengthSq() > 1e-8) {
        restDir12 = r12.normalize().applyQuaternion(restHandInv).normalize();
      }
    } else {
      restDir12 = restDir01.clone();
    }
  }

  let qThumbMeta = new THREE.Quaternion(0, 0, 0, 1);
  let qThumbProx = new THREE.Quaternion(0, 0, 0, 1);
  let qThumbDist = new THREE.Quaternion(0, 0, 0, 1);

  if (hasT0 && hasT1) {
    const t0 = getV(lm, t0Key);
    const t1 = getV(lm, t1Key);
    const cur01World = new THREE.Vector3().subVectors(t1, t0);
    if (cur01World.lengthSq() > 1e-8) {
      const cur01Local = cur01World.normalize().applyQuaternion(handInv).normalize();
      qThumbMeta.setFromUnitVectors(restDir01, cur01Local).normalize();
    }

    if (hasT2) {
      const t2 = getV(lm, t2Key);
      const cur12World = new THREE.Vector3().subVectors(t2, t1);
      if (cur12World.lengthSq() > 1e-8) {
        const cur12InHand = cur12World.normalize().applyQuaternion(handInv);
        const cur12AfterMeta = cur12InHand.applyQuaternion(inv(qThumbMeta)).normalize();
        qThumbProx.setFromUnitVectors(restDir12, cur12AfterMeta).normalize();
        qThumbDist = new THREE.Quaternion().slerp(qThumbProx, 0.65).normalize();
      }
    } else {
      // 兼容仅 2 节拇指的模型（Thumb0 + Thumb1）
      qThumbProx = new THREE.Quaternion().slerp(qThumbMeta, 0.7).normalize();
      qThumbDist = new THREE.Quaternion().slerp(qThumbMeta, 0.5).normalize();
    }
  } else if (hasT1 && hasT2) {
    const t1 = getV(lm, t1Key);
    const t2 = getV(lm, t2Key);
    const cur12World = new THREE.Vector3().subVectors(t2, t1);
    if (cur12World.lengthSq() > 1e-8) {
      const cur12Local = cur12World.normalize().applyQuaternion(handInv).normalize();
      qThumbProx.setFromUnitVectors(restDir12, cur12Local).normalize();
      qThumbDist = new THREE.Quaternion().slerp(qThumbProx, 0.65).normalize();
    }
  }

  results[`${sideKey}ThumbMetacarpal`] = qThumbMeta;
  results[`${sideKey}ThumbProximal`] = qThumbProx;
  results[`${sideKey}ThumbDistal`] = qThumbDist;

  return results;
}
