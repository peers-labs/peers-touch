# Provider 普通用户边界审阅

普通用户在已授权模型中选择个人默认。共享凭据、运行方式、安装和授权配置
由 Station Dashboard 管理。个人服务商编辑仅在 Station 明确开启策略后出现。

本次审阅限定于 Provider 消费页面、个人默认、刷新与失败恢复；未执行全量测试。
定向源码检查和下述原生功能复验通过。本文件不声明整个 Provider 工作流完成
或正式验收通过。

## 来源与源码

- 工作树：`worktrees/agent-usability-shared-base-20261027`。
- 分支：`feat/agent-usability-shared-base-20261027`。
- 审阅范围：`5d719d8d3..5b77000bf`。
- 原生构建与 Station：`5b77000bf3a225999c04e27870b2588cc982305f`。
- Profile：`one-slave`，隔离桌面 slot 6。
- 架构：[Provider Control Plane](../../architecture/domains/agent/provider-control-plane.md)。
- 客户端：[Provider 与模型架构](../../client/desktop/provider-model-target-architecture.md)。
- 用户说明：[Station AI 管理与使用](../../client/dashboard-ai-management.md)。

## 实现边界

消费 API 不投影运行类型、管理修订、凭据、安装状态或命令。授权资格不构成
供应商连通验证。已授权页面只呈现服务商名称、模型名称和个人默认操作。
空模型状态引导用户获取权限，不要求用户配置共享密钥。

Provider Store 分别管理列表、选中详情和默认读写生命周期。选中详情随
`agent-capability` 运行时协调刷新；单模型撤权无需移除整个服务商。请求序号、
视图和重置 generation、Session epoch 共同阻止迟到响应覆盖当前状态。
失败读取清除受影响的旧投影并提供重试；旧详情缓存已删除。

个人策略撤回退出编辑视图，并使在途个人操作失效。默认保存使用实际读到的
账号修订，串行提交，拒绝未读取或失败读取后的写入；保存使更早的读取失效。
修订冲突后重新读取当前默认，下一次用户操作使用新修订。

窄窗将列表与详情上下排列。模型名称与默认操作使用统一列轨道，长名称换行。
默认选择仅包含启用的对话模型，没有无效的清空操作或额外服务槽位。

## 定向源码检查

- PASS：Desktop Provider 生命周期 17 项、readiness 5 项、Settings 合同 7 项、
  模型不可用 API 7 项，共 36 项。命令：
  `pnpm --dir apps/desktop exec vitest run src/store/provider.session.test.ts src/store/provider.test.ts src/components/settings/provider.contract.test.ts src/services/desktop_api.providerModelUnavailable.test.ts`。
- PASS：`pnpm --dir apps/desktop exec tsc --noEmit -p tsconfig.json`。
- PASS：`pnpm --dir apps/desktop run check:locales`，en/zh-CN 文案和键覆盖一致。
- PASS：从 `apps/station/app` 执行
  `go test ./subserver/agent/handler -run 'TestProvider(Consumer|Management)' -count=1`。
- PASS：Python 模型场景语法检查与差异格式检查。

生命周期回归覆盖重叠列表、同一详情的迟到响应、视图往返、账号替换、
Session epoch 不变时的 reset、单模型撤权、读取失败与恢复、策略撤回、
默认并发保存、旧默认读取、失败读取后的拒绝写入及冲突后重读。

## 原生功能检查

复用既有原生登录、Settings 操作、模型场景、Desktop 构建和 Linux GUI 所有者。
共享 E2E 准备解析选择 `agent-chat-models-native` 与 `desktop-linux-native`，
没有升级为全量或正式 Acceptance。场景断言在模型原始所有者中维护。

FUNCTIONAL_CHECK/PASS，实际 Station 与原生构建均为上述 `5b77000bf`：

- Alice、Bob、Alice 依次登录同一原生客户端。Alice 通过语义键盘 Enter 保存
  默认模型；Bob 保持原始空默认；返回 Alice 恢复其个人选择。
- Model Service 通过真实可见选择器切换默认模型，Station 读回一致；
  页面没有无效的清空按钮。
- 同一 Session 撤销一个模型授权，运行时协调后原选中详情只显示剩余模型。
  没有通过重新登录或重新选中掩盖刷新问题。
- 撤权后读取选中详情失败，旧模型消失，页面显示本地重试入口；
  恢复授权后点击重试，模型重新出现。
- Station 开启个人策略后可以进入个人视图；撤回策略后编辑视图退出。
  全部撤权后列表与选中详情清除。
- 普通页面没有凭据字段、配置筛选、运行方式标签、健康声称或联邦管理入口。
- 原生窗口宽度 1280、1024、992、980、900 的几何断言通过；992 及以上
  为横向分栏，980/900 为上下排列。最窄名称轨道为 289 CSS px，默认按钮
  为 145×36 CSS px，两行名称和动作轨道一致，详情没有水平溢出。
  将一个动作列刻意移位 5px 后，同一检查拒绝该布局；恢复后继续功能流程。
- 已打开并审阅宽窗、窄窗及重试截图。长模型名可以阅读，默认状态文案统一，
  行操作边缘对齐。

原生记录：
`.local/dev/cache/provider-consumer-native-result.json`；
清理记录：
`.local/dev/cache/provider-consumer-cleanup-result.json`。
截图位于同目录的 `provider-consumer-1280.png`、`provider-consumer-900.png`、
`provider-consumer-retry.png`。它们是 Development 工件，不是正式 Gate Evidence。

## 结构与组件树

结构审阅覆盖 11 个源码文件，绑定上述源码范围，结果 PASS。五项文件长度或
缩进信号均已逐项审阅：新增逻辑属于消费投影和恢复边界；既有 Direct 编辑器
只按策略挂载，未将专业字段混入消费页面。

Settings shell 继续由 PageHost/SectionHost 保持；Provider 详情只挂载选中的
一种 schema。页面没有新增业务读取 effect 或轮询。列表、详情、默认和失败
状态保持 Store 所有，隐藏页面通过既有 active selector 限定订阅。
组件树登记已同步缓存和生命周期边界。

## 资源处置

临时服务商 `provider-consumer-20261031` 已删除。仅在非 stable Profile 的
精确 reset scope 和 OS-held lease 下恢复本轮涉及的账号默认；Alice/Bob 均恢复
原始空值，Station 个人策略恢复关闭。临时 `station.reset` 能力已撤回，
原 `station.connect,station.deploy` 绑定保留。原生客户端、隔离 GUI、密钥环和
相关 lease 已释放；Station 保留已部署的消费边界修复供用户使用。

## 尚未证明

正式 Acceptance 缺匹配源码范围的有效计划和 Gate 结果，gap detector 保持
失败关闭；Development 功能观察不能转换为正式 `PROVEN`。

Ark 真实凭据配置、原生调用、撤权拒绝及四种 CLI 实装与配置观察见
[真实配置与 CLI 实装验证](20261031-provider-cli-live-review.md)。Applet 已按
用户要求排除。消费页面本身的本轮观察未执行完整 Federation 管理流程。
中文原生渲染、深色模式、屏幕阅读器和物理键盘测试不在本次已证明范围。

原生登录使用已有账号的隔离本地状态；完整设备 Engine 和 Agent 能力注册仍有
独立运行前提。本次模型消费结果不能扩大为这些子系统或 Applet 就绪。
