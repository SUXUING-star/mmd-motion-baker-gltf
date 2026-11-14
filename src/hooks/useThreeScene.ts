// src/hooks/useThreeScene.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MMDAnimationHelper } from 'three/examples/jsm/animation/MMDAnimationHelper.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { resolveExpressionTarget } from '../types/expressionMapping';

interface BoneRestTransform {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: THREE.Vector3;
}

export type ViewMode = 'orbit' | 'camera';

// 统一相机默认站位配置（适配 MMD 角色整体身形与开阔舞台视野）
const DEFAULT_CAMERA_POS = new THREE.Vector3(0, 12, 34);
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 8, 0);

export function useThreeScene(containerRef: React.RefObject<HTMLDivElement | null>) {
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const helperCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraHelperRef = useRef<THREE.CameraHelper | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsGroupRef = useRef<THREE.Group | null>(null);
  const currentMeshRef = useRef<THREE.Object3D | null>(null);
  const mmdHelperRef = useRef<MMDAnimationHelper | null>(null);
  const restBonesRef = useRef<BoneRestTransform[]>([]);
  const viewModeRef = useRef<ViewMode>('camera');
  const [viewMode, setViewModeState] = useState<ViewMode>('camera');

  const sphereGeoRef = useRef<THREE.SphereGeometry>(new THREE.SphereGeometry(0.12, 8, 8));
  const pointMatRef = useRef<THREE.MeshBasicMaterial>(new THREE.MeshBasicMaterial({ color: 0xff0055, depthTest: false }));

  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = 380;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    sceneRef.current = scene;

    // 扩大相机远裁剪面至 1000，避免大网格在远处被裁切
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.copy(DEFAULT_CAMERA_POS);
    cameraRef.current = camera;

    // 创建自由轨道模式下显示的镜头视锥框 Helper
    const helperCamera = new THREE.PerspectiveCamera(45, width / height, 0.5, 40);
    helperCameraRef.current = helperCamera;
    const cameraHelper = new THREE.CameraHelper(helperCamera);
    cameraHelper.visible = false;
    scene.add(cameraHelper);
    cameraHelperRef.current = cameraHelper;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(DEFAULT_CAMERA_TARGET);
    controls.update();
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight1.position.set(15, 25, 20);
    scene.add(dirLight1);
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight2.position.set(-15, 15, -20);
    scene.add(dirLight2);

    // 将地板网格扩大至 100x100（50细分），留出足够宽敞的舞台空间感
    const gridHelper = new THREE.GridHelper(100, 50, 0x1677ff, 0xe5e7eb);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    const pointsGroup = new THREE.Group();
    pointsGroup.renderOrder = 999;
    scene.add(pointsGroup);
    pointsGroupRef.current = pointsGroup;

    let animId: number;
    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);
      renderer.render(scene, camera);
    };
    renderLoop();

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
      sphereGeoRef.current.dispose();
      pointMatRef.current.dispose();
    };
  }, [containerRef]);

  const setViewMode = useCallback((mode: ViewMode | 'mmd') => {
    const normalizedMode: ViewMode = mode === 'mmd' ? 'orbit' : mode;
    viewModeRef.current = normalizedMode;
    setViewModeState(normalizedMode);

    if (controlsRef.current) {
      controlsRef.current.enabled = normalizedMode === 'orbit';
    }
    if (cameraHelperRef.current) {
      cameraHelperRef.current.visible = normalizedMode === 'orbit';
    }
    if (normalizedMode === 'orbit' && cameraRef.current && controlsRef.current) {
      cameraRef.current.fov = 45;
      cameraRef.current.updateProjectionMatrix();
      cameraRef.current.position.copy(DEFAULT_CAMERA_POS);
      controlsRef.current.target.copy(DEFAULT_CAMERA_TARGET);
      controlsRef.current.update();
    }
  }, []);

  const setMmdCamera = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    if (cameraHelperRef.current) {
      cameraHelperRef.current.visible = false;
    }
    controlsRef.current.enabled = true;
    cameraRef.current.fov = 45;
    cameraRef.current.updateProjectionMatrix();
    cameraRef.current.position.copy(DEFAULT_CAMERA_POS);
    controlsRef.current.target.copy(DEFAULT_CAMERA_TARGET);
    controlsRef.current.update();
  }, []);

  const setCameraPose = useCallback(
    (
      pos: THREE.Vector3 | [number, number, number],
      quat: THREE.Quaternion | [number, number, number, number],
      fov?: number
    ) => {
      const p = Array.isArray(pos) ? new THREE.Vector3(pos[0], pos[1], pos[2]) : pos;
      const q = Array.isArray(quat)
        ? new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3])
        : quat;
      const currentFov = fov || 45;

      // 更新 Helper 镜头框
      if (helperCameraRef.current && cameraHelperRef.current) {
        helperCameraRef.current.position.copy(p);
        helperCameraRef.current.quaternion.copy(q);
        helperCameraRef.current.fov = currentFov;
        helperCameraRef.current.updateProjectionMatrix();
        cameraHelperRef.current.update();
      }

      // 如果处于【镜头透视】模式，把场景主相机定位到镜头姿态
      if (viewModeRef.current === 'camera' && cameraRef.current) {
        if (controlsRef.current) {
          controlsRef.current.enabled = false;
        }
        cameraRef.current.position.copy(p);
        cameraRef.current.quaternion.copy(q);
        cameraRef.current.fov = currentFov;
        cameraRef.current.updateProjectionMatrix();
      }
    },
    []
  );

  const clearPoints = useCallback(() => {
    if (pointsGroupRef.current) {
      pointsGroupRef.current.clear();
    }
  }, []);

  const clearCurrentMesh = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (mmdHelperRef.current && currentMeshRef.current && (currentMeshRef.current as THREE.SkinnedMesh).isSkinnedMesh) {
      const skinned = currentMeshRef.current as THREE.SkinnedMesh;
      if (mmdHelperRef.current.objects.has(skinned)) {
        mmdHelperRef.current.remove(skinned);
      }
    }
    mmdHelperRef.current = null;
    restBonesRef.current = [];

    if (currentMeshRef.current) {
      scene.remove(currentMeshRef.current);
      currentMeshRef.current = null;
    }
    clearPoints();
  }, [clearPoints]);

  const setupMmdAnimation = useCallback(
    (mesh: THREE.SkinnedMesh, animation?: THREE.AnimationClip) => {
      clearCurrentMesh();
      const scene = sceneRef.current;
      if (!scene) return;

      scene.add(mesh);
      currentMeshRef.current = mesh;

      restBonesRef.current = mesh.skeleton.bones.map((b) => ({
        pos: b.position.clone(),
        quat: b.quaternion.clone(),
        scale: b.scale.clone(),
      }));

      if (animation) {
        const helper = new MMDAnimationHelper({ afterglow: 0, resetPhysicsOnLoop: false });
        helper.add(mesh, { animation, physics: false, warmup: 0 });
        mmdHelperRef.current = helper;
      }
    },
    [clearCurrentMesh]
  );

  const renderLandmarksPositions = useCallback((landmarks: Record<string, [number, number, number]>) => {
    const pointsGroup = pointsGroupRef.current;
    if (!pointsGroup) return;

    const values = Object.values(landmarks);
    while (pointsGroup.children.length < values.length) {
      const sphere = new THREE.Mesh(sphereGeoRef.current, pointMatRef.current);
      pointsGroup.add(sphere);
    }
    while (pointsGroup.children.length > values.length) {
      pointsGroup.remove(pointsGroup.children[pointsGroup.children.length - 1]);
    }

    values.forEach(([x, y, z], i) => {
      pointsGroup.children[i].position.set(x, y, z);
    });
  }, []);

  const setMmdTime = useCallback(
    (
      time: number,
      landmarks?: Record<string, [number, number, number]>,
      blendTarget?: { startTime: number; weight: number },
      expressionsOverride?: Record<string, number>
    ) => {
      const curMesh = currentMeshRef.current as THREE.SkinnedMesh | null;
      const helper = mmdHelperRef.current;
      const entry = curMesh && helper ? helper.objects.get(curMesh) : undefined;

      if (curMesh && entry?.mixer) {
        const evaluatePoseAt = (t: number) => {
          restBonesRef.current.forEach((rest, idx) => {
            const bone = curMesh.skeleton.bones[idx];
            if (bone) {
              bone.position.copy(rest.pos);
              bone.quaternion.copy(rest.quat);
              bone.scale.copy(rest.scale);
            }
          });
          entry.mixer!.setTime(t);
          entry.ikSolver?.update();
          entry.grantSolver?.update();
          curMesh.updateMatrixWorld(true);
        };

        if (blendTarget && blendTarget.weight > 0) {
          const w = blendTarget.weight;
          evaluatePoseAt(time);

          if (curMesh.skeleton && curMesh.skeleton.bones.length > 0) {
            const curQuats = curMesh.skeleton.bones.map((b) => b.quaternion.clone());
            const curPositions = curMesh.skeleton.bones.map((b) => b.position.clone());

            evaluatePoseAt(blendTarget.startTime);

            curMesh.skeleton.bones.forEach((bone, idx) => {
              const targetQ = bone.quaternion.clone();
              const targetP = bone.position.clone();
              bone.quaternion.copy(curQuats[idx]).slerp(targetQ, w);
              bone.position.copy(curPositions[idx]).lerp(targetP, w);
            });
            curMesh.updateMatrixWorld(true);
          }
        } else {
          evaluatePoseAt(time);
        }

        // 将手调表情轨实时同步到 3D 模型面部 Morph 预览
        if (expressionsOverride && curMesh.morphTargetDictionary && curMesh.morphTargetInfluences) {
          const dict = curMesh.morphTargetDictionary;
          const influences = curMesh.morphTargetInfluences;
          for (const [rawName, index] of Object.entries(dict)) {
            const { key } = resolveExpressionTarget(rawName);
            if (Object.prototype.hasOwnProperty.call(expressionsOverride, rawName)) {
              influences[index] = Math.max(0, Math.min(1, expressionsOverride[rawName]));
            } else if (Object.prototype.hasOwnProperty.call(expressionsOverride, key)) {
              influences[index] = Math.max(0, Math.min(1, expressionsOverride[key]));
            }
          }
        }
      }

      if (landmarks) {
        renderLandmarksPositions(landmarks);
      }
    },
    [renderLandmarksPositions]
  );

  const updateLandmarks = useCallback(
    (mesh: THREE.Object3D, landmarks: Record<string, [number, number, number]>) => {
      const scene = sceneRef.current;
      if (!scene) return;

      if (currentMeshRef.current !== mesh) {
        if (currentMeshRef.current) scene.remove(currentMeshRef.current);
        scene.add(mesh);
        currentMeshRef.current = mesh;
      }

      renderLandmarksPositions(landmarks);
    },
    [renderLandmarksPositions]
  );

  return {
    viewMode,
    setViewMode,
    setMmdCamera,
    setCameraPose,
    clearCurrentMesh,
    clearPoints,
    setupMmdAnimation,
    setMmdTime,
    updateLandmarks,
    renderLandmarksPositions,
  };
}
