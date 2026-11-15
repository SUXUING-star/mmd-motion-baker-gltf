// src/utils/motionExporter.ts
import type { VRMCVRMAnimation } from '@pixiv/types-vrmc-vrm-animation-1.0';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { HUMANOID_BONES, HumanoidBoneName } from '../types/boneMapping';
import { isPresetExpression } from '../types/expressionMapping';
import { LandmarkData } from '../types/types';
import { solveAllHumanoidQuaternions } from './mathSolver';

/** VRMA 元数据配置接口 */
export interface VrmaMetaOptions {
  title?: string;
  authors?: string[];
  copyrightInformation?: string;
  licenseUrl?: string;
}

export interface ExpressionNodeBinding {
  node: THREE.Object3D;
  expressionName: string;
  isPreset: boolean;
}

/**
 * 1. 构建符合 VRM 1.0 / Humanoid 规范的 52 根 T-Pose 骨骼与父子层级
 */
export function createHumanoidBoneHierarchy(): Record<HumanoidBoneName, THREE.Bone> {
  const bones: Record<HumanoidBoneName, THREE.Bone> = {} as Record<HumanoidBoneName, THREE.Bone>;

  HUMANOID_BONES.forEach((name) => {
    bones[name] = new THREE.Bone();
    bones[name].name = name;
  });

  // T-Pose 骨骼基准局部偏移
  bones.hips.position.set(0, 0.95, 0);
  bones.spine.position.set(0, 0.12, 0);
  bones.chest.position.set(0, 0.14, 0);
  bones.upperChest.position.set(0, 0.12, 0);
  bones.neck.position.set(0, 0.10, 0);
  bones.head.position.set(0, 0.12, 0);

  bones.leftShoulder.position.set(0.08, 0.04, 0);
  bones.leftUpperArm.position.set(0.12, 0, 0);
  bones.leftLowerArm.position.set(0.24, 0, 0);
  bones.leftHand.position.set(0.22, 0, 0);

  bones.rightShoulder.position.set(-0.08, 0.04, 0);
  bones.rightUpperArm.position.set(-0.12, 0, 0);
  bones.rightLowerArm.position.set(-0.24, 0, 0);
  bones.rightHand.position.set(-0.22, 0, 0);

  bones.leftUpperLeg.position.set(0.1, -0.05, 0);
  bones.leftLowerLeg.position.set(0, -0.42, 0);
  bones.leftFoot.position.set(0, -0.40, 0);
  bones.leftToes.position.set(0, -0.05, 0.14);

  bones.rightUpperLeg.position.set(-0.1, -0.05, 0);
  bones.rightLowerLeg.position.set(0, -0.42, 0);
  bones.rightFoot.position.set(0, -0.40, 0);
  bones.rightToes.position.set(0, -0.05, 0.14);

  // 躯干与头部
  bones.hips.add(bones.spine);
  bones.spine.add(bones.chest);
  bones.chest.add(bones.upperChest);
  bones.upperChest.add(bones.neck);
  bones.neck.add(bones.head);

  // 双腿
  bones.hips.add(bones.leftUpperLeg);
  bones.leftUpperLeg.add(bones.leftLowerLeg);
  bones.leftLowerLeg.add(bones.leftFoot);
  bones.leftFoot.add(bones.leftToes);

  bones.hips.add(bones.rightUpperLeg);
  bones.rightUpperLeg.add(bones.rightLowerLeg);
  bones.rightLowerLeg.add(bones.rightFoot);
  bones.rightFoot.add(bones.rightToes);

  // 双臂
  bones.upperChest.add(bones.leftShoulder);
  bones.leftShoulder.add(bones.leftUpperArm);
  bones.leftUpperArm.add(bones.leftLowerArm);
  bones.leftLowerArm.add(bones.leftHand);

  bones.upperChest.add(bones.rightShoulder);
  bones.rightShoulder.add(bones.rightUpperArm);
  bones.rightUpperArm.add(bones.rightLowerArm);
  bones.rightLowerArm.add(bones.rightHand);

  // 手指 30 节骨骼
  const fingerList = HUMANOID_BONES.filter(
    (b) => b.includes('Thumb') || b.includes('Index') || b.includes('Middle') || b.includes('Ring') || b.includes('Little')
  );
  fingerList.forEach((f) => bones[f].position.set(f.startsWith('left') ? 0.03 : -0.03, 0, 0));

  bones.leftHand.add(bones.leftThumbMetacarpal);
  bones.leftThumbMetacarpal.add(bones.leftThumbProximal);
  bones.leftThumbProximal.add(bones.leftThumbDistal);
  bones.leftHand.add(bones.leftIndexProximal);
  bones.leftIndexProximal.add(bones.leftIndexIntermediate);
  bones.leftIndexIntermediate.add(bones.leftIndexDistal);
  bones.leftHand.add(bones.leftMiddleProximal);
  bones.leftMiddleProximal.add(bones.leftMiddleIntermediate);
  bones.leftMiddleIntermediate.add(bones.leftMiddleDistal);
  bones.leftHand.add(bones.leftRingProximal);
  bones.leftRingProximal.add(bones.leftRingIntermediate);
  bones.leftRingIntermediate.add(bones.leftRingDistal);
  bones.leftHand.add(bones.leftLittleProximal);
  bones.leftLittleProximal.add(bones.leftLittleIntermediate);
  bones.leftLittleIntermediate.add(bones.leftLittleDistal);

  bones.rightHand.add(bones.rightThumbMetacarpal);
  bones.rightThumbMetacarpal.add(bones.rightThumbProximal);
  bones.rightThumbProximal.add(bones.rightThumbDistal);
  bones.rightHand.add(bones.rightIndexProximal);
  bones.rightIndexProximal.add(bones.rightIndexIntermediate);
  bones.rightIndexIntermediate.add(bones.rightIndexDistal);
  bones.rightHand.add(bones.rightMiddleProximal);
  bones.rightMiddleProximal.add(bones.rightMiddleIntermediate);
  bones.rightMiddleIntermediate.add(bones.rightMiddleDistal);
  bones.rightHand.add(bones.rightRingProximal);
  bones.rightRingProximal.add(bones.rightRingIntermediate);
  bones.rightRingIntermediate.add(bones.rightRingDistal);
  bones.rightHand.add(bones.rightLittleProximal);
  bones.rightLittleProximal.add(bones.rightLittleIntermediate);
  bones.rightLittleIntermediate.add(bones.rightLittleDistal);

  return bones;
}

