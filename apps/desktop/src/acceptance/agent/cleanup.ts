export interface AcceptanceCleanupStep {
  name: string;
  run: () => Promise<void>;
}

export interface AcceptanceCleanupFailure {
  name: string;
  error: unknown;
}

export async function runAcceptanceCleanupSteps(
  steps: readonly AcceptanceCleanupStep[],
): Promise<AcceptanceCleanupFailure[]> {
  const failures: AcceptanceCleanupFailure[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      failures.push({ name: step.name, error });
    }
  }
  return failures;
}
