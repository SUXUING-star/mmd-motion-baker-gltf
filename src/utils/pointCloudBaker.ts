// src/utils/pointCloudBaker.ts
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { LandmarkData, LandmarkFrame } from '../types/types';
import { BakerRenderCallback, loadPmxMeshOnly } from './baker';
import { createHumanoidBoneHierarchy } from './motionExporter';

export interface PointCloudBakerResult {
  landmarkData: LandmarkData;
  mesh: THREE.SkinnedMesh;
  animation?: THREE.AnimationClip;
}

const STANDARD_BODY_BONES = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
] as const;

// SMPL / HumanML3D / MotionGPT3 22关节顺序映射
const SMPL_22_MAPPING: (string | null)[] = [
  'hips',
  'leftUpperLeg',
  'rightUpperLeg',
  'spine',
  'leftLowerLeg',
  'rightLowerLeg',
  'chest',
  'leftFoot',
  'rightFoot',
  'upperChest',
  'leftToes',
  'rightToes',
  'neck',
  'leftShoulder',
  'rightShoulder',
  'head',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
];

const SMPLX_LEFT_FINGERS = [
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
];
const SMPLX_RIGHT_FINGERS = [
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
];

const KIT_21_MAPPING: (string | null)[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
  'leftHand',
  'rightHand',
];

function roundVec3(x: number, y: number, z: number): [number, number, number] {
  return [Number(x.toFixed(4)), Number(y.toFixed(4)), Number(z.toFixed(4))];
}

/**
 * 强力外部骨骼命名映射：解决 Unity/FBX/Biped/Mixamo/Rigify 的各种奇葩命名
 */
