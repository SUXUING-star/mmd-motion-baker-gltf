import { useCallback, useMemo, useState } from 'react';

export function useMmdFiles(defaultPmxPath: string, defaultVmdPath: string) {
  const [customPmxFile, setCustomPmxFile] = useState<File | null>(null);
  const [customExtraFiles, setCustomExtraFiles] = useState<File[]>([]);
  const [vmdFile, setVmdFile] = useState<File | null>(null);
  const [changeVersion, setChangeVersion] = useState<number>(0);

  const activePmxTarget = useMemo(
    () => customPmxFile || defaultPmxPath,
    [customPmxFile, defaultPmxPath]
  );
  const activeVmdTarget = useMemo(
    () => vmdFile || defaultVmdPath,
    [vmdFile, defaultVmdPath]
  );

  const selectPmx = useCallback((file: File | null, extraFiles: File[] = []) => {
    setCustomPmxFile(file);
    setCustomExtraFiles(extraFiles);
    setChangeVersion((v) => v + 1);
  }, []);

  const selectVmd = useCallback((file: File) => {
    setVmdFile(file);
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
    setVmdFile(null);
  }, []);

  const getBaseFilename = useCallback(() => {
    return typeof activeVmdTarget === 'string'
      ? activeVmdTarget.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'motion'
      : activeVmdTarget.name.replace(/\.[^/.]+$/, '');
  }, [activeVmdTarget]);

  return {
    customPmxFile,
    vmdFile,
    activePmxTarget,
    activeVmdTarget,
    customExtraFiles,
    changeVersion,
    selectPmx,
    selectVmd,
    resetPmx,
    resetAllToDefault,
    getBaseFilename,
  };
}
