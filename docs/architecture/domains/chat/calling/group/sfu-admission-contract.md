# SFU admission 的实现合同

> **Status**: active
> **Created**: 2026-11-13 | **Updated**: 2026-11-13
> **Owner**: Chat Product Team

这是 GC-D03 / GC-D04 的具体实现约束，网络拓扑仍使用现有 LiveKit。
它不引入另一个 SFU、Station SDP proxy 或第二份权限事实源。

## 已确认的缺口

当前 `tooling/docker/compose.yml` 使用 `livekit/livekit-server:v1.13`。
安装的 Go protocol 是 `v1.44.1-0.20260120134243-0914cc74653e`；
`UpdateParticipantRequest` 只有 room/identity，没有 expected SID。

2026-11-13 读取上游 `livekit/livekit` 的 `pkg/service/roomservice.go`：
UpdateParticipant 只按 identity 路由；`pkg/service/roommanager.go`：
StartSession 允许同 identity 替换，UpdateParticipant 对查到的参与者直接 SetPermission，
refreshToken 从当前 grant 生成刷新 JWT。这个源码观察不是 v1.13 运行证明；
生成 SFU 补改时必须固定实际上游 commit，并重新匹配这些入口。

因此两个问题必须一起解决：

1. 旧 webhook 在新连接替换后才到达，不能给新 SID 放权。
2. 已放权参与者保存的刷新 JWT，不能在撤权后绕过初始禁权。

Station `LiveKitAdapter.AdmitParticipant` 先读取经过同一 API-key JWT 验证的
`/.well-known/peers-touch/group-admission`。stock server、未知 contract 或错误固定
source 均返回 `ErrConditionalAdmissionUnavailable`。创建房间前也执行能力检查。
当前补改已经进入源码，目标 SFU 运行、权限竞争与 M15 原生媒体仍未验证。

固定源码是 v1.13.0 commit
`b93c1e160770d93179dc5b1c9027567befec5e62`。`tooling/docker/livekit.Dockerfile`
使用这份源码构建现有 LiveKit，`patch-livekit.py` 在补改前验证两个入口文件的
SHA256，版本或入口变化直接失败。`livekit-admission.go` 被复制进原 `pkg/service`。
它不增加独立进程、数据库、SFU 或信令代理。

conditional update 使用原 RoomService protobuf 和原 Participant RPC。
private `UpdateParticipantRequest` wire field 1001 是 length-delimited
`expected_participant_sid`；两跳 protobuf 保留该控制字段，RTC owner 消费它。
若任何跳丢失控制字段，群房间 update 被拒绝。控制字段不进入 attributes、
metadata 或刷新 token。能力检查不缓存到跨进程版本。

## 现有 LiveKit 的补改边界

只对 Peers-Touch 群房间 `gc-*` 和 endpoint identity `gce-<grant_id>` 应用：

- StartSession 的首次连接及完整重连始终将 incoming publish/subscribe/data/
  metadata 权限归零，即使 token 是 SFU 生成的刷新 JWT。
- `gc-*` 不接纳旧的 Actor-only identity/token。
- 同一 room + identity 的 StartSession、conditional UpdateParticipant 和
  RemoveParticipant 共用一个 SFU 内部串行化 fence；不能只有 Station 的锁。
  当前实现为 RoomManager 内 256 个有界 mutex shard；键含 room 和 identity，
  碰撞仅增加串行化，不降低权限检查。
- conditional admission 携带 expected SID。SFU 在该 fence 内比较当前 SID，
  只有一致时才修改媒体权限并返回实际 SID；控制字段不得成为用户可改 metadata。
- 同 SID 的信令恢复保留现有已验证连接；完整重连产生新 SID，必须重新走
  Authority 的持久 grant admission。旧已 consumed grant 不能授权这个新 SID。
  信令恢复要求 `ParticipantInit.ID` 等于当前 SID；完整重连同时清除 token 中的
  Actor display metadata，只有 Authority conditional admit 可写入真实 Actor PTID。
- capability 由当前 SFU 提供。Station 必须先验证能力，stock server 或未知版本
  返回 unavailable；不得把 stock server 对未知 attributes 的普通保存当作支持。

Authority 在原 Conversation fence 后锁 grant，验证当前 Home authorization，
先提交 consumed SID，再在锁内重新检查 Home、调用 conditional admission，
最后持久化 admitted 状态。放权或最后提交失败写 tombstone 并同步 eject；
原维护 owner 重试失败的 tombstone、超时 admission 和 Session expiry。
群移除在原 Conversation
fence 内写 grant tombstone、确认 SFU eject。Home 的设备/Session 撤销先在各自
原 owner fence 内提交 Home tombstone，再请求 Authority 同步 eject。

Home admission 查询只读取 owner projection，不反向获取 Session/device 写锁。
否则 Authority grant → Home device 与 Home device → Authority grant 会形成
跨 Station 的锁环。保守 tombstone 不随原权限 mutation 的回滚而重新激活；
失败可重试，合法 endpoint 重新申请新 grant。

Mobile 暂不加入通过 Home 原 Session/device fence 请求 Authority；
Authority 原 Conversation endpoint fence 内保存 Actor + room SID 的邀请回应。
状态只返回当前成员的当前房间回应，加入成功清除该 Actor 的旧回应。
旧房间的拒绝请求不得更新新房间；断网显示保存失败，不能伪报已拒绝。

## 必须证明的负例

- 在 conditional update 等待期间用同 token 替换 identity，旧 SID 永不放权。
- 保存已放权后的刷新 JWT，移出群/撤销设备/撤销 Session 后完整重连，媒体禁权。
- 重放 participant_joined webhook，未知 grant、旧 SID、错误 Home/epoch 均拒绝。
- Authority 和 SFU 分别 restart 后重放旧 token，不恢复既有权限。
- 慢 SFU 或 Federation 失败，原 mutation 不返回成功；tombstone 与重试可观察。
- 成功撤权后以 SFU roster 与 RTP 接收增量证明没有新的未授权帧。

上述负例和三位真实 native 成员的音视频、控制、late join、重连、释放，
一起扩展原 `lifecycle_group_live.py`，不使用 fixture roster 代替实际媒体。

原 Gate 对成员移除、设备撤销和 Session logout 分别保存实际初始/刷新 token 并回放。
SFU 重启消费原 runtime manifest 中 secondary Station 的审核部署，以及实际 grant URL：
核对 Station 的 LIVEKIT_PUBLIC_URL、disposable 归属、host/port、compose project/service、
固定 image source/contract 和健康状态；重启前后必须为同一 image/container、不同 StartedAt。
撤权 endpoint 的刷新 token 重放仍须拒绝；合法 Alice/Charlie 显式申请新 grant，
以新 RTC SID 和双方音视频 RTP 增量证明恢复。仅新增场景代码不代表已取得运行证据。