export function mapExternalBoneName(rawName: string): string | null {
  if (!rawName) return null;
  // 剥离命名空间和路径：例如 "Armature/root/mixamorig:LeftArm" -> "LeftArm"
  const clean = rawName
    .split('/')
    .pop()!
    .replace(/^.*:/, '')
    .replace(/^bip\d+[-_ ]*/i, '')
    .replace(/^valvebiped[-_ ]*/i, '')
    .replace(/^char_[-_ ]*/i, '')
    .replace(/^character\d*[-_ ]*/i, '')
    .replace(/^rig[-_ ]*/i, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();

  if (['hips', 'pelvis', 'hip', 'root', 'waist', 'bip01pelvis'].includes(clean)) return 'hips';
  if (['spine', 'spine1', 'spine01', 'lowerback', 'torso', 'abdomen', 'bip01spine'].includes(clean)) return 'spine';
  if (['chest', 'spine2', 'spine02', 'thorax', 'upperback', 'bip01spine1'].includes(clean)) return 'chest';
  if (['upperchest', 'chest1', 'spine3', 'spine03', 'bip01spine2'].includes(clean)) return 'upperChest';
  if (['neck', 'neck1', 'bip01neck'].includes(clean)) return 'neck';
  if (['head', 'bip01head'].includes(clean)) return 'head';

  const isLeft =
    clean.startsWith('left') ||
    clean.startsWith('l') && (clean.length === 2 || /^[a-z]+$/.test(clean)) ||
    clean.endsWith('l') ||
    clean.includes('left');

  const isRight =
    clean.startsWith('right') ||
    clean.startsWith('r') && (clean.length === 2 || /^[a-z]+$/.test(clean)) ||
    clean.endsWith('r') ||
    clean.includes('right');

  const side = isLeft && !isRight ? 'left' : isRight && !isLeft ? 'right' : null;

  if (side) {
    const s = clean
      .replace(/left|right/g, '')
      .replace(/(^l|^r|_l|_r|\.l|\.r)$/g, '')
      .replace(/^l_|^r_|^l|^r/, '');

    if (['shoulder', 'clavicle', 'collar'].includes(s)) return `${side}Shoulder`;
    if (['arm', 'uparm', 'upperarm', 'bicep', 'bicept'].includes(s)) return `${side}UpperArm`;
    if (['forearm', 'lowarm', 'lowerarm', 'elbow', 'armbottom'].includes(s)) return `${side}LowerArm`;
    if (['hand', 'wrist', 'palm'].includes(s)) return `${side}Hand`;

    if (['thigh', 'upback', 'upperleg', 'upleg', 'hip'].includes(s)) return `${side}UpperLeg`;
    if (['leg', 'lowleg', 'lowerleg', 'shin', 'calf', 'knee'].includes(s)) return `${side}LowerLeg`;
    if (['foot', 'ankle'].includes(s)) return `${side}Foot`;
    if (['toe', 'toes', 'toebase', 'ball'].includes(s)) return `${side}Toes`;

    // 手指映射
    if (s.includes('thumb')) {
      if (s.includes('1') || s.includes('prox') || s.includes('meta')) return `${side}ThumbMetacarpal`;
      if (s.includes('2') || s.includes('inter')) return `${side}ThumbProximal`;
      return `${side}ThumbDistal`;
    }
    if (s.includes('index')) {
      if (s.includes('1') || s.includes('prox')) return `${side}IndexProximal`;
      if (s.includes('2') || s.includes('inter')) return `${side}IndexIntermediate`;
      return `${side}IndexDistal`;
    }
    if (s.includes('middle')) {
      if (s.includes('1') || s.includes('prox')) return `${side}MiddleProximal`;
      if (s.includes('2') || s.includes('inter')) return `${side}MiddleIntermediate`;
      return `${side}MiddleDistal`;
    }
    if (s.includes('ring')) {
      if (s.includes('1') || s.includes('prox')) return `${side}RingProximal`;
      if (s.includes('2') || s.includes('inter')) return `${side}RingIntermediate`;
      return `${side}RingDistal`;
    }
    if (s.includes('little') || s.includes('pinky')) {
      if (s.includes('1') || s.includes('prox')) return `${side}LittleProximal`;
      if (s.includes('2') || s.includes('inter')) return `${side}LittleIntermediate`;
      return `${side}LittleDistal`;
    }
  }

  return null;
}

function buildCanonicalTPoseRest(scale: number): Record<string, [number, number, number]> {
  const bones = createHumanoidBoneHierarchy();
  bones.hips.updateMatrixWorld(true);
  const res: Record<string, [number, number, number]> = {};
  const v = new THREE.Vector3();
  Object.entries(bones).forEach(([name, bone]) => {
    bone.getWorldPosition(v);
    res[name] = roundVec3(v.x * scale, v.y * scale, v.z * scale);
  });
  return res;
}

/**
 * 彻底解决骨骼飘天/偏移的核心归一化：
 * 1. 自动补全中间缺失骨骼
 * 2. 坐标系轴向修正 (Z-up 自动转 Y-up)
 * 3. 根坐标去绝对偏移：消除第 0 帧 Hips XZ 漂移，将脚底基准对齐到地面 Y=0
 * 4. 自动缩放到 MMD 物理尺寸（~8.7 腿长）
 */
function normalizePointCloudFrames(
  rawFrames: LandmarkFrame[],
  rawRest?: Record<string, [number, number, number]>
): { frames: LandmarkFrame[]; restLandmarks: Record<string, [number, number, number]> } {
  if (rawFrames.length === 0) {
    throw new Error('动作帧数为 0，无法解算');
  }

  const fillMissing = (lm: Record<string, [number, number, number]>) => {
    const out: Record<string, [number, number, number]> = { ...lm };
    if (!out.spine && out.hips && (out.chest || out.neck)) {
      const top = out.chest || out.neck;
      out.spine = roundVec3(
        out.hips[0] * 0.65 + top[0] * 0.35,
        out.hips[1] * 0.65 + top[1] * 0.35,
        out.hips[2] * 0.65 + top[2] * 0.35
      );
    }
    if (!out.chest && out.spine && (out.upperChest || out.neck)) {
      const top = out.upperChest || out.neck;
      out.chest = roundVec3(
        (out.spine[0] + top[0]) * 0.5,
        (out.spine[1] + top[1]) * 0.5,
        (out.spine[2] + top[2]) * 0.5
      );
    }
    if (!out.upperChest && out.chest && out.neck) {
      const top = out.upperChest || out.neck;
      out.upperChest = roundVec3(
        out.chest[0] * 0.5 + top[0] * 0.5,
        out.chest[1] * 0.5 + top[1] * 0.5,
        out.chest[2] * 0.5 + top[2] * 0.5
      );
    }
    if (!out.neck && (out.upperChest || out.chest) && out.head) {
      const base = out.upperChest || out.chest;
      out.neck = roundVec3(
        base[0] * 0.4 + out.head[0] * 0.6,
        base[1] * 0.4 + out.head[1] * 0.6,
        base[2] * 0.4 + out.head[2] * 0.6
      );
    }
    return out;
  };

  let frames = rawFrames.map((f) => ({ ...f, landmarks: fillMissing(f.landmarks) }));
  let rest = rawRest ? fillMissing(rawRest) : undefined;

  // 1. 检测 Z-up 并转为 Y-up
  const probe = frames[0].landmarks;
  const pHips = probe.hips || probe.spine;
  const pHead = probe.head || probe.neck || probe.chest;
  if (pHips && pHead) {
    const dy = Math.abs(pHead[1] - pHips[1]);
    const dz = Math.abs(pHead[2] - pHips[2]);
    if (dz > dy * 1.3 && dz > 0.1) {
      const rotZUp = (lm: Record<string, [number, number, number]>) => {
        const next: Record<string, [number, number, number]> = {};
        for (const [k, [x, y, z]] of Object.entries(lm)) {
          next[k] = roundVec3(x, z, -y);
        }
        return next;
      };
      frames = frames.map((f) => ({ ...f, landmarks: rotZUp(f.landmarks) }));
      if (rest) rest = rotZUp(rest);
    }
  }

  // 2. 根位移归一化：消除 Unity/FBX 导出带有的全局场景绝对坐标偏移 (Offset Center)
  const f0 = frames[0].landmarks;
  const refHips = f0.hips || f0.spine || [0, 0, 0];
  const offsetX = refHips[0];
  const offsetZ = refHips[2];

  // 寻找脚底高度基准
  let minFootY = Infinity;
  for (let i = 0; i < Math.min(frames.length, 30); i++) {
    const flm = frames[i].landmarks;
    const ly = (flm.leftFoot || flm.leftLowerLeg || flm.hips)?.[1] ?? Infinity;
    const ry = (flm.rightFoot || flm.rightLowerLeg || flm.hips)?.[1] ?? Infinity;
    const low = Math.min(ly, ry);
    if (low < minFootY) minFootY = low;
  }
  const offsetY = minFootY !== Infinity ? minFootY : 0;

  const centerLm = (lm: Record<string, [number, number, number]>) => {
    const next: Record<string, [number, number, number]> = {};
    for (const [k, [x, y, z]] of Object.entries(lm)) {
      next[k] = roundVec3(x - offsetX, y - offsetY, z - offsetZ);
    }
    return next;
  };

  frames = frames.map((f) => ({ ...f, landmarks: centerLm(f.landmarks) }));
  if (rest) rest = centerLm(rest);

  // 3. 尺寸归一化到 MMD 骨骼比例 (~8.7)
  const c0 = frames[0].landmarks;
  const hipsY = (c0.hips || c0.spine || [0, 8.7, 0])[1];
  const lFootY = (c0.leftFoot || [0, 0, 0])[1];
  const rFootY = (c0.rightFoot || [0, 0, 0])[1];
  const legSpan = Math.max(0.01, hipsY - (lFootY + rFootY) * 0.5);
  const scaleFactor = legSpan < 2.0 || legSpan > 30.0 ? 8.7 / legSpan : 1.0;

  if (Math.abs(scaleFactor - 1.0) > 1e-4) {
    const scaleLm = (lm: Record<string, [number, number, number]>) => {
      const next: Record<string, [number, number, number]> = {};
      for (const [k, [x, y, z]] of Object.entries(lm)) {
        next[k] = roundVec3(x * scaleFactor, y * scaleFactor, z * scaleFactor);
      }
      return next;
    };
    frames = frames.map((f) => ({ ...f, landmarks: scaleLm(f.landmarks) }));
    if (rest) rest = scaleLm(rest);
  }

  const finalRest = rest || buildCanonicalTPoseRest(10.0);
  return { frames, restLandmarks: finalRest };
}

/* ============================================================================
 * 1. FBX 模型 / 骨骼动作解析器 (FBXLoader)
 * ============================================================================ */

async function parseFbxToFrames(buffer: ArrayBuffer): Promise<{
  frames: LandmarkFrame[];
  restLandmarks: Record<string, [number, number, number]>;
  fps: number;
}> {
  const loader = new FBXLoader();
  const fbx = loader.parse(buffer, '');

  let clip: THREE.AnimationClip | undefined;
  if (fbx.animations && fbx.animations.length > 0) {
    clip = fbx.animations[0];
  } else {
    // 递归寻找包含动画的子节点
    fbx.traverse((obj: any) => {
      if (!clip && obj.animations && obj.animations.length > 0) {
        clip = obj.animations[0];
      }
    });
  }

  if (!clip || clip.duration <= 0) {
    throw new Error('该 FBX 文件中未检测到有效的动画轨道 (Animation Track)');
  }

  const allBones: THREE.Bone[] = [];
  fbx.traverse((obj: THREE.Object3D) => {
    if ((obj as THREE.Bone).isBone) {
      allBones.push(obj as THREE.Bone);
    }
  });

  if (allBones.length === 0) {
    // 降级：如果不是标准 THREE.Bone，提取所有普通层级节点
    fbx.traverse((obj: THREE.Object3D) => {
      if (obj.children.length > 0 || obj.name) {
        allBones.push(obj as any);
      }
    });
  }

  const mappedBones: Array<{ bone: THREE.Bone; stdKey: string }> = [];
  const usedKeys = new Set<string>();

  for (const b of allBones) {
    const stdKey = mapExternalBoneName(b.name);
    if (stdKey && !usedKeys.has(stdKey)) {
      usedKeys.add(stdKey);
      mappedBones.push({ bone: b, stdKey });
    }
  }

  if (!usedKeys.has('hips') && !usedKeys.has('spine')) {
    throw new Error('FBX 中未能成功匹配到标准人体骨骼（未找到 Hips/Spine 节点）');
  }

  const fps = 30;
  const dt = 1 / fps;
  const totalFrames = Math.max(1, Math.floor(clip.duration * fps) + 1);

  const worldPos = new THREE.Vector3();
  const sampleSkeleton = (): Record<string, [number, number, number]> => {
    fbx.updateMatrixWorld(true);
    const lm: Record<string, [number, number, number]> = {};
    for (const { bone, stdKey } of mappedBones) {
      bone.getWorldPosition(worldPos);
      lm[stdKey] = roundVec3(worldPos.x, worldPos.y, worldPos.z);
    }
    return lm;
  };

  const restLandmarks = sampleSkeleton();

  const mixer = new THREE.AnimationMixer(fbx);
  const action = mixer.clipAction(clip);
  action.play();

  const frames: LandmarkFrame[] = [];
  for (let f = 0; f < totalFrames; f++) {
    mixer.setTime(Math.min(clip.duration, f * dt));
    frames.push({
      time: Number((f * dt).toFixed(3)),
      landmarks: sampleSkeleton(),
    });
  }

  mixer.stopAllAction();
  return { frames, restLandmarks, fps };
}

/* ============================================================================
 * 2. NumPy .npy 解析器 + MotionGPT3 / HumanML3D
 * ============================================================================ */

function float16ToFloat32(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / Math.pow(2, 10));
  if (e === 0x1f) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / Math.pow(2, 10));
}

