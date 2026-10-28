# Schema — Integration

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Shared Client Interaction

## 当前收敛对象

- Desktop `pt://` 导航 parse/isDeepLink 由 Schema registry 统一提供；
  `apps/desktop/src/utils/deeplink.ts` 已删除。
- `apps/mobile/src-tauri/src/platform/deep_link.rs`：保留OS接收与OAuth专用分派，
  general payload改用Schema strict codec。
- 两端`station_discovery.rs`/`station_route.rs`：编码外壳解析收敛；
  station-trust、source proof、route与SPKI验证保留原owner。
- `apps/desktop/src/components/chat/SafetyVerificationPanel.tsx`：
  安全核对QR consumer，保留其原payload语义。
- `ChannelProvisioningPanel.tsx`与`ChannelManagementPanels.tsx`：
  外部频道QR consumer，明确external protocol payload，不能误解为Peers login。
- Dashboard签发的`peers-touch://connect#`：仍是connection-only；
  数据签发不移进UI或Schema。

## 当前实现与验证边界

全部网页/React码图消费同一Schema展示组件；native输入消费同一Schema core。
不保留旧parser实现或双重校验语义；OS callback是Host adapter，不是第二codec。
`qrcode.react` 依赖已删除。共享向量与 browser fixture 提供组件证据；
原生相机和完整登录不能由该 fixture 证明。

原有URI语法不是登录alias：pt://仍只作导航，connect仍只作连接，
OAuth仍走原专用认证流程。合并组件不授权改变存量消息/频道wire语义。

Schema模块不得引入Station/Session/Relay依赖；消费者调用方向始终指向共享能力。
未来applet只通过已授权Host能力消费，不为第三方输入注册任意执行handler。
变更原型与产品码图时遵循现有Prototype Lib和UI Identity，不能复制旧页面实现。
