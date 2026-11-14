# AFL-05B · Feed 链可携带性：毁站后从友站回灌恢复

> **STATUS: DEFERRED to v2（r4，2026-11-07，AD-08）**——钉版 glass 原型无毁站恢复
> 产品面，v1 不交付助记词身份重建与友站回灌；零副本毁站物理丢失是 v1 已知边界。
> 本任务移出 v1 tasks/closures/criteria，设计保留备查。

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-05B",
  "workstreamId": "CHAIN-PORTABILITY",
  "title": "作者身份证明 + peer→new-home 链回灌端点 + checkpoint 锚定",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "afl-j05b-portability",
  "closureId": "afl-05b-chain-portability",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/station/app/subserver/social/feed",
    "apps/station/app/subserver/social/infrastructure",
    "apps/desktop/src"
  ],
  "readSet": [
    "apps/station/app/subserver/social/application/private_content_recovery.go",
    "apps/station/app/subserver/federation/sync_manager.go",
    "packages/secure-content-core/src/recovery.rs"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl05b-go",
      "command": "cd apps/station/app && go test ./subserver/social/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl05b-journey",
      "command": "cd apps/station/app && go test ./subserver/social/... -run FeedChainRecoveryIngest",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "定义新协议：助记词在新站重建身份后，友站凭作者密钥证明向新 Home 回灌其有权持有的 feed 链副本，新站锚定 genesis/checkpoint 后幂等接续（现 private_content_recovery 只列本站对象，不具备此能力）",
    "授权：回灌方只回灌其按 follow∩Audience 合法持有的事件；多副本冲突以 checkpoint head 为准",
    "Journey：销毁 Home Station 数据→新站恢复→从友站回灌→继续发帖，seq 连续"
  ],
  "failureBehavior": [
    "不承诺友站都没有副本时的数据复活（零副本仍物理丢失）"
  ],
  "updatedAt": "2026-11-06T13:30:00.000Z"
}
```

## 完整闭环

补齐目标#5 的实现缺口（F-03 修正）：毁站恢复需要独立的身份证明+回灌协议，现有恢复设施只列本站私密对象。