function parseNpyBuffer(buffer: ArrayBuffer): { shape: number[]; data: Float32Array } {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (
    bytes.length < 10 ||
    bytes[0] !== 0x93 || bytes[1] !== 0x4e || bytes[2] !== 0x55 ||
    bytes[3] !== 0x4d || bytes[4] !== 0x50 || bytes[5] !== 0x59
  ) {
    throw new Error('无效的 .npy 文件：缺少 NUMPY 文件头');
  }

  const major = bytes[6];
  const headerLen = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const offset = major === 1 ? 10 : 12;
  const headerStr = new TextDecoder('latin1').decode(bytes.subarray(offset, offset + headerLen));
  const dataOffset = offset + headerLen;

  const descr = headerStr.match(/'descr'\s*:\s*'([^']+)'/)?.[1];
  // const fortranOrder = headerStr.match(/'fortran_order'\s*:\s*(True|False)/)?.[1] === 'True';
  const shape = headerStr
    .match(/'shape'\s*:\s*\(([^)]*)\)/)?.[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((n) => Number(n)) || [];

  if (!descr) throw new Error(`无法解析 .npy header: ${headerStr}`);

  const totalCount = shape.reduce((a, b) => a * b, 1);
  const littleEndian = descr[0] !== '>';
  const dtype = descr.slice(1);

  const flat = new Float32Array(totalCount);
  for (let i = 0; i < totalCount; i++) {
    switch (dtype) {
      case 'f4': flat[i] = view.getFloat32(dataOffset + i * 4, littleEndian); break;
      case 'f8': flat[i] = view.getFloat64(dataOffset + i * 8, littleEndian); break;
      case 'f2': flat[i] = float16ToFloat32(view.getUint16(dataOffset + i * 2, littleEndian)); break;
      case 'i4': flat[i] = view.getInt32(dataOffset + i * 4, littleEndian); break;
      case 'i2': flat[i] = view.getInt16(dataOffset + i * 2, littleEndian); break;
      case 'u1': flat[i] = bytes[dataOffset + i]; break;
      default: throw new Error(`不支持的 .npy 数据类型: ${descr}`);
    }
  }

  return { shape, data: flat };
}

