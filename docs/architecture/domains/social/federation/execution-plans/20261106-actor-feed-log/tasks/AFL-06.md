# AFL-06 · 非关注者互动入站投递与线程索引（建在 projector 之上）

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-06",
  "workstreamId": "INBOUND-INTERACTIONS",
  "title": "互动者站→帖主站：delivery 总线新增互动 PayloadKind 推送 + 线程投影 + follower 扇出",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "afl-j06-inbound",
  "closureId": "afl-06-inbound-interactions",
  "runtimeClass": "service",
  "writeSet": [
    "model/domain/federation/delivery.proto",
    "apps/station/app/subserver/social"
  ],
  "readSet": [
    "apps/station/frame/core/federation/delivery",
    "apps/station/app/subserver/social/application/federated_private_interaction.go",
    "apps/station/app/subserver/social/infrastructure"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl06-go",
      "command": "cd apps/station/app && go test ./subserver/social/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl06-journey",
      "command": "cd apps/station/app && go test ./subserver/social/... -run InboundInteractionJourney",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "线程索引投影建在 AFL-03A projector 之上（依赖边 03A→06），不向旧表投影",
    "delivery.proto 新增公开互动 PayloadKind（与在役社交私密互动 14/15 同构）：非互关跨站评论/反应经帧总线推送到帖主 Home Station，帖主站 thread admission 后成线程索引，并随帖主 feed 通知向其 follower 扇出",
    "伪造/越界/超载/被 block typed 拒收；reaction 幂等按 (actor_ptid, device_key_id, device_seq)（v1 单设备；跨设备折叠随 AFL-04 进 v2）"
  ],
  "failureBehavior": [
    "不做全局评论搜索/推荐/评论编辑",
    "不新建反向投递通道（复用 /federation/delivery）"
  ],
  "updatedAt": "2026-11-07T00:00:00.000Z"
}
```

## 完整闭环

非关注者互动纵向闭环，线程投影只建在 03A projector 之上（F-04 补边）；传输复用在役
帧总线（r4）：与在役跨站私密互动（PayloadKind 14/15）同构，新增公开互动 PayloadKind，
不另造反向通道。
