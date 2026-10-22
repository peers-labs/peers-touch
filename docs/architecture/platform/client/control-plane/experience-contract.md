# X Config - Experience Contract

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-10-17 | **Updated**: 2026-10-20
> **Owner**: Client Platform

---

## CCP-J01: Sign In And Inspect

1. Operator opens X Config Preview.
2. Signed-out state offers GitHub sign-in.
3. OAuth broker returns an audience-bound assertion.
4. X Config admits only the configured provider subject.
5. Console shows draft revision, latest publication state, endpoint/release
   inventory, and whether local edits differ.

Authentication failure creates no partial session. Operator-state failure
leaves a clear retry state; publication-repository failure does not erase local
edits.

## CCP-J02: Edit An Endpoint

1. Operator chooses Relay or Direct Station.
2. Operator imports typed connection material and metadata.
3. Direct Station additionally imports owner public consent.
4. Server validates origin, role, identity, consent, duplicates, and bounded
   availability.
5. Valid data enters the draft; invalid data preserves form input and exposes
   field/owner findings.

A successful network probe alone never establishes endpoint identity.

## CCP-J03: Edit A Release

1. Operator selects platform and architecture.
2. Operator enters version, minimum version, manifest URL/digest, signing key,
   release notes, and publication time.
3. Validation rejects invalid versions, URLs, digests, and duplicate targets.
4. Valid metadata enters the draft.

The console cannot upload or execute release artifacts.

## CCP-J04: Review And Publish

1. Operator opens the grouped draft diff.
2. Console validates the complete catalog.
3. Publish remains disabled until the source revision is current, the diff is
   non-empty, validation passes, and the operator acknowledges the exact diff.
4. Operator selects `Publish now`.
5. Service saves the draft if needed, allocates the next sequence through
   repository CAS, signs the exact statement, and commits metadata and envelope
   bytes atomically.
6. Console reports success with the new publication in history.
7. Public latest and immutable endpoints expose those persisted bytes.
8. Before expiry, the operator may explicitly republish unchanged reviewed
   content; it receives a higher sequence and fresh bounded lifetime.

There is no external approval or pending state. Failure preserves the draft;
a repository conflict requires reload and explicit re-review.

## CCP-J05: Restore Historical Content

1. Operator opens publication history.
2. Operator selects a historical source revision.
3. Console restores that catalog as a new draft against the current head.
4. Operator reviews and publishes it through the normal flow.
5. The resulting publication receives a higher sequence.

History is never rewritten and sequence never decreases.

## CCP-J06: Use A Suggested Endpoint

1. Client loads embedded and cached data without blocking launch.
2. Client refreshes `/channels/<channel>/latest.pb`.
3. Shared core verifies key, signature, channel, time, size, and sequence.
4. Station selector renders suggestions separately from verified Stations.
5. User selects a suggestion.
6. Station Access performs canonical signed endpoint discovery.
7. Only a verified route becomes a Station registry entry.

Cloud, signature, trust-material, or identity failure leaves the verified
registry and active Station unchanged.

## CCP-J07: Observe An Update

1. Client selects matching channel/platform/architecture metadata.
2. Expired or lower-sequence data is ignored.
3. Platform updater independently verifies manifest and artifact trust.
4. X Config never initiates installation.

## Cross-Session Contract

- Draft, publication history, sequence, and exact bytes survive Home service
  restart through GitHub.
- Login attempts, assertion consumption, sessions, and revocation survive Home
  service restart through the local operator database.
- Recreating the operator database signs the operator out and never changes
  publication truth.
- Browser session contains no GitHub App or signing key.
- Client last-known-good snapshot survives restart.
- Verified Stations survive catalog removal.
- Dismissed suggestion preference remains device-local.