function recoverFromRic263(data: Float32Array, numFrames: number, jointsNum = 22): Float32Array {
  const out = new Float32Array(numFrames * jointsNum * 3);
  const featDim = 263;

  let accAng = 0;
  let accX = 0;
  let accZ = 0;

  const qInv = new THREE.Quaternion();
  const v = new THREE.Vector3();

  for (let t = 0; t < numFrames; t++) {
    const base = t * featDim;
    const prevBase = (t - 1) * featDim;

    if (t > 0) accAng += data[prevBase + 0];
    qInv.set(0, -Math.sin(accAng), 0, Math.cos(accAng)).normalize();

    if (t > 0) {
      v.set(data[prevBase + 1], 0, data[prevBase + 2]).applyQuaternion(qInv);
      accX += v.x;
      accZ += v.z;
    }
    const rootY = data[base + 3];

    const outBase = t * jointsNum * 3;
    out[outBase + 0] = accX;
    out[outBase + 1] = rootY;
    out[outBase + 2] = accZ;

    for (let j = 1; j < jointsNum; j++) {
      const ricIdx = base + 4 + (j - 1) * 3;
      v.set(data[ricIdx], data[ricIdx + 1], data[ricIdx + 2]).applyQuaternion(qInv);
      out[outBase + j * 3 + 0] = v.x + accX;
      out[outBase + j * 3 + 1] = v.y;
      out[outBase + j * 3 + 2] = v.z + accZ;
    }
  }

  return out;
}

function parseNpyToFrames(buffer: ArrayBuffer): { frames: LandmarkFrame[]; fps: number } {
  const { shape, data } = parseNpyBuffer(buffer);
  const fps = 20;

  let numFrames = 0;
  let numJoints = 0;
  let jointsData: Float32Array;

  const s = shape.length >= 3 && shape[0] === 1 ? shape.slice(1) : shape;

  if (s.length === 2 && s[1] === 263) {
    numFrames = s[0];
    numJoints = 22;
    jointsData = recoverFromRic263(data, numFrames, 22);
  } else if (s.length === 2 && (s[1] === 66 || s[1] === 72)) {
    numFrames = s[0];
    numJoints = s[1] / 3;
    jointsData = data;
  } else if (s.length === 3 && s[2] === 3) {
    numFrames = s[0];
    numJoints = s[1];
    jointsData = data;
  } else {
    throw new Error(`暂不支持的 .npy 数组形状 [${shape.join(', ')}]，支持 (T, 22, 3) / (T, 263) / (T, 52, 3)`);
  }

  const mapping = numJoints === 21 ? KIT_21_MAPPING : SMPL_22_MAPPING;
  const frames: LandmarkFrame[] = [];

  for (let f = 0; f < numFrames; f++) {
    const landmarks: Record<string, [number, number, number]> = {};
    const fOff = f * numJoints * 3;

    const bodyLimit = Math.min(numJoints, mapping.length);
    for (let j = 0; j < bodyLimit; j++) {
      const key = mapping[j];
      if (!key) continue;
      landmarks[key] = roundVec3(
        jointsData[fOff + j * 3 + 0],
        jointsData[fOff + j * 3 + 1],
        jointsData[fOff + j * 3 + 2]
      );
    }

    if (numJoints === 52 || numJoints === 55) {
      const lStart = numJoints === 55 ? 25 : 22;
      const rStart = lStart + 15;
      SMPLX_LEFT_FINGERS.forEach((fName, idx) => {
        const j = lStart + idx;
        landmarks[fName] = roundVec3(
          jointsData[fOff + j * 3 + 0],
          jointsData[fOff + j * 3 + 1],
          jointsData[fOff + j * 3 + 2]
        );
      });
      SMPLX_RIGHT_FINGERS.forEach((fName, idx) => {
        const j = rStart + idx;
        landmarks[fName] = roundVec3(
          jointsData[fOff + j * 3 + 0],
          jointsData[fOff + j * 3 + 1],
          jointsData[fOff + j * 3 + 2]
        );
      });
    }

    frames.push({ time: Number((f / fps).toFixed(3)), landmarks });
  }

  return { frames, fps };
}

