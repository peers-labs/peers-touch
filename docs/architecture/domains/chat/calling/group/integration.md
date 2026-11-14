# 群媒体集成

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-11-13 | **Updated**: 2026-11-13
> **Owner**: Chat Product Team

## 1. 与现有模块的映射

Conversation UOW 与 Actor Identity/Session mutation 保留业务 authority；
groupcall 注入媒体权限撤销 port，不接管成员、登录或设备私有表。
Federation 保留 authenticated route 与 epoch 验证。Home native transport
增加 allowlisted join 操作，不开放通用 URL proxy。

Client Chat Core 拥有 SDK adapter、media lease、GroupCallController；
Desktop facade 保留 event bus 和 API，Mobile facade 保留 social session lifecycle。
MobileShell 挂载全局群 surface，ChatPage dispatch audio/video/join；
surface 切页不卸载正在参与的媒体 runtime。

Session owner 的 `WithMediaSessionFence` 解析并锁定真实安装 binding；
Actor Identity 原 revoke 与 Session 原 delete/cleanup/logout/replacement 调用
`frame/core/facility/mediaaccess` 的同步 port。该 port 不存储任何业务事实。
Conversation 的原 authority repository 保存 membership/status/epoch 变更前，
向媒体 owner 提交剩余有效 endpoints；签发和 admission 使用原 UOW 的群锁。

`group_call_endpoint_grants` 保留 Home/Authority 两侧的 grant 和 tombstone，
不存储 token。跨 Station endpoint control 使用原 Federation route、Actor subject
及 deterministic protobuf request digest，不接受客户端自己指定 device/session。
群状态通过 Home 的 allowlisted `group_call_status` 查询；SSE 只触发重新读取。

SFU 的 conditional admission 要求见 [实现合同](./sfu-admission-contract.md)。
已固定上游 v1.13.0 源码并在现有 SFU 的 StartSession/Update/Remove 入口增加
同一 endpoint fence、SID 比较和新连接初始禁权。Station 先验证当前 SFU capability，
stock 或未知能力仍返回 unavailable。Compose 使用当前源码的 LiveKit 构建。
源文件补改、三端协议生成和回归已进入当前批次。集中验证覆盖共享媒体、
完整 Mobile/Desktop、Station 权限 owner 与固定 SFU RPC；目标 SFU 部署和
M15 原生媒体证明仍待完成。源码接入与 UI fixtures 不能替代实际媒体完成证明。

原 `chat-lifecycle-group-live-e2e` 复用 `chat-mixed-native` 环境、Provisioner 和
`MixedNativeRuntime`，在一个 Suite 内绑定 Alice/Bob Desktop 与 Charlie Mobile。
Gate 要求实际 SDK 的 inbound/outbound RTP 增量、生产 Mobile 控件、撤权后剩余
SFU roster 与本地释放，校验器拒绝绝对计数、缺少任一接收边和 Desktop 替代 Mobile。
负例 probe 仅在原 Native Harness 显式 arm 后捕获本次真实 join response；
token 不输出、不持久化，重放结果只返回新 SID、禁权和释放状态。
原生 Desktop 身份使用 MixedNativeRuntime 的 `desktop-macos-native`，
不以环境 client spec 的 `native-tauri` 标签替代实际运行身份。
SFU restart 从本次生产 grant 的 URL 选择唯一已绑定 Station 主机；
原 restart owner 继续验证该 Station 的真实 public URL、container/source/port
和 disposable lease，拒绝未绑定或歧义目标，不固定 primary/secondary 角色。

## 2. 影响面

Desktop/Mobile 共用 adapter 后都需检查 track attach、async disconnect、
active speaker 归零、controls 和取消竞争。Mobile 原 SSE ingress 增加
typed room event，不新增连接。既有 Direct 呼叫、设备 winner/loser 和信令合同保留。

Mobile 原生权限与后台策略仍由平台 owner 实现；resume 不伪称重新接通，
用户状态来自 SDK 和重新授权。单聊和群聊之间不得同时 capture。

## 3. 替换边界

删除 Desktop 私有 provider/type/controller 实现；公共 module barrel 直接导出共享
合同，Host facade 只注入 Host ports。旧 `group-calls.md` 架构正文由本目录取代；
calling taxonomy 直接链接此模块。生产没有兼容 token 权限旁路：
无 device/session 的 admission 被拒绝。原 Gate 扩展 Mobile 和权限负例，
禁止另建简化登录或 fixture-only media proof。
