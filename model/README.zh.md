# 模型管理总览（分层/母版/生成）

## 分层与母版文件

| 层级 | 母版文件（单一真源） | 协议/格式 | 生成语言 | 生成工具 | 输出目录建议 | 主要使用方 | 版本策略 | CI 校验 |
|---|---|---|---|---|---|---|---|---|
| API 层 | `proto/touch/v1/*.proto` | Protobuf v3 + gRPC | Go / Dart | `protoc` + `protoc-gen-go` + Dart 插件 | Go: `station/**/proto_gen`；Dart: `client/common/**/lib/generated` | API（Golang）、调用者（Flutter/Dart） | SemVer（`package`/`service` 维度） | 生成一致性、Breaking 检查、IDL-Lint |
| Service 层 | 复用 API 层 `proto` 消息；必要时定义内部 `proto` | Protobuf v3 | Go / Dart | 同上 | 同上 | Service（Golang）、Feature/Domain（Flutter/Dart） | 与 API 同步版本；内部消息标注私有 | API/Service 映射一致性、字段缺失报警 |
| 数据库层 | GORM `struct` + 迁移脚本 | Go Struct + Migration | N/A | N/A（可生成 Schema 文档） | `station/frame/touch/model/db/*.go` | Station（服务端） | 迁移 ID 版本化 | 迁移可回滚、约束完整性、字段与运行期映射 |

说明：
- 跨语言契约以 `proto` 为母版文件（单一真源），保证 Go/Dart 等代码生成一致。
- 数据库层以 GORM 结构体为真源，运行期/协议层通过映射保持字段对齐。

## 协议选择对比与建议

| 协议 | 优势 | 劣势 | 适用范围 | 项目建议 |
|---|---|---|---|---|
| Protobuf/gRPC | 高效二进制、成熟跨语言生成、良好消息演进 | HTTP 文档表达弱、调试需工具 | 内部服务通信、App-Server RPC | 作为主协议与母版文件 |
| OpenAPI/Swagger | REST 友好、文档/Mock 强 | 代码生成跨语言质量不一 | 对外 HTTP API 文档 | 作为补充文档层（从 proto 或 Handler 注释生成） |
| JSON Schema | JSON 校验强、前端友好 | 类型系统弱于 proto | 前端表单/配置校验 | 可选用于前端存储配置 |
| FlatBuffers | 零拷贝、高性能 | 生态相对小 | 极端性能场景 | 暂不采用 |
| GraphQL SDL | 客户端灵活查询 | 服务复杂度高 | BFF 层 | 视需求后续评估 |

## 目录结构与生成产物

| 母版所在 | 语言 | 生成工具 | 目标目录 | 示例路径 |
|---|---|---|---|---|
| `proto/touch/v1` | Go | `protoc-gen-go` / `-go-grpc` | `station/**/proto_gen` | `station/app/subserver/ai-box/proto_gen/v1/.../provider.pb.go` |
| `proto/touch/v1` | Dart | Dart Protobuf 插件 | `client/common/**/lib/generated` | `client/common/peers_touch_model/lib/peers_touch_model.dart`（入口导出，建议新增 `generated/` 目录） |
| DB（GORM） | N/A | N/A | `station/frame/touch/model/db` | `station/frame/touch/model/db/actor.go`、`.../message.go` |

生成与映射建议：
- “同一概念”的跨层映射需在 `MODELS.zh.md` 保持更新（已建立 DB/运行期/协议的 UML）。
- 前端（Flutter/Dart）通过生成的 Dart Protobuf 模型 + 视图模型 Mapper 组合使用。

## 生成流程（示例）

- 维护 IDL：在 `proto/touch/v1` 新增/调整消息与服务。
- 代码生成：统一脚本触发 `protoc`，生成 Go 到 `station/**/proto_gen`，生成 Dart 到 `client/common/**/lib/generated`。
- 一致性校验：
  - IDL 与生成代码版本一致（CI 编译校验）。
  - DB 层与运行期/协议层字段映射一致（CI 对比/快照）。
  - Breaking 变更（字段删除/重命名）需标注迁移与兼容策略。

## 所有权与变更

| 模型 | 所有者 | 变更要求 |
|---|---|---|
| Node/Peer/Address | 网络子系统负责人 | 变更需评审跨层映射与寻址策略 |
| Actor/Profile | 身份与社交子系统负责人 | 评审 ActivityPub/WebFinger/DB 映射 |
| Conversation/Message | 消息子系统负责人 | 评审前后端对称与存储策略 |

## 参考路径

- ActivityPub Actor（协议）：`station/frame/vendors/activitypub/actor.go:1`
- Actor（DB）：`station/frame/touch/model/db/actor.go:10`
- Peer/Address（DB）：`station/frame/touch/model/db/peer.go:5`、`station/frame/touch/model/db/peer_address.go:13`
- Conversation/Message（DB）：`station/frame/touch/model/db/conversation.go:12`、`station/frame/touch/model/db/message.go:12`
- WebFinger（协议/运行期）：`proto/touch/v1/webfinger.proto:58`、`station/frame/touch/model/webfinger.go:47`