/* ============================================================================
 * 3. BVH 解析器 (BVHLoader)
 * ============================================================================ */

function parseBvhToFrames(text: string): {
  frames: LandmarkFrame[];
  restLandmarks: Record<string, [number, number, number]>;
  fps: number;
} {
  const loader = new BVHLoader();
  const { skeleton, clip } = loader.parse(text);
  if (!skeleton.bones.length || clip.duration <= 0) {
    throw new Error('BVH 文件解析失败：未发现有效骨骼或运动帧');
  }

  const ftMatch = text.match(/Frame Time:\s*([0-9.eE+-]+)/i);
  const rawFrameTime = ftMatch ? Number(ftMatch[1]) : 1 / 30;
  const rawFps = rawFrameTime > 0 ? Math.round(1 / rawFrameTime) : 30;
  const fps = rawFps > 60 ? 30 : Math.max(10, rawFps);
  const dt = 1 / fps;
  const totalFrames = Math.max(1, Math.floor(clip.duration * fps) + 1);

  const rootBone = skeleton.bones[0];
  const mappedBones: Array<{ bone: THREE.Bone; stdKey: string }> = [];
  const usedKeys = new Set<string>();

  for (const b of skeleton.bones) {
    const stdKey = mapExternalBoneName(b.name);
    if (stdKey && !usedKeys.has(stdKey)) {
      usedKeys.add(stdKey);
      mappedBones.push({ bone: b, stdKey });
    }
  }

  const worldPos = new THREE.Vector3();
  const sampleCurrentSkeleton = (): Record<string, [number, number, number]> => {
    rootBone.updateMatrixWorld(true);
    const lm: Record<string, [number, number, number]> = {};
    for (const { bone, stdKey } of mappedBones) {
      bone.getWorldPosition(worldPos);
      lm[stdKey] = roundVec3(worldPos.x, worldPos.y, worldPos.z);
    }
    return lm;
  };

  const restLandmarks = sampleCurrentSkeleton();
  const mixer = new THREE.AnimationMixer(rootBone);
  const action = mixer.clipAction(clip);
  action.play();

  const frames: LandmarkFrame[] = [];
  for (let f = 0; f < totalFrames; f++) {
    mixer.setTime(Math.min(clip.duration, f * dt));
    frames.push({
      time: Number((f * dt).toFixed(3)),
      landmarks: sampleCurrentSkeleton(),
    });
  }

  mixer.stopAllAction();
  return { frames, restLandmarks, fps };
}

/* ============================================================================
 * 4. 彻底解决 Unity .anim 偏移与骨骼匹配 (YAML 树状骨架重建)
 * ============================================================================ */

interface UnityKeyframe {
  time: number;
  values: Record<string, number>;
}

interface UnityCurve {
  kind: 'pos' | 'rot' | 'euler' | 'float';
  path: string;
  attribute: string;
  keyframes: UnityKeyframe[];
}

function parseBracedNumbers(str: string): Record<string, number> {
  const res: Record<string, number> = {};
  const inner = str.replace(/[{}]/g, '');
  inner.split(',').forEach((part) => {
    const [k, v] = part.split(':').map((s) => s.trim());
    if (k && v !== undefined && !isNaN(Number(v))) {
      res[k] = Number(v);
    }
  });
  return res;
}

function sampleUnityCurve(kfs: UnityKeyframe[], t: number, keys: string[]): number[] {
  if (kfs.length === 0) return keys.map(() => 0);
  if (t <= kfs[0].time) return keys.map((k) => kfs[0].values[k] ?? 0);
  if (t >= kfs[kfs.length - 1].time) return keys.map((k) => kfs[kfs.length - 1].values[k] ?? 0);

  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time;
      const alpha = span > 1e-6 ? (t - a.time) / span : 0;
      return keys.map((k) => {
        const va = a.values[k] ?? 0;
        const vb = b.values[k] ?? 0;
        return va + (vb - va) * alpha;
      });
    }
  }
  return keys.map((k) => kfs[0].values[k] ?? 0);
}

