# Mobile Social Desktop Parity - Product State Model

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Mobile Product / Social Product

---

## 1. Navigation And Scope

```text
moments-tab(home|explore)
  -> inline(moment-thread)
  -> detail(profile|search|circles|moment-exception)
  -> overlay(composer|audience|reaction|media-preview|circle-edit|confirm)
```

| State | User meaning | Durable owner |
|---|---|---|
| `SOCIAL_HOME` | 读取当前 actor 的 receiver-scoped timeline | Station + Mobile projection |
| `SOCIAL_EXPLORE` | 读取 public timeline | Station + Mobile projection |
| `SOCIAL_THREAD_INLINE` | Feed 中展开的一个 Moment thread | Feed presentation state + runtime projection |
| `SOCIAL_DETAIL` | direct link、通知定位或阻断恢复的例外 Moment route | route identity + runtime projection |
| `SOCIAL_PROFILE` | 一个 canonical Actor 和 authored posts | route identity + Social projection |
| `SOCIAL_SEARCH` | Actor search task | route-local query + Social runtime |
| `SOCIAL_CIRCLES` | Publisher-private Circle management | Station Social |
| `SOCIAL_COMPOSER` | Device-local draft action surface | encrypted Mobile draft owner |

Mobile primary tab remains `on-visit + none`; route unmount never owns business freshness.

## 2. Feed States

| State | Visible meaning | Allowed actions | Forbidden behavior |
|---|---|---|---|
| `FEED_LOADING_FIRST` | first projection is loading | leave | cover an existing feed with a full mask |
| `FEED_READY` | verified current items | read, refresh, paginate, interact | infer trust from missing metadata |
| `FEED_REFRESHING` | existing items remain visible while reconciling | continue reading | reset scroll or blank the list |
| `FEED_EMPTY` | no visible content | compose, Explore, Search | present as error |
| `FEED_FILTERED_EMPTY` | current scope/filter has no result | change scope/filter | claim global emptiness |
| `FEED_POLICY_HIDDEN` | authority confirms hidden content | inspect reason, leave | infer hidden from a failed request |
| `FEED_STALE` | content may be behind authority | read verified cache, retry | enable sensitive writes |
| `FEED_SOURCE_UNAVAILABLE` | source cannot confirm new state | offline-read verified items, retry | fabricate latest state |
| `FEED_UNAVAILABLE` | runtime/module cannot supply projection | lifecycle retry, leave | show empty feed |
| `FEED_LOADING_MORE` | next page in progress | continue reading | duplicate rows or shift anchor |
| `FEED_LOAD_MORE_FAILED` | tail failed; current list valid | retry tail | replace entire feed with error |

## 3. Composer States

The canonical Social Core publish states apply. Mobile additionally owns:

| State | Visible meaning | Allowed actions |
|---|---|---|
| `COMPOSER_CLEAN` | no draft | close, type, choose media/audience |
| `COMPOSER_DIRTY` | device draft exists | edit, discard, continue |
| `AUDIENCE_SHEET_OPEN` | selecting canonical Audience | select, cancel |
| `TARGET_PICKER_OPEN` | selecting Circle/Group/Actors | search, select, cancel |
| `MEDIA_PICKING` | native picker active | cancel |
| `MEDIA_STAGING` | opaque media is encrypted/uploading | edit text, remove/cancel item |
| `DRAFT_SAVE_FAILED` | current edit is not safely durable | retry save, keep editing, discard |
| `PUBLISH_UNKNOWN_OUTCOME` | request may have committed | check status, keep draft |

`CHECKING_PRIVATE_READINESS`, `CHECKING_REMOTE_READINESS`, `READY_PRIVATE`,
`RECIPIENT_KEY_UNAVAILABLE`, `AUDIENCE_TOO_LARGE`, `REMOTE_DELIVERY_PENDING`,
`REMOTE_DELIVERY_RETRYING`, `PUBLISHED` and `PUBLISH_FAILED` preserve their Social Core meaning.

## 4. Moment Read And Private States

