// src/hooks/useMmdPipeline/useMmdFiles.ts
import { useCallback, useMemo, useState } from 'react';
import { inspectVmdFile, VmdFileSummary, VmdTrackRole } from '../../utils/vmdMerger';

const ROLE_ORDER: Record<VmdTrackRole, number> = {
  motion: 0,
  motion_face: 1,
  face: 2,
  face_lip: 3,
  lip: 4,
  camera: 5,
  empty: 6,
};

function isMorphOnlyRole(role: VmdTrackRole): boolean {
  return role === 'face' || role === 'lip' || role === 'face_lip';
}

function isComplementary(existing: VmdFileSummary[], incoming: VmdFileSummary): boolean {
  if (existing.length === 0) return false;
  const existingHasBone = existing.some((e) => e.boneCount > 0);
  const incomingHasBone = incoming.boneCount > 0;

  // 动作 + 纯表情/口型 互补 -> 自动合并
  if (existingHasBone && !incomingHasBone && incoming.morphCount > 0) return true;
  if (!existingHasBone && incomingHasBone) return true;

  // 纯表情 + 纯口型 互补 -> 自动合并
  if (
    existing.every((e) => isMorphOnlyRole(e.role)) &&
    isMorphOnlyRole(incoming.role) &&
    existing.every((e) => e.role !== incoming.role)
  ) {
    return true;
  }

  return false;
}

export function useMmdFiles(defaultPmxPath: string, defaultVmdPath: string) {
  const [customPmxFile, setCustomPmxFile] = useState<File | null>(null);
  const [customExtraFiles, setCustomExtraFiles] = useState<File[]>([]);
  const [vmdEntries, setVmdEntries] = useState<VmdFileSummary[]>([]);
  const [nonVmdMotionFile, setNonVmdMotionFile] = useState<File | null>(null);
  const [skippedCameraNames, setSkippedCameraNames] = useState<string[]>([]);
  const [changeVersion, setChangeVersion] = useState<number>(0);

  const activePmxTarget = useMemo(
    () => customPmxFile || defaultPmxPath,
    [customPmxFile, defaultPmxPath]
  );

  const vmdFile = useMemo(
    () => nonVmdMotionFile ?? vmdEntries[0]?.file ?? null,
    [nonVmdMotionFile, vmdEntries]
  );

  const activeVmdTarget = useMemo<File | File[] | string>(() => {
    if (nonVmdMotionFile) return nonVmdMotionFile;
    if (vmdEntries.length > 0) return vmdEntries.map((e) => e.file);
    return defaultVmdPath;
  }, [nonVmdMotionFile, vmdEntries, defaultVmdPath]);

  const selectPmx = useCallback((file: File | null, extraFiles: File[] = []) => {
    setCustomPmxFile(file);
    setCustomExtraFiles(extraFiles);
    setChangeVersion((v) => v + 1);
  }, []);

  const selectMotionFiles = useCallback(
    async (
      files: File[],
      bakeTargetType: 'motion' | 'camera' = 'motion',
      mode: 'auto' | 'replace' | 'append' = 'auto'
    ) => {
      if (!files || files.length === 0) return;

      const vmdCandidates = files.filter((f) => f.name.toLowerCase().endsWith('.vmd'));
      const otherMotion = files.find((f) => !f.name.toLowerCase().endsWith('.vmd'));

      // 非 VMD 格式（FBX / NPY / BVH / ANIM / JSON）
      if (bakeTargetType === 'motion' && vmdCandidates.length === 0 && otherMotion) {
        setNonVmdMotionFile(otherMotion);
        setVmdEntries([]);
        setSkippedCameraNames([]);
        setChangeVersion((v) => v + 1);
        return;
      }

      if (vmdCandidates.length === 0) return;

      const inspected = await Promise.all(vmdCandidates.map((f) => inspectVmdFile(f)));

      // 镜头模式：自动挑选含镜头帧的 VMD
      if (bakeTargetType === 'camera') {
        const camEntry =
          inspected.find((e) => e.cameraCount > 0) || inspected[0];
        setNonVmdMotionFile(null);
        setVmdEntries([camEntry]);
        setSkippedCameraNames([]);
        setChangeVersion((v) => v + 1);
        return;
      }

      // 动作模式：自动识别并过滤纯镜头 VMD
      const motionCapable = inspected.filter(
        (e) => e.boneCount > 0 || e.morphCount > 0
      );
      const pureCamera = inspected.filter(
        (e) => e.boneCount === 0 && e.morphCount === 0 && e.cameraCount > 0
      );
      setSkippedCameraNames(pureCamera.map((c) => c.name));

      const validList = motionCapable.length > 0 ? motionCapable : inspected;
      const sortEntries = (list: VmdFileSummary[]) =>
        [...list].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);

      setNonVmdMotionFile(null);
      setVmdEntries((prev) => {
        if (mode === 'replace' || (mode === 'auto' && validList.length > 1)) {
          return sortEntries(validList);
        }

        const single = validList[0];
        if (mode === 'append' || isComplementary(prev, single)) {
          const withoutDup = prev.filter((e) => e.name !== single.name);
          return sortEntries([...withoutDup, single]);
        }

        return sortEntries([single]);
      });
      setChangeVersion((v) => v + 1);
    },
    []
  );

  const selectVmd = useCallback(
    (file: File) => {
      void selectMotionFiles([file], 'motion', 'auto');
    },
    [selectMotionFiles]
  );

  const removeVmdEntry = useCallback((index: number) => {
    setVmdEntries((prev) => prev.filter((_, i) => i !== index));
    setChangeVersion((v) => v + 1);
  }, []);

  const clearVmdFiles = useCallback(() => {
    setVmdEntries([]);
    setNonVmdMotionFile(null);
    setSkippedCameraNames([]);
    setChangeVersion((v) => v + 1);
  }, []);

  const resetPmx = useCallback(() => {
    setCustomPmxFile(null);
    setCustomExtraFiles([]);
    setChangeVersion((v) => v + 1);
  }, []);

  const resetAllToDefault = useCallback(() => {
    setCustomPmxFile(null);
    setCustomExtraFiles([]);
    setVmdEntries([]);
    setNonVmdMotionFile(null);
    setSkippedCameraNames([]);
  }, []);

  const getBaseFilename = useCallback(() => {
    if (nonVmdMotionFile) {
      return nonVmdMotionFile.name.replace(/\.[^/.]+$/, '');
    }
    if (vmdEntries.length > 0) {
      const primary =
        [...vmdEntries].sort((a, b) => b.boneCount - a.boneCount)[0] || vmdEntries[0];
      return primary.name.replace(/\.[^/.]+$/, '');
    }
    return defaultVmdPath.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'motion';
  }, [nonVmdMotionFile, vmdEntries, defaultVmdPath]);

  return {
    customPmxFile,
    vmdFile,
    vmdEntries,
    nonVmdMotionFile,
    skippedCameraNames,
    activePmxTarget,
    activeVmdTarget,
    customExtraFiles,
    changeVersion,
    selectPmx,
    selectVmd,
    selectMotionFiles,
    removeVmdEntry,
    clearVmdFiles,
    resetPmx,
    resetAllToDefault,
    getBaseFilename,
  };
}
