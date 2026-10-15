# Mobile Social Desktop Parity - Product Definition

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Mobile Product / Social Product
> **Module**: `apps/mobile/`

---

## 1. Product Thesis

### Target users

- 已在 Desktop 使用 Social，需要在手机上继续浏览、发布、互动和恢复私密内容的用户。
- 需要在同一 Federation 内跨 Station 与好友分享 private Moment 的 iOS/Android 用户。
- 需要在移动场景明确控制关注者、好友、Circle、Group、自定义名单和仅自己可见的用户。

### Excluded users

- 需要 Browser Social、跨 Federation private sharing 或 Station Dashboard 管理能力的用户。
- 需要 DRM、防截图或远程删除接收者已保存副本的内容发行者。
- 把 Mobile 当成 Social 业务 authority、P2P 节点或离线 Station 的场景。

### Product promise

> 用户在 Mobile 上可以完成 Desktop Social 的全部用户结果，并获得相同的 Audience、
> 授权、加密、跨 Station、恢复、删除和 Block 语义；Mobile 以 Feed 内联互动、
> 临时媒体查看层、BottomSheet、触控和安全区适配完成任务，不复制 Desktop 页面布局。

首个有用结果是：Alice 在 iOS 选择 `FRIENDS` 发布文本和图片，Station B 的 Bob 在
Android Home feed 中读取并互动；Eve 即使获得对象 ID 也不能读取。持续价值是同一用户
可以在 Desktop、iOS 和 Android 之间切换，仍看到一致的 public/private/cross-Station
结果和可恢复状态。

## 2. Meaning Of 100% Parity

`100% parity` 必须同时满足：

1. **Capability parity**：Desktop 当前可进入的 Social 用户路径均有 Mobile 入口。
2. **Semantic parity**：Audience、权限、关系、删除、Block、Recovery 和跨 Station 结果一致。
3. **State parity**：等待、失败、unknown outcome、重试、恢复和撤销不会被 Mobile 隐藏。
4. **Interoperability parity**：Desktop 发布/Mobile 读取和 Mobile 发布/Desktop 读取双向成立。
5. **Evidence parity**：Mobile 使用真实 Native、真实 Station/OSS 和 receiver readback 证明。

以下不属于 parity：

- 像素、导航 chrome、popover 位置和 hover 行为完全一致；
- Desktop 专属窗口、托盘、P2P 或文件系统能力；
- Desktop UI 中不可用、禁用或仅占位的未来能力。

## 3. Capability Profile

| ID | Capability | Class | Product claim |
|---|---|---|---|
| `MSP-C01` | Social scope navigation | required | Home、Explore、Search、Circles 和 User Profile 可进入并返回原上下文；普通 Moment 阅读不切换页面 |
| `MSP-C02` | Home feed | required | public/private、local/remote 内容在一个 receiver-scoped feed 中分页、刷新和 reconcile |
| `MSP-C03` | Explore public feed | required | public timeline 支持 Desktop 已有 sort 语义、详情和互动 |
| `MSP-C04` | Search and profile | required | 搜索 Actor，打开本地/远端 Profile、作者内容、关系和 follow/block 状态 |
| `MSP-C05` | Circles and audience | required | 创建、重命名、删除 Circle，管理成员，并选择全部八类 Audience |
| `MSP-C06` | Composer and media | required | text/image/video/link/poll/repost/location rendering scope 与 Desktop contract 一致；当前可创建类型按 canonical capability 启用 |
| `MSP-C07` | Moment thread, comments, replies | required | Feed 默认展示最多 10 条 Comment，更多折叠；public/private reply、delete、pagination、draft preservation 和 parent-unavailable 一致 |
| `MSP-C08` | Reactions | required | 五类 Reaction、unreact、pending、unknown、retry、dedupe 和 rollback 一致 |
| `MSP-C09` | Private trust and recovery | required | private readiness、decrypt、media open、new-device recovery、integrity 和 device revoke 可见 |
| `MSP-C10` | Cross-Station convergence | required | pending/retrying/source-unavailable、duplicate replay、interaction return 和 invalidation 收敛 |
| `MSP-C11` | Lifecycle and isolation | required | tab/background/restart 保留合法草稿和投影；Station/account switch 清除前一 scope |
| `MSP-C12` | Native quality parity | required | iOS/Android 均满足 accessibility、safe-area、keyboard、bounded list 和 interaction budget |