function parseUnityAnimYaml(text: string): {
  frames: LandmarkFrame[];
  restLandmarks?: Record<string, [number, number, number]>;
  fps: number;
} {
  if (!text.includes('AnimationClip:') && !text.includes('m_RotationCurves:') && !text.includes('m_FloatCurves:')) {
    throw new Error('仅支持文本格式的 Unity .anim (YAML)；如为二进制请在 Unity Editor 开启 Force Text 重新导出');
  }

  const lines = text.split(/\r?\n/);
  const curves: UnityCurve[] = [];
  let section: UnityCurve['kind'] | null = null;
  let currentCurve: UnityCurve | null = null;
  let currentKf: UnityKeyframe | null = null;
  let maxTime = 0;

  const flushKf = () => {
    if (currentCurve && currentKf) {
      currentCurve.keyframes.push(currentKf);
      if (currentKf.time > maxTime) maxTime = currentKf.time;
      currentKf = null;
    }
  };
  const flushCurve = () => {
    flushKf();
    if (currentCurve && currentCurve.keyframes.length > 0) {
      curves.push(currentCurve);
    }
    currentCurve = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('m_RotationCurves:')) {
      flushCurve();
      section = 'rot';
    } else if (line.startsWith('m_PositionCurves:')) {
      flushCurve();
      section = 'pos';
    } else if (line.startsWith('m_EulerCurves:')) {
      flushCurve();
      section = 'euler';
    } else if (line.startsWith('m_FloatCurves:')) {
      flushCurve();
      section = 'float';
    } else if (/^m_[A-Za-z]+:/.test(line) && !line.startsWith('m_Curve:') && !line.startsWith('m_PreInfinity') && !line.startsWith('m_PostInfinity')) {
      if (line.startsWith('m_ClipBindingConstant:') || line.startsWith('m_Events:')) {
        flushCurve();
        section = null;
      }
    }

    if (!section) continue;

    if (line.startsWith('- curve:')) {
      flushCurve();
      currentCurve = { kind: section, path: '', attribute: '', keyframes: [] };
      continue;
    }
    if (!currentCurve) continue;

    if (line.startsWith('time:')) {
      flushKf();
      currentKf = { time: Number(line.slice(5).trim()) || 0, values: {} };
    } else if (line.startsWith('value:') && currentKf) {
      const valStr = line.slice(6).trim();
      if (valStr.startsWith('{')) {
        currentKf.values = parseBracedNumbers(valStr);
      } else {
        currentKf.values = { v: Number(valStr) || 0 };
      }
    } else if (line.startsWith('path:')) {
      currentCurve.path = line.slice(5).trim();
    } else if (line.startsWith('attribute:')) {
      currentCurve.attribute = line.slice(10).trim();
    }
  }
  flushCurve();

  const fps = 30;
  const dt = 1 / fps;
  const totalFrames = Math.max(1, Math.floor(maxTime * fps) + 1);

  // 分支 A: Unity Humanoid Muscle
  const isHumanoidMuscle = curves.some(
    (c) => c.kind === 'float' && (c.attribute.startsWith('RootT.') || c.attribute.includes('Front-Back'))
  );

  if (isHumanoidMuscle) {
    const attrMap = new Map<string, UnityKeyframe[]>();
    curves.forEach((c) => {
      if (c.kind === 'float' && c.attribute) attrMap.set(c.attribute, c.keyframes);
    });
    const evalAttr = (name: string, t: number) => {
      const kfs = attrMap.get(name);
      return kfs ? sampleUnityCurve(kfs, t, ['v'])[0] : 0;
    };

    const bones = createHumanoidBoneHierarchy();
    const restQuats = new Map<string, THREE.Quaternion>();
    Object.entries(bones).forEach(([k, b]) => restQuats.set(k, b.quaternion.clone()));
    const deg = THREE.MathUtils.degToRad;
    const frames: LandmarkFrame[] = [];
    const wp = new THREE.Vector3();

    for (let f = 0; f < totalFrames; f++) {
      const t = f * dt;
      Object.entries(bones).forEach(([k, b]) => b.quaternion.copy(restQuats.get(k)!));

      // 修正 Unity 坐标到 Three.js: X 取反
      const rx = evalAttr('RootT.x', t);
      const ry = evalAttr('RootT.y', t) || 0.95;
      const rz = evalAttr('RootT.z', t);
      bones.hips.position.set(-rx, ry, rz);

      const qx = evalAttr('RootQ.x', t);
      const qy = evalAttr('RootQ.y', t);
      const qz = evalAttr('RootQ.z', t);
      const qw = evalAttr('RootQ.w', t) || 1;
      bones.hips.quaternion.set(-qx, qy, -qz, qw).normalize();

      bones.spine.rotation.set(deg(evalAttr('Spine Front-Back', t) * 40), deg(-evalAttr('Spine Twist Left-Right', t) * 40), deg(-evalAttr('Spine Left-Right', t) * 40));
      bones.chest.rotation.set(deg(evalAttr('Chest Front-Back', t) * 40), deg(-evalAttr('Chest Twist Left-Right', t) * 40), deg(-evalAttr('Chest Left-Right', t) * 40));
      bones.upperChest.rotation.set(deg(evalAttr('UpperChest Front-Back', t) * 25), deg(-evalAttr('UpperChest Twist Left-Right', t) * 25), deg(-evalAttr('UpperChest Left-Right', t) * 25));
      bones.neck.rotation.set(deg(evalAttr('Neck Nod Down-Up', t) * 35), deg(-evalAttr('Neck Turn Left-Right', t) * 35), deg(-evalAttr('Neck Tilt Left-Right', t) * 35));
      bones.head.rotation.set(deg(evalAttr('Head Nod Down-Up', t) * 35), deg(-evalAttr('Head Turn Left-Right', t) * 35), deg(-evalAttr('Head Tilt Left-Right', t) * 35));

      bones.leftUpperLeg.rotation.set(deg(-evalAttr('Left Upper Leg Front-Back', t) * 75), deg(evalAttr('Left Upper Leg Twist In-Out', t) * 45), deg(evalAttr('Left Upper Leg In-Out', t) * 45));
      bones.leftLowerLeg.rotation.set(deg((1 - evalAttr('Left Leg Stretch', t)) * 65), 0, 0);
      bones.leftFoot.rotation.set(deg(-evalAttr('Left Foot Up-Down', t) * 45), 0, deg(evalAttr('Left Foot Twist In-Out', t) * 30));

      bones.rightUpperLeg.rotation.set(deg(-evalAttr('Right Upper Leg Front-Back', t) * 75), deg(-evalAttr('Right Upper Leg Twist In-Out', t) * 45), deg(-evalAttr('Right Upper Leg In-Out', t) * 45));
      bones.rightLowerLeg.rotation.set(deg((1 - evalAttr('Right Leg Stretch', t)) * 65), 0, 0);
      bones.rightFoot.rotation.set(deg(-evalAttr('Right Foot Up-Down', t) * 45), 0, deg(-evalAttr('Right Foot Twist In-Out', t) * 30));

      bones.leftUpperArm.rotation.set(deg(evalAttr('Left Arm Front-Back', t) * 85), deg(-evalAttr('Left Arm Twist In-Out', t) * 60), deg(evalAttr('Left Arm Down-Up', t) * 85));
      bones.leftLowerArm.rotation.set(0, deg(-(1 - evalAttr('Left Forearm Stretch', t)) * 75), 0);
      bones.rightUpperArm.rotation.set(deg(evalAttr('Right Arm Front-Back', t) * 85), deg(evalAttr('Right Arm Twist In-Out', t) * 60), deg(-evalAttr('Right Arm Down-Up', t) * 85));
      bones.rightLowerArm.rotation.set(0, deg((1 - evalAttr('Right Forearm Stretch', t)) * 75), 0);

      bones.hips.updateMatrixWorld(true);
      const lm: Record<string, [number, number, number]> = {};
      STANDARD_BODY_BONES.forEach((bName) => {
        bones[bName].getWorldPosition(wp);
        lm[bName] = roundVec3(wp.x, wp.y, wp.z);
      });
      frames.push({ time: Number(t.toFixed(3)), landmarks: lm });
    }

    return { frames, fps };
  }

  // 分支 B: Unity Generic 层级骨骼路径动画
  const pathSet = new Set<string>();
  curves.forEach((c) => { if (c.path) pathSet.add(c.path); });

  const canonicalBones = createHumanoidBoneHierarchy();
  canonicalBones.hips.updateMatrixWorld(true);
  const nodeMap = new Map<string, THREE.Object3D>();
  const stdMap = new Map<string, string>();
  const rootGroup = new THREE.Group();

  const ensureNode = (path: string): THREE.Object3D => {
    if (nodeMap.has(path)) return nodeMap.get(path)!;
    const parts = path.split('/');
    const segName = parts[parts.length - 1];
    const obj = new THREE.Object3D();
    obj.name = segName;

    const stdKey = mapExternalBoneName(segName);
    if (stdKey && stdKey in canonicalBones) {
      stdMap.set(path, stdKey);
      // 赋予基础人体 T-Pose 局部相对位移，防止因缺少位置关键帧导致关节归零堆叠
      obj.position.copy((canonicalBones as any)[stdKey].position);
    }

    if (parts.length > 1) {
      const parent = ensureNode(parts.slice(0, -1).join('/'));
      parent.add(obj);
    } else {
      rootGroup.add(obj);
    }
    nodeMap.set(path, obj);
    return obj;
  };

  pathSet.forEach((p) => ensureNode(p));

  const curvesByPath = new Map<string, UnityCurve[]>();
  curves.forEach((c) => {
    if (!c.path) return;
    if (!curvesByPath.has(c.path)) curvesByPath.set(c.path, []);
    curvesByPath.get(c.path)!.push(c);
  });

  const frames: LandmarkFrame[] = [];
  const wp = new THREE.Vector3();
  const deg = THREE.MathUtils.degToRad;

  for (let f = 0; f < totalFrames; f++) {
    const t = f * dt;
    curvesByPath.forEach((pCurves, path) => {
      const node = nodeMap.get(path)!;
      for (const c of pCurves) {
        if (c.kind === 'pos') {
          const [x, y, z] = sampleUnityCurve(c.keyframes, t, ['x', 'y', 'z']);
          // Unity (左手系) -> Three.js (右手系): X 镜像取反
          node.position.set(-x, y, z);
        } else if (c.kind === 'rot') {
          const [x, y, z, w] = sampleUnityCurve(c.keyframes, t, ['x', 'y', 'z', 'w']);
          node.quaternion.set(-x, y, -z, w).normalize();
        } else if (c.kind === 'euler') {
          const [x, y, z] = sampleUnityCurve(c.keyframes, t, ['x', 'y', 'z']);
          node.rotation.set(deg(x), deg(-y), deg(-z), 'YXZ');
        }
      }
    });

    rootGroup.updateMatrixWorld(true);
    const lm: Record<string, [number, number, number]> = {};
    stdMap.forEach((stdKey, path) => {
      nodeMap.get(path)!.getWorldPosition(wp);
      lm[stdKey] = roundVec3(wp.x, wp.y, wp.z);
    });
    frames.push({ time: Number(t.toFixed(3)), landmarks: lm });
  }

  return { frames, fps };
}

