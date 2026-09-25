import type { MobileRuntimeContext } from '../app/lifecycle/types';

export interface RuntimeSessionTransition {
  readonly previous: Promise<void>;
  readonly context: MobileRuntimeContext;
  readonly isScopeCurrent: () => boolean;
  readonly run: (isCurrent: () => boolean) => Promise<void>;
  readonly onError: (error: unknown) => void;
}

/** Allocate readiness at admission, not when a queued task eventually starts. */
export function runRuntimeSessionTransition({
  previous,
  context,
  isScopeCurrent,
  run,
  onError,
}: RuntimeSessionTransition): Promise<void> {
  const update = context.beginReadinessUpdate();
  const isCurrent = () => update.isCurrent() && isScopeCurrent();
  return previous.then(async () => {
    if (!isCurrent()) return;
    try {
      if (!await update.waitForDependencies() || !isCurrent()) return;
      await run(isCurrent);
      if (isCurrent()) update.ready();
    } catch (error) {
      if (!isCurrent()) return;
      update.fail(error);
      onError(error);
      throw error;
    }
  });
}