## 4. Platform Matrix

| Capability | Desktop Native | iOS Native | Android Native | Browser |
|---|---|---|---|---|
| Home/Explore/Search/Profile/Circles | required | required | required | prohibited |
| Full Audience composer | required | required | required | prohibited |
| Public/private detail and interaction | required | required | required | prohibited |
| Trusted-device recovery | required | required | required | prohibited |
| Cross-Station private sharing | required | required | required | prohibited |
| Desktop↔Mobile interoperability | required | required | required | prohibited |
| P2P direct transport | allowed by Desktop owner | excluded | excluded | excluded |
| Mobile safe-area/keyboard/background | n/a | required | required | n/a |

Missing Android evidence means `iOS Social parity proven`, not Mobile parity. Missing Desktop↔Mobile
interop or two-Station evidence means same-platform/same-Station proof only.

## 5. Mobile Information Architecture

```text
Moments tab
  -> Home | Explore
  -> Moment inline thread (comments/replies)
  -> Media preview overlay (image/video)
  -> Search (full-screen)
  -> Circles (full-screen)
  -> Composer (bottom sheet -> full-screen audience/member picker)
  -> User profile (full-screen)
  -> Exception detail (direct link / notification / blocking recovery only)
  -> Recovery/trust surface (inline or full-screen by severity)
```

- Home/Explore 使用顶部分段控件，切换不改变 Bottom Tab identity。
- 普通 Moment 正文、评论和回复保持在 Feed；同一时间只展开一个 thread。
- 图片和视频使用临时查看层，关闭后保持原 Feed 滚动位置，不创建 route。
- Search、Circles、Profile 是 descriptor-owned detail routes，隐藏 Bottom Tab。
- Detail route 只处理 direct link、通知定位或无法在 Feed 内安全承载的阻断恢复。
- Composer 使用 BottomSheet；Audience 的复杂 member selection 使用全屏子页面。
- Reaction 使用 anchored compact picker；无法安全放置时使用 BottomSheet。
- destructive/revocation action 使用独立 danger group 和明确确认。

## 6. Trust And Privacy Promises

1. Mobile 不把 private content 降级为 public 或未加密 URL。
2. Mobile Web 不接收 root key、recovery master 或 Content PreKey private material。
3. Mobile 只渲染当前 Station/PTID/device/generation 的 projection。
4. Source、Audience、Reason、remote delivery 和 recovery 状态在影响决定时可见。
5. 远端 recipient 不可验证时整体失败，不静默缩小 Audience。
6. 删除和 Block 阻止后续访问并清理普通 cache，不承诺抹除恶意保存副本。
7. account/Station switch 在新 scope 可见前清除旧 plaintext projection 和 key references。

## 7. Non-Goals

- 重做 Station Social、Federation transport 或 Secure Content 协议。
- 维护 Mobile 专用 Audience、Circle、Post、Comment 或 Reaction 模型。
- 提供 Browser Social fallback。
- 在 Mobile 加入 libp2p 或直连远端 Station。
- 为 parity 保留 public/private 双写、旧 JSON route 或第二套 durable command owner。
- 把原型、单测、截图或生成 Proto 当作 Native readiness。

## 8. Product Gate

稳定 capability IDs、Journeys、states、runtime cells 和可行性证据已冻结。
状态为 `PRODUCT_ACCEPTED_FOR_PLANNING`。Owner 已于 2026-10-06 确认原型
amendment；Prototype 只固定交互目标，不替代 Native functional 或 Acceptance 证据。
