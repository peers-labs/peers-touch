# AFL-02 · Feed Log 合同与 Station 后端

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-02",
  "workstreamId": "LOG-BACKEND",
  "title": "feed_log.proto 合同与 Station verifier/存储（单设备链，无客户端无端点）",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "journeyId": "afl-j02-log-backend",
  "closureId": "afl-02-feed-log-backend",
  "runtimeClass": "source-only",
  "writeSet": [
    "model/domain/social/feed_log.proto",
    "model/build.sh",
    "apps/station/app/subserver/social/domain/feed_log.go",
    "apps/station/app/subserver/social/domain/feed_log_test.go",
    "apps/station/app/subserver/social/infrastructure/feed_log_store.go",
    "apps/station/app/subserver/social/infrastructure/feed_log_store_test.go",
    "apps/station/app/subserver/actor_identity",
    "model/domain/social/testdata/feed_v1.json"
  ],
  "readSet": [
    "model/domain/social",
    "apps/station/app/subserver/social",
    "apps/station/app/subserver/federation",
    "apps/station/frame/core/signedlog"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl02-proto",
      "command": "./model/build.sh",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl02-go",
      "command": "go -C apps/station test ./app/subserver/social/domain ./app/subserver/social/infrastructure",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl02-journey",
      "command": "python3 tooling/scripts/acceptance-run.py --gate social-public-feed-source",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "FeedGenesis/FeedWriterGrant/FeedEvent/FeedPayload/FeedHead 与 bounded read、通知、互动、订阅合同 proto-first 生成无手改",
    "坏签名拒收、跳 seq 为 FEED_GAP、有效签名的 prev_hash 冲突为 FEED_FORK_DETECTED，整批预验保证无部分投影；幂等键 (actor_ptid,chain_id,sequence)",
    "私密信封字段仅占位：v1 非公开受众不进 feed_log（继续走在役 E2EE），密文子链整体延 v2（AFL-07/07B DEFERRED）；本批不写投影表、不接客户端、不建站间端点",
    "v1 设备授权（AD-08 单设备）：设备密钥由 actor 主身份 attestation 绑定首建设备；verifier 对未 attestation 设备（含第二台）typed 拒绝；不实现 checkpoint 合并器（AFL-04 延 v2）",
    "02 单测不作为产品功能证据（无消费者）"
  ],
  "failureBehavior": [
    "不改任何现役投影/管线（含在役 E2EE prepare/submit）",
    "不实现 checkpoint/复制/私链"
  ],
  "updatedAt": "2026-11-07T00:00:00.000Z"
}
```

## 完整闭环

proto-first 合同 + Station verifier/store，单测自证但无消费者，不构成产品能力。v1 私密不进
feed_log（在役 E2EE 不动），密文子链与多设备合流均延 v2。
