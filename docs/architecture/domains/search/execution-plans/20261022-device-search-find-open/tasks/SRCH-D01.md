# SRCH-D01：Search 合同与共享查询核心

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SRCH-20261022",
  "taskId": "SRCH-D01",
  "workstreamId": "CONTRACT-CORE",
  "title": "建立 search.proto 与纯机制 packages/search-core（分词/AST/RRF/cursor/取消/ports）",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "srch-j01-contract-core",
  "closureId": "srch-d01-contract-core",
  "runtimeClass": "source-only",
  "writeSet": [
    "model/domain/search/search.proto",
    "model/build.sh",
    "packages/search-core"
  ],
  "readSet": [
    "model",
    "packages/messaging-core",
    "apps/desktop/src-tauri/Cargo.toml",
    "docs/client/common/ui-identity",
    "docs/architecture/domains/search"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 600,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "srch-d01-proto-build",
      "command": "./model/build.sh",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d01-core-unit",
      "command": "cargo test --manifest-path packages/search-core/Cargo.toml",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d01-tokenizer-contract",
      "command": "cargo test --manifest-path packages/search-core/Cargo.toml tokenizer_contract",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "srch-d01-module-governance",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "srch-d01-core-boundary",
      "command": "bash -lc '! rg -n \"reqwest|libp2p|tauri|rusqlite\" packages/search-core/Cargo.toml packages/search-core/src'",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "model/domain/search/search.proto 定义 QueryIntent、Kind filter、Scope（仅 device 与 closed-domain 枚举）、ResultItem、ResourceRef、Cursor、Coverage/SourceState、SCOPE_OUTSIDE_SEARCH_DOMAIN 错误；不出现 web/os/connector scope",
    "最小修改 model/build.sh：现有 protoc-gen-go 对每个 proto 无条件执行，必须让无 go_package 的 proto 跳过 Go 生成（Station 计划再启用）；Desktop TS 产物正常生成且不手改，TS 产物可作为 Desktop 侧唯一 DTO 来源（实际消费在 SRCH-D03/D04），生成物按现有 gitignore 策略处理不写入 apps/station",
    "packages/search-core 提供确定性分词（CJK 二元接续、拉丁/数字词、大小写归一、query/索引对称）、查询 AST 与 MATCH 表达式、RRF 融合、opaque cursor、取消 token；不依赖 Tauri、rusqlite、Station transport 或 UI",
    "ports 仅 trait：MessageSearchPort（跨会话/单会话、分页、取消）、FunctionCatalogPort；不提供具体实现",
    "分词单测覆盖可行性报告中的中文短词反例（二字词：目录/协议/权限）、中英混合、ID/handle 与附件名语料；query 分词与索引分词共用同一函数",
    "core-boundary 机械检查证明 Cargo.toml 与 src 不出现 reqwest/libp2p/tauri/rusqlite；共享包治理登记（consumers/reuseLayer/allowedDependencies）在 SRCH-D03 真实 Cargo 依赖出现时完成",
    "本任务不接入任何生产消费者；除测试与生成产物外无调用方"
  ],
  "failureBehavior": [
    "不引入自定义 SQLite 分词器编译依赖；分词策略必须是纯文本预处理，可在 SQLCipher FTS5 unicode61 上工作",
    "不把 Station/联邦语义写进 device-only 枚举；S/F 仅保留为 proto 占位值且本任务不实现",
    "核心不读取消息明文或密钥；语料只通过显式函数参数进入",
    "若 proto 生成路径需要改 build.sh，只做最小登记改动，不重构生成器"
  ],
  "updatedAt": "2026-10-22T15:30:00.000Z"
}
```

## 完整闭环

输入是已确认的 product/design/data-model 合同与可行性证据；输出是一份生成合同加一个可独立单测、尚未接线的纯机制 crate。消费者切换、FTS schema 换代与旧路径删除属于后续 Task，本任务结束时没有两套生产查询 owner 并存。
