# Federated Human Social Activity — 执行计划

> **Status**: draft
> **Version**: v0.2
> **Created**: 2026-06-17 | **Updated**: 2026-06-18
> **Owner**: Architecture Team

---

## 1. 真实升级目标

本计划不是 Moments UI 美化，也不是 Agent 社交实现。真实目标是：

> 将当前 Moments 从“帖子列表”升级为“Human 联邦社交活动层”，让用户能理解人、Station、关系、Audience、投递原因和互动边界。

非目标：

- 不实现 Agent 社交。
- 不实现 A2A 能力共享。
- 不实现 Applet 发布社交对象。
- 不引入办公、任务、项目、审批模型。
- 不用页面 fetch 替代 runtime projection。

---

## 2. 领域责任拆分

| 领域 | 责任 | 主要交付物 | 依赖 |
|------|------|------------|------|
| D1 Product Language | Human 联邦社交产品语言 | 文档、术语、Feed 信息结构 | 无 |
| D2 Identity & Source | Human Actor 与 Station 来源表达 | actor summary、source badge | ActorRef |
| D3 Relationship Reason | 为什么看到某对象 | reason enum/projection/UI | relationship/follow/circle |
| D4 Audience Explanation | 可见范围解释 | audience explanation projection/UI | social.Audience |
| D5 Feed Projection | Runtime-owned feed 新鲜度 | store maps、runtime reconcile | D2-D4 |
| D6 Feed UI | 高密度现代 Human Feed | card taxonomy、composer、states | D2-D5 |
| D7 Profile/Search/Circles | Human 社交辅助面 | profile、search、circle management | D2-D5 |
| D8 Interaction Closure | 评论、reaction、follow、block | action flows、errors、optimistic state | D5-D7 |
| D9 E2E Harness | 多 Station 验收 | bootstrap/run/report scripts | D1-D8 |

---

## 3. 阶段计划

### Phase 0: 文档冻结

目标：冻结当前阶段只做 Human 联邦社交的口径。

任务：

- [x] 重写 `README.md`。
- [x] 重写 `design.md`。
- [x] 重写 `data-model.md`。
- [x] 重写 `integration.md`。
- [x] 重写 `decisions.md`。
- [x] 重写 `e2e-acceptance.md`。
- [x] 建立本执行计划。

验收：

- 文档不再把 Agent/A2A/Applet 作为当前阶段实现目标。
- 文档能回答 why / what / layers / E2E / plan。

状态：`completed`

### Phase 1: Product Language & UI Information Architecture

目标：把 Moments 的 UI 信息架构升级为 Human 联邦社交语言。

任务：

- [x] 定义 Feed card 必显字段：identity、source、reason、audience、actions。
- [x] 定义 Home / Federated / Profile / Search / Circles 的页面职责。
- [x] 定义 local / remote / blocked / unresolved actor 的展示状态。
- [x] 定义 audience badge 和 reason line 的 i18n key。
- [x] 移除不符合当前阶段的 Agent/Applet 入口。

说明：

- local / remote / unresolved 已在 Feed card、Profile header、Search result 中用 `homeStationDomain` 与 viewer home station 对比展示。
- blocked 不由 UI 猜测；它必须进入 Phase 2/3 的协议与 runtime projection 后才能展示，避免把权限状态伪造成普通 UI 标签。

验收：

- UI spec 能覆盖 E2E-H01 至 E2E-H07 的展示要求。

状态：`completed`

### Phase 2: Proto & Projection Contract

目标：补齐 Human feed 解释所需的协议与投影契约。

任务：

- [x] 评估是否扩展 `model/domain/social/post.proto` timeline response。
- [x] 定义 `RelationshipReason`。
- [x] 定义 `AudienceExplanation`。
- [x] 定义 `ActivitySource` / source station projection。
- [x] 定义 blocked actor / blocked station 的 feed exclusion 与 explanation projection。
- [x] 更新生成代码。
- [x] 更新 Desktop Rust / social API bridge。
- [x] 补充 station-level moderation projection 边界文档。

说明：

- 已在 `GetTimelineResponse`、`ListPostsResponse`、`GetPostResponse` 中加入 `FeedObjectExplanation`。
- Station 已为 timeline / projection sync / profile / detail 返回 explanation。
- 当前 block 落地为“不可见内容不返回，已返回内容标记 `BLOCK_STATE_NOT_BLOCKED`”；其他 block 状态保留为后续 moderation/audit projection。

验收：

