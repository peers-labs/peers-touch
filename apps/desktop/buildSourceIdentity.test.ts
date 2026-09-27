import { describe, expect, it } from 'vitest'

import { projectedBuildSourceCommit } from './buildSourceIdentity'

describe('Desktop build source identity', () => {
  it('uses the validated runtime source projection', () => {
    expect(
      projectedBuildSourceCommit({
        PT_BUILD_SOURCE_COMMIT: 'a'.repeat(40),
      }),
    ).toBe('a'.repeat(40))
  })

  it('rejects an invalid runtime source projection', () => {
    expect(() =>
      projectedBuildSourceCommit({
        PT_BUILD_SOURCE_COMMIT: 'not-a-commit',
      }),
    ).toThrow(
      'PT_BUILD_SOURCE_COMMIT must be a lowercase 40-character Git commit',
    )
  })

  it('leaves ordinary builds on the Git-derived source', () => {
    expect(projectedBuildSourceCommit({})).toBeUndefined()
  })
})
