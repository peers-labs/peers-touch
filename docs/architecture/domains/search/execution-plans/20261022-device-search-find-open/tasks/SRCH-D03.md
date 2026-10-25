# SRCH-D03：Desktop Search coordinator 与新增 typed 命令

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SRCH-20261022",
  "taskId": "SRCH-D03",
  "workstreamId": "COORDINATOR",
  "title": "新增 suggest/submit/cancel typed 命令与真实 coordinator；旧 stub 保留待 D06 删除，中间态不坏",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "srch-j03-coordinator",
  "closureId": "srch-d03-desktop-coordinator",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src-tauri/src/application/search",
    "apps/desktop/src-tauri/src/interface/tauri_commands/search.rs",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src-tauri/Cargo.toml",
    "docs/architecture/engineering/architecture-governance/architecture-modules.json"
  ],
  "readSet": [
    "packages/search-core",
    "packages/messaging-core",
    "apps/station/app/subserver/launcher/service/search_service.go",
    "docs/architecture/domains/search/design.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "srch-d03-cargo-test",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml application::search",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d03-tauri-build",
      "command": "cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d03-coordinator-functional",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml search_coordinator",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "srch-d03-module-governance",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "srch-d03-coordinator-boundary",
      "command": "bash -lc '! rg -n \"reqwest|libp2p|station.*(http|transport|client)\" apps/desktop/src-tauri/src/application/search apps/desktop/src-tauri/src/interface/tauri_commands/search.rs'",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "新增基于 search.proto 生成类型的 typed 命令：search_suggest（本机即时精确对象）、search_submit（完整本机检索）、search_cancel；旧 help_get/search_sources/search_query/search_ai 四个 StubPayload 命令本任务保留可编译（旧 TS 仍消费），但不新增任何对旧命令的调用——它们不是兼容层，只存活到紧随其后的 SRCH-D04B 直接替换闭包",
    "三个新命令在 tauri_commands/search.rs、main.rs invoke_handler、http_gateway match 臂三处同步注册并使用同一合同类型；删改后 cargo check 通过",
    "coordinator 通过 MessageSearchPort 聚合会话、跨会话消息、附件名，分组排序使用 search-core AST/RRF；空查询只允许最近/建议，不做正文扫描",
    "coverage：全部本机来源 ready；索引重建中/未恢复历史为 partial 且逐条说明；零命中与失败严格区分",
    "opaque cursor 分页稳定不重复；search_cancel 立即停止后续读取；锁屏/身份切换取消并丢弃结果",
    "功能 catalog port 在本任务只定义注入点，真实目录由 SRCH-D05 提供",
    "application/search Cargo 依赖与源码不含 Station HTTP/transport 客户端；search-core 以 path 依赖接入，并在 architecture-modules.json 登记 consumers=desktop src-tauri、reuseLayer=portable-rust-core 与 allowedDependencies（拒识 reqwest/libp2p/tauri/rusqlite 下沉到 core），治理校验通过",
    "错误走 AppResult 与 typed 错误码；域外 scope 在 admission 层返回 SCOPE_OUTSIDE_SEARCH_DOMAIN",
    "中间态保证：任务结束后旧 SearchPage/设置搜索商仍调用旧命令且行为不坏，新命令只有测试与尚未接线的内部调用方；不允许把任何新 UI 接到旧命令上"
  ],
  "failureBehavior": [
    "不直接 rusqlite 散查消息表：所有消息读取经 Messaging owner 暴露的 port",
    "不在 Rust 端复刻第二份分词/融合逻辑；语义来自 search-core",
    "不删除旧 stub 命令与合同类型（D06 才删），也不做命令别名双写",
    "Station launcher mock 不接线不删除；客户端新链路无 Station 调用"
  ],
  "updatedAt": "2026-10-22T15:30:00.000Z"
}
```

## 完整闭环

输入是 D01 的纯机制核心与 D02 的本机索引 port；输出是 Desktop native 层一组真实但新增的 typed 命令与协调器。旧 TS 世界仍走旧 stub，界面行为不变，因此"引擎真实化"本身是一个可独立 cargo 验证、可单独 revert 的提交；生产 UI 接线（D04）、旧消费者拆除（D04B）与旧命令删除（D06）各自闭合。

## 当前实施边界

D03 为 PARTIAL，不以 native 命令存在判定整任务完成。已实现生成 protobuf
bytes IPC、DEVICE/FIND/MESSAGE Submit keyset 分页、消息/会话 RRF 建议、
按窗口/账号/request ID 的真实取消，以及 session revision/Engine 身份发布
围栏。其他 intent/kind/scope 明确失败；HTTP gateway 无调用者身份，三个
私有命令明确拒绝，不能复用共享登录会话冒充鉴权。

完整混合检索、统一 MessageSearchPort 注入、全部来源的 coverage 生命周期、
锁定和慢源产品 Journey 尚未证明。HTTP 私有命令拒绝是安全边界与原注册
目标的显式偏离；后续接线应使用已鉴权 native 窗口。
