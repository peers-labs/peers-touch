# AFL-05 · 公开 feed 跨站复制：帧总线通知（复用）+ 有界拉取（新增）

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-05",
  "workstreamId": "PUBLIC-REPLICATION",
  "title": "delivery 总线新增公开 feed PayloadKind/receiver + outbox follower∩Audience 扇出；新增缺口有界拉取 peer route",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "afl-j05-replication",
  "closureId": "afl-05-public-feed-replication",
  "runtimeClass": "service",
  "writeSet": [
    "model/domain/federation/delivery.proto",
    "apps/station/frame/core/federation",
    "apps/station/app/subserver/social"
  ],
  "readSet": [
    "apps/station/frame/core/federation/delivery",
    "apps/station/frame/core/federation/transport.go",
    "apps/station/frame/core/federation/routes.go",
    "apps/station/app/subserver/social/application/federated_private_resource.go",
    "apps/station/app/subserver/social/infrastructure/federated_private_resource_delivery.go",
    "apps/station/app/subserver/federation"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl05-frame",
      "command": "cd apps/station/frame && go test ./core/federation/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl05-social",
      "command": "cd apps/station/app && go test ./subserver/social/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl05-journey",
      "command": "cd apps/station/app && go test ./subserver/social/... -run CrossStationFeedReplication",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "delivery.proto 新增公开 feed 事件通知 PayloadKind（proto-first，./model/build.sh 生成）；OpaquePayload 装 Actor 设备签名 FeedEvent（或指针+seq），禁止 Station 代签正文",
    "social 侧 RegisterProtoReceiver 注册公开 feed receiver：独立验设备签名/链连续性/seq 幂等，block/moderation、限速、垃圾事件 typed 拒收；通过后入本地 feed log 并触发 03A 投影",
    "发送侧：append 事务内按 follower∩Audience 计算远端 Home Station 集并入同一 SQL 事务 outbox（范本 federated_private_resource：remoteStations 收集→排序→ValidateActiveStationPair→逐站建帧）；dispatcher/HTTPTransport/Relay opaque 全部复用，零新传输设施",
    "新增一个有界拉取 peer route（frame/core/federation routes + scope + capability manifest digest 同步）：按作者+cursor 分页返回签名事件段，被拉取方按接收方 follow∩Audience 授权；用于新站订阅、推送丢失与 cursor 过期；不复用 /fed/v1/ledger/* 治理端点",
    "两站 Journey：发帖/编辑/tombstone 通知帧到达即收敛；停掉接收站制造缺口后经拉取补齐；非 follow/越 Audience 拉取拒绝；伪造 seq/签名拒收；限速生效",
    "Relay 路径抓包确认 opaque：不见明文、不决定复制目标"
  ],
  "failureBehavior": [
    "不做入站互动（06）/毁站回灌（v2 05B）/AP outbox",
    "不新建投递总线、不加 Station 间 SSE、不做跨联邦公开发现",
    "不动在役 federated_private_resource 私密通道"
  ],
  "updatedAt": "2026-11-07T00:00:00.000Z"
}
```

## 完整闭环

公开跨站纵向闭环。r4 更正：传输复用在役域中立帧总线 `/federation/delivery`
（outbox+dispatcher+HTTPTransport/Relay opaque+Registry），交付物是「新报文种类 +
receiver + 授权扇出」与「一个缺口拉取 peer route」，不是第二套投递设施。推送只做低延迟
通知，权威是可重放的签名链，缺口一律可经拉取补齐。
