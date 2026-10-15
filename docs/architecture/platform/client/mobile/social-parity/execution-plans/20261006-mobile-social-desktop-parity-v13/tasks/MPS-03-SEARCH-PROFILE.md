# MPS-03-SEARCH-PROFILE - Social Search And Profile

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-03-SEARCH-PROFILE",
  "workstreamId": "MPS-MOBILE-SOCIAL",
  "title": "Add descriptor-owned Social Search and Profile routes with canonical identity and relationship state",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "mps-search-profile",
  "journeyId": "MSP-J02-J08",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/app/navigation",
    "apps/mobile/src/features/social",
    "apps/mobile/src/pages/moments",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop",
    "apps/station",
    "docs/architecture/domains/social/core",
    "docs/architecture/platform/client/mobile/social-parity"
  ],
  "budgets": {
    "focusedCheckSeconds": 1500,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "mps-search-profile-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/app/navigation src/features/social/socialPeopleSearch.test.ts src/features/social/socialStore.profileSessionFence.test.ts src/pages/moments",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mps-search-profile-ux",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-search-profile-native",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "doneWhen": [
    "Search resolves local and remote Actors to canonical PTIDs without URL or display-name identity",
    "Profile shows authored content and follow, unfollow and block mutations complete only after authoritative relationship readback",
    "An eligible friend can enter the existing canonical message journey without Social creating a conversation owner",
    "Search and Profile routes hide the bottom tab and restore the exact query, result position, feed scope, focus and scroll on back",
    "Block, unblock, follow and unfollow invalidate affected profile and feed projections",
    "Malformed handle, no active Federation, remote unavailable, hidden discoverability and permission denial remain distinct accessible states"
  ],
  "failureBehavior": [
    "Do not make selection state or route params a business truth owner",
    "Do not infer friend, block or follow state from content visibility",
    "Do not duplicate Desktop stores or call a remote Station directly"
  ],
  "updatedAt": "2026-10-06T10:11:00.000Z"
}
```

## Objective

补齐 Mobile 可进入的 Social 人员发现与身份上下文，并保持 navigation descriptor
只拥有 presentation state。

## Current Snapshot

- Mobile contains people-search and profile projection primitives.
- Moments has no complete Search/Profile route family.
- Remote profile, authored-post and relationship results are not joined into one Social experience.
