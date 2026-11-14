# AFL-03B · 公开权威 Hard Cut：Desktop TS+Rust 设备签名 + Mobile typed 拒绝 + 验收契约处置

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-03B",
  "workstreamId": "PUBLIC-CUT",
  "title": "公开写路径设备签名化原子切割；旧直写/旧客户端调用同提交删除；Mobile 发布 gated",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "afl-j03b-public-cut",
  "closureId": "afl-03b-public-clean-cut",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src",
    "apps/desktop/src-tauri/src/interface/tauri_commands/social.rs",
    "apps/desktop/src-tauri/src/interface/http_gateway",
    "apps/station/app/subserver/social",
    "tooling/acceptance",
    "packages/locales"
  ],
  "readSet": [
    "apps/desktop/src/services/social_api.ts",
    "apps/desktop/src-tauri/src/interface/tauri_commands/social.rs",
    "tooling/acceptance/features/mobile-moments-participation.yaml",
    "tooling/acceptance/gates.yaml",
    "apps/mobile/src/services/gateways/momentsGateway.ts"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl03b-desktop",
      "command": "pnpm --dir apps/desktop run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl03b-go",
      "command": "cd apps/station/app && go test ./subserver/social/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl03b-journey",
      "command": "pnpm --dir apps/desktop exec playwright test moments-public-cut",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Desktop TS（social_api.ts 22 个写调用、store/moments、composer/pages）与 Rust（social.rs create/react/comment 组包点，当前签名字段发空）全部改为真实设备签名提交；公开 reaction/comment 签名为两侧新建",
    "cut commit 原子：旧公开直写仓储方法、domain/events.go 死结构体（grep 已确认零构造点）、TS/Rust 旧调用同批删除；无 flag/双写/代签，回滚=revert",
    "Mobile/旧端发帖服务端 typed 拒绝（错误码 + locale key 本批定义），聊天不受影响；同提交修改 mobile-moments-participation.yaml：publish 断言缩窄/暂停并新增 typed-reject 断言，gate 不允许保持必挂状态",
    "单站公开全对象 Journey：发帖/编辑（POST_UPDATED 是新能力，现状无编辑）/tombstone/reaction/comment 投影一致，重启重建一致",
    "v1 单设备语义（AD-08）：每 actor 首建设备一条链；第二台设备（无有效 attestation）的公开写被 typed 拒绝并给可定位错误，不静默降级；多设备合流随 AFL-04 进 v2",
    "非公开受众（followers/friends/circle/group/allow/deny/self）在 Desktop composer 按受众分流到在役 E2EE prepare/submit 网关；公开 cut 不改 social_private_posts 与私密跨站投递，native private gates 回归全绿"
  ],
  "failureBehavior": [
    "不动 social_private_posts/secure-content（密文子链切割整体延 v2，AFL-07/07B DEFERRED）",
    "不修改 apps/mobile 产品代码（只服务端拒绝+验收契约处置）",
    "不实现 checkpoint 合并器（AFL-04 延 v2）"
  ],
  "updatedAt": "2026-11-07T00:00:00.000Z"
}
```

## 完整闭环

公开权威唯一硬切：Desktop TS+Rust 设备签名（当前 Rust 组包点签名字段发空，reaction/comment 验签两侧均新建）、旧路径删除、Mobile typed 拒绝与 active 验收契约同提交处置（F-02 修正）。r4 按 AD-08
收口为 v1 单设备语义（04 已延 v2，单设备是 v1 全程边界而非临时窗口）；非公开受众分流
在役 E2EE 网关，在役私密管线零改动。
