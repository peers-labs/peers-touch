import {
  Profiler,
  memo,
  useEffect,
  useState,
  type ProfilerOnRenderCallback,
  type ReactElement,
} from 'react';

import { recordHiddenSurfaceRender, recordReactCommit, recordSurfaceRender } from './frontendRuntimeProfiler';
import { SectionActivityProvider } from './SectionActivityContext';
import { nextMountedSectionIds, shouldRenderSection, type SectionDescriptor } from './section';

interface SectionHostProps {
  readonly activeSectionId: string;
  readonly descriptors: readonly SectionDescriptor[];
  readonly highlightId?: string;
  readonly initialMountedSectionIds?: readonly string[];
  readonly surfacePrefix?: string;
}

export function SectionHost({
  activeSectionId,
  descriptors,
  highlightId,
  initialMountedSectionIds = [],
  surfacePrefix = 'section',
}: SectionHostProps): ReactElement {
  const [mountedSectionIds, setMountedSectionIds] = useState<ReadonlySet<string>>(
    () => new Set(initialMountedSectionIds),
  );

  useEffect(() => {
    const active = descriptors.find((descriptor) => descriptor.id === activeSectionId);
    setMountedSectionIds((prev) => {
      const next = nextMountedSectionIds(active, prev);
      return next === prev ? prev : next;
    });
  }, [activeSectionId, descriptors]);

  return (
    <>
      {descriptors.map((descriptor) => {
        const isActive = descriptor.id === activeSectionId;
        if (!shouldRenderSection(descriptor, activeSectionId, mountedSectionIds)) return null;
        return (
          <SectionFrame
            key={descriptor.id}
            descriptor={descriptor}
            highlightId={isActive ? highlightId : undefined}
            isActive={isActive}
            surfaceId={`${surfacePrefix}:${descriptor.id}`}
          />
        );
      })}
    </>
  );
}

const SectionFrame = memo(function SectionFrame({
  descriptor,
  highlightId,
  isActive,
  surfaceId,
}: {
  readonly descriptor: SectionDescriptor;
  readonly highlightId?: string;
  readonly isActive: boolean;
  readonly surfaceId: string;
}): ReactElement {
  useEffect(() => {
    if (!isActive) {
      recordHiddenSurfaceRender(surfaceId, { sectionId: descriptor.id });
    }
  });

  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const content = descriptor.render({ active: isActive, highlightId, sectionId: descriptor.id });
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  recordSurfaceRender(surfaceId, ms, { sectionId: descriptor.id });
  const owner = `section-frame:${surfaceId}`;
  const onRender: ProfilerOnRenderCallback = (
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    recordReactCommit({
      actualDuration,
      baseDuration,
      commitTime,
      data: { active: isActive, sectionId: descriptor.id, surface: 'section-frame', surfaceId },
      id,
      owner,
      phase,
      source: 'shell',
      startTime,
    });
  };

  const frame = (
    <div
      data-pt-section-host={descriptor.id}
      data-section-host-id={descriptor.id}
      style={{
        contentVisibility: isActive ? 'visible' : 'hidden',
        display: isActive ? 'block' : 'none',
        height: '100%',
      }}
    >
      <SectionActivityProvider active={isActive} sectionId={descriptor.id} surfaceId={surfaceId}>
        {content}
      </SectionActivityProvider>
    </div>
  );
  if (!import.meta.env.DEV) return frame;
  return (
    <Profiler id={owner} onRender={onRender}>
      {frame}
    </Profiler>
  );
});
