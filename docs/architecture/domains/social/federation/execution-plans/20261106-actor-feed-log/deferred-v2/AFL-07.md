# AFL-07 · 私密密文子链合同与 Station 路由（先合同，不动在役管线）

> **STATUS: DEFERRED to v2（r4，2026-11-07，AD-08）**——v1 非公开受众继续走在役
> E2EE prepare/submit（`social_private_posts`），权威不迁移。本任务移出 v1
> tasks/closures/criteria，密文子链合同设计保留备查。

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-07",
  "workstreamId": "PRIVATE-SUBFEEDS",
  "title": "按受众拆子链 + checkpoint 授权裁剪 + 密文信封 verifier 路由",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "afl-j07-private-subfeed",
  "closureId": "afl-07-private-subfeeds",
  "runtimeClass": "service",
  "writeSet": [
    "model/domain/social/feed_log.proto",
    "apps/station/app/subserver/social/feed"
  ],
  "readSet": [
    "model/domain/social/private_content.proto",
    "apps/station/app/internal/securecontent",
    "packages/secure-content-core"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl07-go",
      "command": "cd apps/station/app && go test ./subserver/social/feed/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl07-journey",
      "command": "cd apps/station/app && go test ./subserver/social/... -run PrivateSubfeedContract",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "device feed 拆公开链+按受众/密钥域独立 seq 的私密链；checkpoint 对未授权方裁剪私链 head，杜绝单链 seq 空洞",
    "密文信封 verifier 路由单测：无密钥可验外层签名但永远进不了明文投影；密钥分发沿用 secure content，不造加密协议",
    "与 AFL-01 canonical 裁决一致，密文域编码不产生第二标准",
    "本批不改 social_private_posts 写路径"
  ],
  "failureBehavior": [
    "不改 E2EE 算法",
    "不动在役私密管线（07B 才切）"
  ],
  "updatedAt": "2026-11-06T13:30:00.000Z"
}
```

## 完整闭环

密文子链合同与路由，先合同后切管线。与 AFL-01 canonical 裁决对齐。
