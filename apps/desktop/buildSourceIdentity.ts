const GIT_COMMIT = /^[0-9a-f]{40}$/

export function projectedBuildSourceCommit(
  environment: NodeJS.ProcessEnv,
): string | undefined {
  const sourceCommit = environment.PT_BUILD_SOURCE_COMMIT
  if (sourceCommit !== undefined && !GIT_COMMIT.test(sourceCommit)) {
    throw new Error(
      'PT_BUILD_SOURCE_COMMIT must be a lowercase 40-character Git commit',
    )
  }
  return sourceCommit
}