| State | Mobile presentation |
|---|---|
| `LOADING_AUTHORIZED_RESOURCE` | Feed 内固定几何 skeleton；例外 Detail route 使用同一占位 |
| `WAITING_FOR_PRIVATE_KEY` | inline trust notice with bounded retry/recovery |
| `WAITING_FOR_REMOTE_DELIVERY` | tied to known Post identity 的 inline placeholder |
| `REMOTE_SOURCE_UNAVAILABLE` | verified cached content remains; new actions disabled |
| `RECOVERY_REQUIRED` | blocking recovery surface with Back and Recover |
| `RECOVERY_KEY_UNAVAILABLE` | retry/report surface; no Station-decrypt suggestion |
| `DECRYPTING` | fixed media/text geometry; no partial plaintext |
| `CONTENT_READY` | continuous Feed item + optional inline comment thread |
| `AUTHENTICATION_REQUIRED` | return to Station-scoped access gate |
| `NOT_FOUND_OR_NOT_AUTHORIZED` | uniform unavailable detail |
| `INTEGRITY_FAILURE` | blocking integrity state; retry download/report |
| `DELETED_OR_REVOKED` | terminal state and ordinary cache cleanup |

## 5. Interaction States

### Reaction

```text
REACTION_IDLE
  -> REACTION_PENDING
     -> REACTION_COMMITTED
     -> REACTION_UNKNOWN
     -> REACTION_FAILED_ROLLBACK

REACTION_UNKNOWN -> REACTION_RECONCILING -> committed|retryable|terminal|unknown
```

Only the reaction group is disabled. Retry reuses the same command identity where the original may
have committed.

### Comment

- `COMMENT_EDITING`
- `COMMENT_ENCRYPTING`
- `COMMENT_SUBMITTING`
- `COMMENT_REMOTE_PENDING`
- `COMMENT_REMOTE_RETRYING`
- `COMMENT_UNKNOWN`
- `COMMENT_POSTED`
- `COMMENT_FAILED`
- `COMMENT_RATE_LIMITED`
- `COMMENT_PARENT_UNAVAILABLE`

Every non-success state preserves the text until explicit discard.

### Media

- `MEDIA_PLACEHOLDER`
- `MEDIA_GRANT_PENDING`
- `MEDIA_DOWNLOADING`
- `MEDIA_DECRYPTING`
- `MEDIA_READY`
- `MEDIA_ACCESS_DENIED`
- `MEDIA_INTEGRITY_FAILURE`
- `MEDIA_OFFLINE_RETRYABLE`

Media geometry is stable across all states.

## 6. Circle And Search States

| Surface | States |
|---|---|
| Search | `idle`, `typing`, `loading`, `results`, `no-result`, `remote-unavailable`, `hidden`, `failed` |
| Profile | `loading`, `ready`, `relationship-pending`, `blocked`, `unavailable`, `failed` |
| Circles | `loading`, `empty`, `ready`, `saving`, `conflict`, `failed` |
| Member picker | `loading`, `results`, `no-result`, `selection-dirty`, `saving`, `failed` |

## 7. State Invariants

1. `CONTENT_READY` requires current actor/device authorization, integrity verification and local decrypt.
2. public/private states never auto-fallback into each other.
3. `unknown` never means failed and never authorizes blind replay.
4. policy state comes from Station projection, not missing data.
5. route/tab unmount cannot erase runtime truth or safely persisted draft state.
6. account/Station generation change invalidates every plaintext projection before new scope render.
7. pending remote delivery is shown only after durable source admission.
8. Mobile Web receives verified plaintext projection, never root/private key material.
9. iOS and Android use the same state names and transitions even when controls differ.
10. 普通 Feed 的 Comment preview/composer 不创建 route，也不重置滚动锚点。
11. 图片/视频查看层是 `on-visit + none` 临时 overlay，关闭后恢复触发元素与 Feed anchor。
12. 每条 Moment 默认投影最多 10 条 Comment；更多 Comment 折叠且同一时间只展开一组，
    composer 仅在用户明确点击后挂载。