/**
 * 2. 求解全部 52 根骨骼四元数并构建 AnimationClip，同时返回时间轴数组供表情轨道复用
 */
export function buildHumanoidAnimationClipWithTimes(
  json: LandmarkData,
  clipName: string
): { clip: THREE.AnimationClip; times: number[] } {
  const { times, hipsPositions, quatTracksData } = solveAllHumanoidQuaternions(json);

  const tracks: THREE.KeyframeTrack[] = [
    new THREE.VectorKeyframeTrack('hips.position', times, hipsPositions),
    ...HUMANOID_BONES.map((name) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quatTracksData[name])),
  ];

  const duration = times[times.length - 1] || 0;
  return {
    clip: new THREE.AnimationClip(clipName, duration, tracks),
    times,
  };
}

/**
 * 3. 求解全部 52 根骨骼四元数并构建 AnimationClip
 */
export function buildHumanoidAnimationClip(
  json: LandmarkData,
  clipName: string
): THREE.AnimationClip {
  return buildHumanoidAnimationClipWithTimes(json, clipName).clip;
}

/**
 * 4. 为存在有效动画的表情创建 VRMA 节点与 position.x 权重轨道
 */
export function buildVrmaExpressionTracks(
  json: LandmarkData,
  times: number[],
  presetOnly: boolean = true
): {
  bindings: ExpressionNodeBinding[];
  tracks: THREE.KeyframeTrack[];
} {
  const frames = json.frames;
  if (!frames.length || times.length !== frames.length) {
    return { bindings: [], tracks: [] };
  }

  const activeNames = new Set<string>();
  for (const frame of frames) {
    if (!frame.expressions) continue;
    for (const [name, weight] of Object.entries(frame.expressions)) {
      if (weight > 1e-4 && (!presetOnly || isPresetExpression(name))) {
        activeNames.add(name);
      }
    }
  }

  const bindings: ExpressionNodeBinding[] = [];
  const tracks: THREE.KeyframeTrack[] = [];
  const totalFrames = frames.length;

  Array.from(activeNames).forEach((exprName, idx) => {
    const node = new THREE.Object3D();
    node.name = `vrma_expr_${idx}`;

    const positions = new Float32Array(totalFrames * 3);

    for (let i = 0; i < totalFrames; i++) {
      const w = frames[i].expressions?.[exprName] ?? 0;
      positions[i * 3 + 0] = Math.max(0, Math.min(1, w));
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
    }

    bindings.push({
      node,
      expressionName: exprName,
      isPreset: isPresetExpression(exprName),
    });
    tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`, times, positions));
  });

  return { bindings, tracks };
}

/**
 * 5. 通用 GLTF/GLB 二进制导出封装
 */
export function exportSceneToBinaryGltf(
  scene: THREE.Scene,
  clip: THREE.AnimationClip,
  configureExporter?: (exporter: GLTFExporter) => void
): Promise<Blob> {
  const exporter = new GLTFExporter();
  configureExporter?.(exporter);

  return new Promise<Blob>((resolve, reject) => {
    exporter.parse(
      scene,
      (gltf) => resolve(new Blob([gltf as ArrayBuffer], { type: 'model/gltf-binary' })),
      (err) => reject(err),
      { binary: true, animations: [clip] }
    );
  });
}

/**
 * 6. 导出符合 Pixiv 官方 VRMC_vrm_animation 1.0 规范的纯动作文件 (.vrma，含骨骼 + 表情)
 */
export async function exportFull52VRMA(
  json: LandmarkData,
  metaOptions?: VrmaMetaOptions
): Promise<Blob> {
  const scene = new THREE.Scene();
  const bones = createHumanoidBoneHierarchy();
  scene.add(bones.hips);

  const { clip, times } = buildHumanoidAnimationClipWithTimes(json, 'VRMAnimation');
  const { bindings: exprBindings, tracks: exprTracks } = buildVrmaExpressionTracks(json, times);

  exprBindings.forEach((b) => scene.add(b.node));
  if (exprTracks.length > 0) {
    clip.tracks.push(...exprTracks);
  }

  return exportSceneToBinaryGltf(scene, clip, (exporter) => {
    exporter.register((writer: any) => ({
      name: 'VRMC_vrm_animation',
      afterParse: () => {
        const humanBones: Record<string, { node: number }> = {};
        HUMANOID_BONES.forEach((name) => {
          const bone = bones[name];
          const nodeIndex = bone ? writer.nodeMap.get(bone) : undefined;
          if (nodeIndex !== undefined) {
            humanBones[name] = { node: nodeIndex };
          }
        });

        const presetExpressions: Record<string, { node: number }> = {};
        const customExpressions: Record<string, { node: number }> = {};
        exprBindings.forEach(({ node, expressionName, isPreset }) => {
          const nodeIndex = writer.nodeMap.get(node);
          if (nodeIndex === undefined) return;
          if (isPreset) {
            presetExpressions[expressionName] = { node: nodeIndex };
          } else {
            customExpressions[expressionName] = { node: nodeIndex };
          }
        });

        const hasPreset = Object.keys(presetExpressions).length > 0;
        const hasCustom = Object.keys(customExpressions).length > 0;

        const vrmcAnimation: VRMCVRMAnimation = {
          specVersion: '1.0',
          humanoid: {
            humanBones: humanBones as any,
          },
          ...(hasPreset || hasCustom
            ? {
                expressions: {
                  ...(hasPreset ? { preset: presetExpressions as any } : {}),
                  ...(hasCustom ? { custom: customExpressions } : {}),
                },
              }
            : {}),
        };

        const gltfJson = writer.json;

        gltfJson.asset = gltfJson.asset || {};
        gltfJson.asset.generator = 'MMD-to-Humanoid Solver (Pixiv VRMC_vrm_animation 1.0)';
        gltfJson.asset.extras = {
          title: metaOptions?.title?.trim() || 'Untitled VRMA Motion',
          authors: metaOptions?.authors && metaOptions.authors.length > 0 ? metaOptions.authors : ['Unknown'],
          copyrightInformation: metaOptions?.copyrightInformation?.trim() || '',
          licenseUrl: metaOptions?.licenseUrl?.trim() || 'https://vrm.dev/licenses/1.0/',
        };

        gltfJson.extensions = gltfJson.extensions || {};
        gltfJson.extensions['VRMC_vrm_animation'] = vrmcAnimation;

        gltfJson.extensionsUsed = gltfJson.extensionsUsed || [];
        if (!gltfJson.extensionsUsed.includes('VRMC_vrm_animation')) {
          gltfJson.extensionsUsed.push('VRMC_vrm_animation');
        }
      },
    }));
  });
}

/**
 * 7. 导出 52 根标准骨骼 Humanoid GLB 格式
 */
export async function exportFull52HumanoidGLB(json: LandmarkData): Promise<Blob> {
  const scene = new THREE.Scene();
  const bones = createHumanoidBoneHierarchy();

  const boneArray = HUMANOID_BONES.map((n) => bones[n]);
  const skeleton = new THREE.Skeleton(boneArray);
  const dummyGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const posCount = dummyGeometry.attributes.position.count;

  const skinIndices = new Uint16Array(posCount * 4);
  const skinWeights = new Float32Array(posCount * 4);
  for (let i = 0; i < posCount; i++) {
    skinIndices[i * 4 + 0] = 0;
    skinIndices[i * 4 + 1] = 1;
    skinIndices[i * 4 + 2] = 2;
    skinIndices[i * 4 + 3] = 3;
    skinWeights[i * 4 + 0] = 1.0;
  }

  dummyGeometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  dummyGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  const skinnedMesh = new THREE.SkinnedMesh(dummyGeometry, new THREE.MeshStandardMaterial({ color: 0x007acc }));
  skinnedMesh.add(bones.hips);
  skinnedMesh.bind(skeleton);
  scene.add(skinnedMesh);

  const clip = buildHumanoidAnimationClip(json, 'MMD_Pointcloud_Pure_Solved');

  return exportSceneToBinaryGltf(scene, clip);
}
