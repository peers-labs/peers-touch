---
kind: invariant
title: Device Link 提交不能替代当前准入与生命周期
status: active
owns:
  - apps/station/app/subserver/device_link/
  - apps/station/frame/touch/accessgate/linked_
  - apps/station/frame/core/facility/session/
  - apps/mobile/src-tauri/src/runtime/device_link/
  - apps/mobile/src-tauri/src/runtime/oauth/link_session.rs
  - apps/mobile/src-tauri/src/runtime/station_route.rs
  - apps/mobile/src/runtimes/deviceLinkRuntime.ts
  - apps/mobile/src/runtimes/sessionRuntime.ts
  - apps/desktop/src-tauri/src/application/device_link/
  - apps/desktop/src-tauri/src/interface/tauri_commands/device_link.rs
  - model/domain/auth/device_link.proto
related:
  - docs/architecture/domains/identity/mobile-scan-login/decisions.md
  - docs/architecture/domains/identity/mobile-scan-login/integration.md
detected: 2026-10-27
---

# Device Link 提交不能替代当前准入与生命周期

## What must hold

Device Link 的提交、当前 Access 决策、Session 激活和路由选择 MUST 由各自
既有 owner 裁决。异步结果 MUST 保留发起时的生命周期与选择所有权；
取消、挂起、退出或重新选择后的旧结果 MUST NOT 重新激活会话、恢复路由
或安装凭据。协议和原子提交约束以 MSL-D01 至 MSL-D07 为准。

## Why this is non-negotiable

COMMITTED 只表示选定安装实例完成交付事务。Mobile 随后通过普通 Access
入口取得当前决策，再进入原有 PIN/Shell 生命周期。把提交当作 GRANTED，
或让提交页面遮挡普通准入页面，会绕过策略更新或使用户无法完成新的动作。

生命周期隔离必须覆盖 owner 入口之前的异步依赖。Session descriptor 等待
Station registry 的回调若在挂起后才进入 controller，会得到新的 admission，
使会话和刷新定时器在挂起后重新出现。仅检查 native read 的返回不够。

相同 binding 的显式重新选择也会改变所有权。Device Link 清理不得仅比较
Station/route/revision。注销后的旧 generation 只可在受限取消路径恢复
已验证的 Claim 元数据，不得继续证明、ack 或凭据安装。

Desktop 的 Create/cancel 在同步 IPC 接纳时预留或撤销原生 slot，
worker 必须使用该 slot，不能运行时重新申请。取消不能用本地准备时间
推断 Station 事务的过期；未知 Create 只恢复原 Station 认证响应中的
同请求 lookup ID，再读取终态并签名取消。该 lookup 不构成 VerifiedOffer，
不能生成 QR、接入材料、批准或凭据。失败保持有界取消所有权并显式返回 pending。
原请求已过期的终态恢复必须来自 Actor/Session/签名与完整摘要均匹配的
Station 事务，不能把无 metadata 的 OFFER_CANCELLED 当作已清理证明。
旧认证不可用的 pending 回收保留所有权和容量上限，只阻塞原 Actor、
Station/root 与 activation scope；不能阻塞新的登录生命周期，也不能把
新 Session 当作旧请求的授权。单项回收失败不得跳过后续可清理项，
正在运行的 Flow 不等待锁来阻塞整个回收批次。
新发码事务只能清理 Session owner 已证明失效的旧 offer；其他有效
Session 的 live offer 保持原容量规则。数据库读取失败不能当作撤销证明。

## How to verify

- `pnpm --dir apps/mobile exec vitest run src/runtimes/deviceLinkRuntime.test.ts src/runtimes/sessionRuntime.test.ts src/runtimes/sessionDescriptorLifecycle.test.ts`
  验证提交转交当前 Access、旧异步结果隔离及挂起/teardown 后无定时器重启。
- `cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml --lib runtime::station_route::tests --locked`
  验证选择 CAS、owned reconnect，以及显式同 binding 重选后清理不覆盖选择。
- `cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml --lib runtime::device_link::tests --locked`
  验证取消专用恢复与正常精确 generation fence 保持分离。
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop --no-default-features application::device_link:: --locked`
  验证 worker 启动前取消、旧 slot 不接纳新请求、终态读回、丢失响应和
  过期 Create 的取消专用 lookup、旧认证 pending 不阻塞新 scope，
  以及单项失败后仍释放后续终态资源。
- 从 `apps/station/app` 执行
  `go test ./subserver/device_link/application -count=1 -timeout=120s`，
  验证终态恢复先持久化、请求摘要冲突不给恢复 metadata，
  新认证清理已撤销/过期/删除 Session 的旧 offer，旧凭据不恢复 QR，
  无效签名不能清理旧 offer，其他有效 Session 不受影响。
- 原生扫码、当前 gate 的显示/提交、PIN、独立多设备消息和撤销仍须对应
  current-source Journey；上述源码测试不能升级为产品或正式 Acceptance 证明。

## Crosswalks

- [Device Link integration](../../architecture/domains/identity/mobile-scan-login/integration.md)
- [Mobile Session 设备身份](mobile-session-device-identity.md)
- [Mobile route renewal](../pitfalls/mobile-route-preexpiry-renewal-single-owner.md)