/* ============================================================================
 * 5. JSON 点云格式支持
 * ============================================================================ */

function parseJsonPointCloud(text: string): {
  frames: LandmarkFrame[];
  restLandmarks?: Record<string, [number, number, number]>;
  fps: number;
} {
  const json = JSON.parse(text);
  if (json && Array.isArray(json.frames) && json.frames[0]?.landmarks) {
    return {
      frames: json.frames,
      restLandmarks: json.restLandmarks,
      fps: Number(json.fps) || 30,
    };
  }
  const seq = Array.isArray(json) ? json : Array.isArray(json?.joints) ? json.joints : null;
  if (seq && Array.isArray(seq[0]) && Array.isArray(seq[0][0])) {
    const fps = Number(json?.fps) || 20;
    const mapping = seq[0].length === 21 ? KIT_21_MAPPING : SMPL_22_MAPPING;
    const frames: LandmarkFrame[] = seq.map((framePts: number[][], fIdx: number) => {
      const lm: Record<string, [number, number, number]> = {};
      framePts.forEach((pt, jIdx) => {
        const key = mapping[jIdx];
        if (key && pt.length >= 3) lm[key] = roundVec3(pt[0], pt[1], pt[2]);
      });
      return { time: Number((fIdx / fps).toFixed(3)), landmarks: lm };
    });
    return { frames, fps };
  }
  throw new Error('无法识别的 JSON 点云结构');
}