- Station 能返回 feed object 的 source/reason/audience explanation。
- Desktop Web 不需要自行推导权限。

状态：`completed`

### Phase 3: Runtime & Store Projection

目标：让 runtime 拥有 Human feed 解释投影的新鲜度。

任务：

- [x] 扩展 `useMomentsStore` projection maps。
- [x] 扩展 `momentsRuntime` bootstrap / reconcile。
- [x] 消费 post/comment/reaction/follow/block 事件。
- [x] 投影 actor block 事件，供 runtime 刷新 Feed exclusion。
- [x] 建立 station-level moderation policy source 与 command/query bridge。
- [x] 补齐 station-level moderation action gates。
- [ ] 补齐 station-level moderation aggregate projection。
- [x] 支持 reload / reconnect recovery。
- [x] 补 focused store tests。

说明：

- `useMomentsStore.feedExplanations` 已按 `Post.id` 保存 Station 返回的 `FeedObjectExplanation`。
- 现有 `momentsRuntime.syncProjection` 会随 home/public timeline 一起刷新 explanation。
- Moment created / deleted / commented / reacted 事件已由 `momentsRuntime` 消费。
- Follow / unfollow 成功后会发布 `relationship.changed`，`momentsRuntime` 会刷新 relationship cache、目标 followers 列表和 Moments projection。
- Chat block / unblock 成功后会发布 `relationship.changed:block/unblock`，让 Moments projection 通过 Station block graph 刷新。
- Realtime 断线后重新连接会触发 throttled projection refresh；`REALTIME_RESYNC` 仍走冷刷新。
- Station block 已建立 `StationModerationPolicy` proto、Station DB policy source、upsert/delete/list API 与 Desktop Rust/Web bridge。
- Timeline feed projection 已从 Station policy source 过滤 blocked Station 来源；Profile/Search/Follow/Comment/Reaction gates 已接同一 policy source，aggregate notice 仍待补。
- Station moderation upsert/delete 成功后 Desktop Web 会发布 `moment.resync_requested`，由 `momentsRuntime` 刷新 feed projection。
- `src/test/moments-store.test.ts` 已覆盖 `feedExplanations` ingest、delete cleanup、relationship changed event、block/unblock bridge 发布、station moderation resync 事件、realtime reconnect recovery。
- `moderation-projection.md` 已冻结 station block 的真实边界：必须由 Station policy source 驱动，Desktop 不得推断。

验收：

- E2E-H08 runtime freshness 可通过。
- 页面没有新增 mount-time business fetch。

状态：`in-progress`

### Phase 4: Human Feed UI

目标：实现现代 Human 联邦社交 Feed。

任务：

- [x] 重构 `MomentsApp` 为 Home / Federated / Search / Circles / Profile 的清晰产品空间。
- [x] 重构 `MomentCard`，展示 source station、reason line、audience explanation。
- [x] 重构 composer，保留 Human 发布能力。
- [x] 重构 list loading / empty / error / retry 状态。
- [x] 补充 i18n。
- [ ] 验证窄屏和大屏布局。

说明：

- 已完成不占端口的响应式布局改动：大屏保持 Feed + 右侧上下文栏；窄屏切为单列，并将上下文说明压到顶部。
- 视觉验收仍需等待 Desktop dev server / E2E 端口可用后执行。

验收：

- E2E-H01、E2E-H02、E2E-H03 的 UI evidence 可通过。

状态：`in-progress`

### Phase 5: Profile / Search / Circles

目标：补齐 Human 社交辅助面。

任务：

- [x] Profile 展示 Human Actor、home Station、relationship state。
- [x] Search 支持本地/远端 actor 发现。
- [x] Circles 展示发布者私有关系分组和 audience 解释。
- [x] Follow / unfollow 状态与 Feed projection 联动。
- [x] Actor block 状态进入 Feed exclusion 与 runtime projection refresh。
- [x] Station block policy source 进入 moderation projection。
- [x] Station block 状态进入 profile/search/action gates。
- [ ] Station block aggregate notice。

说明：

- Actor block 已通过 friend-chat block graph 接入 Feed exclusion 与 runtime refresh。
- Station block 已从 proto contract 推进到 Station policy source、timeline exclusion、profile/search/action gates、Desktop Rust/Web command bridge；UI 仍不得本地推断 station block，边界见 `moderation-projection.md`。

验收：

- E2E-H02、E2E-H03、E2E-H05、E2E-H07 可通过。

状态：`in-progress`

### Phase 6: Interaction Closure

