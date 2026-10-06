# Mobile Social Desktop Parity - Capability Ledger

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Mobile Product / Social Product

---

## 1. Ledger Rule

Desktop 当前 source-bound Social 产品是 parity reference，不是需要复制的页面实现。
`adopt` 保留用户结果，`adapt` 保留语义并采用 Mobile 原生交互，`exclude` 表示 Desktop
专属或当前不可用能力不进入 parity claim。

## 2. Desktop Capability Disposition

| Desktop behavior | Evidence | Disposition | Mobile closure |
|---|---|---|---|
| Home feed | `MomentsFeedPage.tsx`, `store/moments.ts` | adopt | 接入 public/private receiver projection，保留 refresh/pagination/reconcile |
| Explore public feed and sort | `MomentsExplorePage.tsx` | adapt | Home/Explore 顶部分段控件；sort 使用 Mobile sheet |
| Actor search | `UserSearchPage.tsx`, discovery store | adapt | 全屏 Search route，区分 no-result/remote-unavailable/permission |
| User profile and authored posts | `MomentsUserPage.tsx`, `UserProfileHeader.tsx` | adapt | 全屏 Profile route，保留 source/relationship/follow context |
| Follow/unfollow | `FollowButton.tsx`, relationships store | adopt | Profile action group；pending/rollback 由 relationship projection 驱动 |
| Circle list/create/rename/delete | `CircleManagePage.tsx` | adapt | Circles full-screen list + edit/member BottomSheet |
| Circle member add/remove/search | `CircleManagePage.tsx` | adapt | 大名单全屏 picker，保留 canonical actor identity |
| `PUBLIC` Audience | `AudiencePicker.tsx` | adopt | composer sheet |
| `FOLLOWERS` Audience | `AudiencePicker.tsx` | adopt | 必须显示“关注者”，不得翻译为好友 |
| `FRIENDS` Audience | `AudiencePicker.tsx` | adopt | composer sheet |
| `CIRCLE` Audience | `AudiencePicker.tsx` | adapt | Audience sheet -> Circle picker |
| `GROUP` Audience | `AudiencePicker.tsx` | adapt | Audience sheet -> canonical Conversation picker |
| `CUSTOM_ALLOW` | `AudiencePicker.tsx` | adapt | Audience sheet -> Actor multi-select |
| `CUSTOM_DENY(FOLLOWERS)` | `AudiencePicker.tsx` | adapt | base 固定为 FOLLOWERS，排除名单全屏选择 |
| `SELF` Audience | `AudiencePicker.tsx` | adopt | composer sheet |
| Text composer and durable draft | `MomentComposer.tsx` | adopt | 复用 Mobile encrypted draft owner |
| Image upload up to nine | Desktop/Mobile composers | adapt | native picker + opaque staged handle；固定 geometry |
| Text/image rendering | `MomentCard.tsx`, `PrivateMediaGrid.tsx` | adopt | public/private 共用一个内容 rail；图片使用稳定占位和临时查看层 |
| Video rendering | `MomentCard.tsx`, `PrivateMediaGrid.tsx` | adapt | Mobile 临时媒体层；创建入口只在 canonical capability 可用时出现 |
| Link rendering | `MomentCard.tsx` private link surface | adapt | 可信标题/URL 摘要；创建入口只在 canonical capability 可用时出现 |
| Poll rendering | `MomentCard.tsx` private poll surface | adapt | 问题与选项连续呈现；投票/创建只在 canonical capability 可用时出现 |
| Location rendering | `MomentCard.tsx` private location surface | adapt | 名称/地址为内容的一部分；地图/创建只在 canonical capability 可用时出现 |
| Repost rendering | `MomentCard.tsx` public/private repost surface | adopt | 保留 source Post/author identity；创建只在 canonical capability 可用时出现 |
| Private media preparation | Desktop composer + Secure Content | adopt | 现有 Mobile Rust secure-content engine |
| Post publish readiness | Desktop `momentsRuntime.ts` | adopt | private readiness/remote readiness 来自 Native projection |
| Detail/direct-link read | `MomentDetailPage.tsx` | adapt | 普通阅读留在 Feed；direct link/通知/阻断恢复才使用 descriptor exception route |
| Five reactions/unreact | `ReactionBar.tsx`, `SocialActionBar.tsx` | adapt | anchored picker or BottomSheet；local rollback |
| Public comments/replies/delete | `CommentList.tsx` | adapt | Feed 内一次展开一个连续 thread；不切换 route |
| Private comments/replies | private comment runtime | adapt | 接入同一 inline thread，不走 public fallback |
| Private reaction pending/retry | private reaction runtime + action surface | adopt | 补 Mobile Native port 和 visible state |
| Private media open/decrypt | `PrivateMediaGrid.tsx` | adapt | 临时 overlay；ciphertext download/decrypt stays Rust-owned |
| Waiting/recovery/integrity UI | `SocialPrivateState.tsx` | adapt | inline trust surface or full-screen recovery by severity |
| Remote pending/retrying | Desktop private projections | adopt | composer item/status detail localizes durable delivery state |
| Remote source unavailable | Social product state contract | adopt | verified cached content readable；new actions disabled with retry |
| Author delete | `deletePost`, Social lifecycle events | adapt | Feed card action sheet + confirmation；authoritative tombstone 后关闭读取/互动/恢复 |
| Profile block/unblock | `FollowButton`, Social relationship authority | adapt | Profile danger group；pending/readback 与 unavailable/blocked 明确区分 |
| Delete/revoke/block invalidation | `momentsRuntime.ts` events | adopt | clear ordinary cache and close writes; no false remote-delete claim |
| Share button placeholder | Desktop/Mobile disabled action | exclude | 不把 disabled placeholder 计入 parity |
| Desktop hover/popover | Desktop UI adaptation | exclude | Mobile 使用 tap/long-press/BottomSheet |
| Desktop P2P path | Desktop runtime capability | exclude | Mobile 使用 Station/Relay only |

## 3. Current Mobile Foundation

| Foundation | Source evidence | Assessment |
|---|---|---|
| Public feed/detail/pagination | `momentsFeedStore.ts`, `MomentsPage.tsx` | reusable |
| Public comment/reply/delete | `momentsGateway.ts`, `MomentCommentsSection.tsx` | reusable |
| Reaction optimistic rollback | `momentsFeedStore.ts`, `MomentFeedItem.tsx` | reusable |
| Native media staging + draft restoration | `MomentComposer.tsx`, `useMomentsDraft.ts` | reusable |
| Actor profile and federated people search | `socialStore.ts`, `profileGateway.ts`, `ContactsPage.tsx` | reusable |
| Private publish/read/media/comment/recovery | `privateMomentsRuntime.ts`, `src-tauri/src/social/` | reusable but not integrated into product UI |
| Runtime lifecycle/readiness | Mobile runtime registry + Private Social descriptor | reusable |
| Full Audience UI and intent | only public/followers/self in Mobile composer | missing |
| Explore/Search/Profile/Circles Social routes | no Moments-owned Mobile routes | missing |
| Private Reaction UI/port | Desktop only | missing |
| Cross-Station delivery/revocation UI | no unified Mobile projection | missing |
| iOS+Android+Desktop interop proof | current Mobile plan same-Station/iOS-centric | missing |

## 4. Parity Exclusions

- Browser Social.
- Desktop windowing, hover-only affordances, tray, shell and P2P mechanics.
- Station Dashboard moderation administration.
- Any Desktop control that is disabled, placeholder-only, or not backed by canonical capability.
- Pixel identity across Desktop/iOS/Android.

These exclusions do not reduce user-result parity.