/* ============================================================================
 * 统一对外入口
 * ============================================================================ */

export function isVmdFilename(input: File | File[] | string): boolean {
  if (Array.isArray(input)) {
    return input.length > 0 && input.every((f) => f.name.toLowerCase().endsWith('.vmd'));
  }
  const name = typeof input === 'string' ? input : input.name;
  return name.toLowerCase().endsWith('.vmd');
}

export async function bakePointCloudMotion(
  pmxInput: File | string,
  motionInput: File | File[] | string,
  onFrameRender?: BakerRenderCallback,
  extraFiles?: File[]
): Promise<PointCloudBakerResult> {
  // 如果传入的是数组（例如误拖入多个点云文件），取第一个有效文件
  const targetFile = Array.isArray(motionInput) ? motionInput[0] : motionInput;
  if (!targetFile) {
    throw new Error('未提供有效的动作文件');
  }

  const filename = (typeof targetFile === 'string' ? targetFile : targetFile.name).toLowerCase();

  let parsed: {
    frames: LandmarkFrame[];
    restLandmarks?: Record<string, [number, number, number]>;
    fps: number;
  };

  if (filename.endsWith('.fbx')) {
    const buf =
      typeof targetFile === 'string'
        ? await (await fetch(targetFile)).arrayBuffer()
        : await targetFile.arrayBuffer();
    parsed = await parseFbxToFrames(buf);
  } else if (filename.endsWith('.npy')) {
    const buf =
      typeof targetFile === 'string'
        ? await (await fetch(targetFile)).arrayBuffer()
        : await targetFile.arrayBuffer();
    parsed = parseNpyToFrames(buf);
  } else if (filename.endsWith('.bvh')) {
    const txt =
      typeof targetFile === 'string'
        ? await (await fetch(targetFile)).text()
        : await targetFile.text();
    parsed = parseBvhToFrames(txt);
  } else if (filename.endsWith('.anim')) {
    const txt =
      typeof targetFile === 'string'
        ? await (await fetch(targetFile)).text()
        : await targetFile.text();
    parsed = parseUnityAnimYaml(txt);
  } else if (filename.endsWith('.json')) {
    const txt =
      typeof targetFile === 'string'
        ? await (await fetch(targetFile)).text()
        : await targetFile.text();
    parsed = parseJsonPointCloud(txt);
  } else {
    throw new Error(`不支持的动作文件格式: ${filename}`);
  }

  const { frames, restLandmarks } = normalizePointCloudFrames(parsed.frames, parsed.restLandmarks);
  const mesh = await loadPmxMeshOnly(pmxInput, extraFiles);

  if (onFrameRender) {
    const step = Math.max(1, Math.floor(frames.length / 40));
    for (let i = 0; i < frames.length; i += step) {
      onFrameRender(mesh, frames[i].landmarks, Math.round((i / frames.length) * 100));
      await new Promise((r) => setTimeout(r, 12));
    }
    onFrameRender(mesh, frames[frames.length - 1].landmarks, 100);
  }

  const totalFrames = frames.length;
  const duration = totalFrames > 0 ? frames[totalFrames - 1].time : 0;

  return {
    landmarkData: {
      fps: parsed.fps,
      totalFrames,
      duration,
      frames,
      restLandmarks,
      availableMorphs: [],
    },
    mesh,
    animation: undefined,
  };
}
