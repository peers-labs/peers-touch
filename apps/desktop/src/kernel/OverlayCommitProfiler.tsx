import {
  Profiler,
  type ProfilerOnRenderCallback,
  type ReactElement,
  type ReactNode,
} from 'react';

import { recordReactCommit } from './frontendRuntimeProfiler';

interface OverlayCommitProfilerProps {
  readonly children: ReactNode;
  readonly owner: string;
  readonly surface: string;
}

export function OverlayCommitProfiler({
  children,
  owner,
  surface,
}: OverlayCommitProfilerProps): ReactElement {
  if (!import.meta.env.DEV) return <>{children}</>;
  const profilerId = `overlay-host:${owner}`;
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
      data: { surface },
      id,
      owner,
      phase,
      source: 'overlay',
      startTime,
    });
  };
  return (
    <Profiler id={profilerId} onRender={onRender}>
      {children}
    </Profiler>
  );
}
