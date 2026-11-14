# 群媒体合同与状态

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-11-13 | **Updated**: 2026-11-13
> **Owner**: Chat Product Team

## 1. 协议层结构

join request 指定群；authenticated Session 决定 Actor/device/session。
Authority grant 绑定 `grant_id, conversation_id, actor_ptid, actor_device_id,
source_home_station_peer_id, session_id, federation_id, authority_epoch,
room_name, participant_identity, expires_at, status`。客户端不提交 device 替代
Session 解析，token 和 session 不进入日志、SSE 或 UI。

participant identity 标识 grant/endpoint；Actor PTID、device identity 放在验证过的
SFU metadata。UI 使用 Actor identity projection，媒体 attach 使用 participant identity。
一个 Actor 多设备可各有 tile；不得把同 Actor 的设备撤销误作全 Actor 退出。

## 2. 状态机

`idle → connecting → connected ↔ reconnecting → leaving → idle`；
连接/媒体/网络错误 `→ leaving → failed`，重试从 failed 创建新 attempt。
SSE 结束只移除匹配群/房间的列表提示，本地媒体终止消费当前 SDK 断连，避免旧
room_finished 重放关闭同名房间的新加入。取消立即使 attempt 失效；仍需等全部 pending media
结束并 stop/disconnect 后才离开 leaving。页面切换不改变 connected。

snapshot 包含 state、group、room、mediaKind、participants、active speaker、
local mic/camera、startedAt、error code、pending control 与 media revision。
连接成功不代表 mic/camera 发布成功。每次 provider event 发 immutable roster；
停止说话应清空 active speaker。过期 attempt 不得 emit。

grant `issued → admitted → revoked | expired` 为单向状态；
同一个旧 grant 不得重新 admitted。ejection 幂等，“participant 不在房间”可为成功，
网络未知不能当作成功。未知/无签名 callback 无权限。

## 3. 持久化与一致性

客户端媒体和 token 不持久化，restart 后必须重新申请授权。
Authority 持久化 endpoint grant/revocation，恢复后先 fail closed 再处理 callback。
群成员与设备权限均由原 owner fence 管理；grant 不是第二份群成员事实源。
撤销与签发锁顺序由原 owner 定义，禁止 callback 在 grant 锁内反向读取权限锁。

## 4. 类型映射

Model 定义跨 Station 合同；Go handler 映射 authenticated Subject；
Rust native transport 只允许固定 operation；TS controller 消费已验证 grant。
Provider 类型不依赖 React、Host store、auth 或 protobuf 的业务解析。
Wire room notifications 与 Direct call-signal 是不同 typed event，不互相转换。