目标：闭合 Human 社交互动链路。

任务：

- [x] 评论发布、删除、回复。
- [x] Reaction add/remove。
- [x] Follow / unfollow。
- [x] Block / unblock actor。
- [x] Block / unblock station command/query bridge。
- [x] Block / unblock station runtime refresh event。
- [ ] Block / unblock station UI 入口。
- [ ] 所有 action loading/error/retry 状态。
- [x] 互动后的 runtime/store projection 一致性。

说明：

- 评论 / reaction 本地 action 保持局部状态即时更新；远端 `moment.commented` / `moment.reacted` 事件会刷新 detail projection。
- Follow / unfollow 通过 `relationship.changed` 进入 runtime，刷新 feed explanation projection，避免按钮状态与 Feed reason line 分叉。
- Block / unblock 通过同一事件进入 runtime，刷新 Feed exclusion 和 explanation projection。
- 发布动态后会触发 best-effort `syncProjection`，让新动态尽快拿到 Station 返回的 `FeedObjectExplanation`。
- Composer、comment publish、comment delete、follow、reaction、list load-more 已有 loading/error 反馈；station block UI 入口与全局 retry 策略仍需后续收口。

验收：

- E2E-H06、E2E-H07 可通过。

状态：`in-progress`

### Phase 7: E2E Harness

目标：建立可持续验收机制。

任务：

- [ ] Bootstrap 两 Station 测试拓扑。
- [ ] Seed Alice/Bob/Carol/Dana。
- [ ] Seed follow/circle/block/audience 数据。
- [ ] 实现 `run.sh --scenario`。
- [ ] 实现 UI evidence capture。
- [ ] 实现 report 输出。
- [ ] 接入 nightly 或手动验收命令。

验收：

- E2E-H01 至 E2E-H08 全量可运行。

状态：`pending`

---

## 4. 进展跟踪

| 阶段 | 状态 | 主要验收 | 备注 |
|------|------|----------|------|
| Phase 0 | completed | 文档评审 | 当前阶段 Human-only 口径已冻结 |
| Phase 1 | completed | UI spec | Feed/页面职责、source/reason/audience、local/remote/unresolved 状态已收口；blocked 进入 projection 阶段 |
| Phase 2 | completed | projection contract | proto-first contract、生成代码、Station/Desktop bridge 已落地 |
| Phase 3 | in-progress | E2E-H08 | feedExplanations 已接入 store/runtime；follow/comment/reaction/actor-block/reconnect 一致性与 focused tests 已补，station-level policy source、timeline exclusion、action gates 已落地，aggregate notice 待补 |
| Phase 4 | in-progress | E2E-H01..H03 | Moments shell、composer、card、list state 与响应式单/双栏已完成代码落地，等待视觉 E2E |
| Phase 5 | in-progress | E2E-H02/H03/H05/H07 | Profile/Search/Circles 已接入同一套 Human 社交语言与 i18n 收口 |
| Phase 6 | in-progress | E2E-H06/H07 | comment/reaction/follow/actor-block 已闭合主要 loading 与 projection 一致性，station block command/query bridge 与 runtime refresh 已补，UI 入口与 retry 策略待补 |
| Phase 7 | pending | E2E-H01..H08 | harness |

---

## 5. 反指标

| 风险 | 反指标 | 治理动作 |
|------|--------|----------|
| 当前阶段范围膨胀 | 出现 Agent social / A2A task / Applet result 任务 | 移入 future design，不进入本计划 |
| UI 只做美化 | Feed 不显示 source/reason/audience | 阻塞 Phase 4 验收 |
| 权限下沉 UI | 页面根据 relationship 判断可见性 | 回退，改为 Station/runtime projection |
| Runtime 退化 | 页面 mount fetch 修复 stale state | 阻塞验收 |
| 信息噪音过高 | 卡片堆满技术字段 | 改为默认摘要 + 可展开 |
| 隐私泄露 | Circle member list 或 private text 泄漏 | 阻塞 E2E |

---

## 6. 完成定义

本阶段完成必须满足：

- Human Feed 能展示 source station、relationship reason、audience explanation。
- Home / Federated / Profile / Search / Circles 有清晰产品职责。
- Public / followers / circle / self audience 不越权。
- Comment / reaction / follow / block 闭环可用。
- Runtime 拥有 feed projection freshness。
- E2E-H01 至 E2E-H08 可运行并生成报告。
- Agent / A2A / Applet 只作为 future extension，没有进入当前阶段实现。
