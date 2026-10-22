# X Config - Product And Architecture Review

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-10-18 | **Updated**: 2026-10-20
> **Owner**: Client Platform

---

## Target

Review the current single-Home-service X Config architecture and its Preview
delivery. This is findings-first review; runtime claims require current-source
evidence.

## Product Questions

1. Can the operator edit, validate, inspect exact diff, publish, inspect
   history, and restore without losing a draft?
2. Is direct publication explicit, synchronous, and free of obsolete approval
   waiting?
3. Can clients use suggestions without replacing verified Station state?
4. Are failure, expiry, consent, and rollback states honest?
5. Are Production and native UI proof boundaries explicit?

## Architecture Questions

1. Is Home `peers-x-config` the only X Config runtime?
2. Does one Git CAS transaction own sequence, metadata, and envelope bytes?
3. Do Git writes stay under X Config catalog/publication paths, with no active
   `x-config/admin-auth/` mutation?
4. Are OAuth provider credentials still owned by the broker?
5. Does Home SQLite atomically own attempt/assertion/session/revocation state
   without a memory or Git fallback?
6. Are browser credentials and signing keys absent?
7. Do latest and immutable reads return persisted exact bytes?
8. Do Desktop and Mobile use one client URL contract and shared verifier?
9. Are Vercel X Config entrypoints, independent data/ledger repositories,
   publisher CLI, approval state, and distribution project fully removed?
10. Does the env repository remain the only placement/runtime source?
11. Are destructive cloud removals delayed until the Home Preview passes and
    receives separate authorization?

## Verdict Contract

Return findings with source locations and owner. Separate source checks,
runtime observations, inference, and unproven scope. Do not infer Production or
native UI proof from Preview API evidence.
