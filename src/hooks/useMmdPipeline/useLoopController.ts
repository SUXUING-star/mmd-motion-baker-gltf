import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LandmarkData } from '../../types/types';
import {
    applyLoopSegmentToLandmarkData,
    findLoopCandidates,
    LoopCandidate,
    LoopRegionConfig,
} from '../../utils/motionTrimmer';
import { TimelineController } from './useTimelinePlayback';

export interface LoopController {
  candidates: LoopCandidate[];
  region: LoopRegionConfig | null;
  isBaked: boolean;
  bridgeFrames: number;
  findCandidates: () => void;
  selectCandidate: (c: LoopCandidate) => void;
  updateRegion: (region: LoopRegionConfig | null) => void;
  applyToTimeline: () => void;
  restoreRaw: () => void;
}

interface UseLoopControllerParams {
  rawLandmarkDataRef: RefObject<LandmarkData | null>;
  sessionVersion: number;
  playback: {
    timeline: TimelineController;
    startFrame: number;
    endFrame: number;
    updateTimelineData: (data: LandmarkData) => void;
  };
}

export function useLoopController({
  rawLandmarkDataRef,
  sessionVersion,
  playback,
}: UseLoopControllerParams) {
  const [candidates, setCandidates] = useState<LoopCandidate[]>([]);
  const [region, setRegion] = useState<LoopRegionConfig | null>(null);
  const [isBaked, setIsBaked] = useState<boolean>(false);

  const stitchedLandmarkDataRef = useRef<LandmarkData | null>(null);
  const stitchedSessionRef = useRef<number>(sessionVersion);
  const sessionVersionRef = useRef<number>(sessionVersion);
  sessionVersionRef.current = sessionVersion;
  const isBakedRef = useRef<boolean>(false);

  useEffect(() => {
    stitchedLandmarkDataRef.current = null;
    isBakedRef.current = false;
    setCandidates([]);
    setRegion(null);
    setIsBaked(false);
  }, [sessionVersion]);

  useEffect(() => {
    if (!isBaked && region) {
      if (region.startFrame !== playback.startFrame || region.endFrame !== playback.endFrame) {
        setRegion((prev) =>
          prev
            ? {
                ...prev,
                startFrame: playback.startFrame,
                endFrame: playback.endFrame,
              }
            : null
        );
      }
    }
  }, [isBaked, region, playback.startFrame, playback.endFrame]);

  const { timeline, updateTimelineData } = playback;

  const findCandidates = useCallback(() => {
    const src = rawLandmarkDataRef.current;
    if (!src) return;
    setCandidates(findLoopCandidates(src));
  }, [rawLandmarkDataRef]);

  const selectCandidate = useCallback(
    (c: LoopCandidate) => {
      const raw = rawLandmarkDataRef.current;
      if (raw && isBaked) {
        stitchedLandmarkDataRef.current = null;
        isBakedRef.current = false;
        setIsBaked(false);
        updateTimelineData(raw);
      }

      setRegion({
        startFrame: c.startFrame,
        endFrame: c.endFrame,
        blendDuration: 0.35,
        inPlace: true,
      });
      timeline.setStart(c.startFrame);
      timeline.setEnd(c.endFrame);
    },
    [rawLandmarkDataRef, isBaked, updateTimelineData, timeline]
  );

  const updateRegion = useCallback(
    (nextRegion: LoopRegionConfig | null) => {
      if (nextRegion === null && isBaked && rawLandmarkDataRef.current) {
        stitchedLandmarkDataRef.current = null;
        isBakedRef.current = false;
        setIsBaked(false);
        updateTimelineData(rawLandmarkDataRef.current);
      }
      setRegion(nextRegion);
    },
    [isBaked, rawLandmarkDataRef, updateTimelineData]
  );

  const applyToTimeline = useCallback(() => {
    const raw = rawLandmarkDataRef.current;
    if (!raw || !region) return;

    const stitched = applyLoopSegmentToLandmarkData(
      raw,
      region.startFrame,
      region.endFrame,
      region.blendDuration,
      region.inPlace
    );
    stitchedLandmarkDataRef.current = stitched;
    stitchedSessionRef.current = sessionVersionRef.current;
    isBakedRef.current = true;
    setIsBaked(true);
    updateTimelineData(stitched);
  }, [rawLandmarkDataRef, region, updateTimelineData]);

  const restoreRaw = useCallback(() => {
    const raw = rawLandmarkDataRef.current;
    if (!raw) return;

    stitchedLandmarkDataRef.current = null;
    isBakedRef.current = false;
    setIsBaked(false);
    updateTimelineData(raw);
    if (region) {
      timeline.setStart(region.startFrame);
      timeline.setEnd(region.endFrame);
    }
  }, [rawLandmarkDataRef, region, updateTimelineData, timeline]);

  const getActiveLandmarkData = useCallback((): LandmarkData | null => {
    if (
      isBakedRef.current &&
      stitchedSessionRef.current === sessionVersionRef.current &&
      stitchedLandmarkDataRef.current
    ) {
      return stitchedLandmarkDataRef.current;
    }
    return rawLandmarkDataRef.current;
  }, [rawLandmarkDataRef]);

  const fps = timeline.fps || 30;
  const bridgeFrames = isBaked
    ? stitchedLandmarkDataRef.current?.loopBridgeFrames || 0
    : region && region.endFrame - region.startFrame >= 6
    ? Math.max(
        3,
        Math.min(
          Math.max(2, Math.floor((region.endFrame - region.startFrame) * 0.45)),
          Math.round(region.blendDuration * fps)
        )
      )
    : 0;

  const loop: LoopController = useMemo(
    () => ({
      candidates,
      region,
      isBaked,
      bridgeFrames,
      findCandidates,
      selectCandidate,
      updateRegion,
      applyToTimeline,
      restoreRaw,
    }),
    [
      candidates,
      region,
      isBaked,
      bridgeFrames,
      findCandidates,
      selectCandidate,
      updateRegion,
      applyToTimeline,
      restoreRaw,
    ]
  );

  return {
    loop,
    loopRegion: region,
    isLoopBaked: isBaked,
    getActiveLandmarkData,
  };
}
