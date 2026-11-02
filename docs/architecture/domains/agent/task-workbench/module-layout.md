# 模块归属

> **Status**: accepted（Owner 2026-11-02 确认；实施承接：TW-20261102）
> **Version**: v2.0
> **Created / Updated**: 2026-11-01
> **Owner**: Peers-Touch Agent Team

本次演进现有Agent模块，不创建新的全栈workbench目录。新增小型service或component只有在已有单元不能保持单一职责时才建立，名字按真实职责确定。

- `model/domain/agent/`：TaskRun/Conversation归属、任务状态、资源版本、检查和接受、能力及控制事件。通用Task/Artifact核心从协作专属语义中分离，协作合同消费相同核心；不留重复消息类型或重导出别名。Agent与Social Messaging的不同业务合同不互相吞并。
- `apps/station/app/subserver/agent/domain/`：目标、上下文、资源和状态不变量。
- `apps/station/app/subserver/agent/service/`：沿ChatTaskService、ConversationService、TurnService、ToolDispatch、TaskEventWriter、Memory及Profile Owner实现；handler只做协议、授权入口与错误映射。
- `apps/station/app/subserver/agent/service/externalruntime/`与ExternalRuntimeService：外部宿主绑定、设备路由、Peers命令及宿主回执归并。替换当前一次性进程管理在持久宿主范围的职责；实际本机进程由Native worker管理。Peers任务真源不搬到外部宿主，不在此复制Memory或成果数据库。
- `apps/station/app/subserver/agent/infrastructure/persistence/`：现有任务、事件、资源和Memory存储及schema迁移；强约束与事务保障身份/版本一致。
- `apps/desktop/src-tauri/src/application/desktop_executor_worker/`：保留设备能力执行、租约、回执账本和资源registry；新增职责限定为Codex宿主supervisor/协议转换，持实际进程与双向连接、RPC关联、host/connection epoch、有界输出缓存。文件/进程/浏览器适配沿已有工具/MCP/OAuth边界接入，不在Page直调，不复制Station队列或Task状态机。
- `apps/desktop/src/runtimes/`：任务事件订阅、同步、来源目录及身份teardown。页面render不启动轮询、安装SDK或决定业务状态。
- 现有Capability authority/readiness、McpServerService、Connector/Skill Owner及Provisioning：插件包组件安装/配置/登录/版本/角色binding/目录/实际调用/撤权，Browser工具就绪；不复制授权注册表。
- `apps/desktop/src/store/`：现有聊天与任务投影按目标语义收口，保留单一可写投影；本机草稿、阅读选择、版本编辑由既有缓存层持久化。
- 活动Item分组、分页修复、手动展开/滚动/选区、query与后台request定位：Runtime归并、Store/缓存持交互投影、Workbench/Portal呈现；只在当前对象变更时更新。
- `apps/desktop/src/components/agent/workbench/`：沿AgentRail/TopicRail/ConversationRail拆分视图，Task list替换Topic职责后旧写路径删除。
- `apps/desktop/src/components/portal/`：同一授权资源reader、工具栏、版本/来源定位和反馈；消息、文件树、Search和通知使用同一opener。
- `apps/desktop/src/pages/AgentProfilePage`及既有能力管理：身份、SOUL/AGENTS、extensions与角色记忆；个人设置留全局Settings。
- `packages/prototypes/`：保留已认可的交互合同及原型证据。模拟逻辑仅属于原型，不随生产构建引入。

阅读层复用当前Markdown、代码与附件组件，缺少的Office/大文件格式优先集成成熟viewer，按实际支持范围验证。不能继续引用当前生产树不存在的 `client-chat-core/src/attachmentPreview.ts`；新增依赖前需要核对现有包、运行平台、授权和性能成本。

Codex以获验证的外部二进制运行，源schema固定版本，仅在适配器内部转换为Model生成的Peers命令/事件；跨端业务不直接泄漏Codex专属types。TS exec SDK不承担持续协议，Rust app-server-client不默认整包嵌入。Dashboard管理安装/命名配置/登录/分配，worker报告实际设备就绪，不增加Desktop供应商管理入口。

MemoryService/prompt assembly/persistence原位扩展来源版本、候选job、租约提交、确认选集和快照；Codex独立Memory读写关闭。Artifact/Blob Owner扩展不可变成果版本与检查，不引入Codex attachment数据库作第二资源真源。

本目录即正式架构源；Modern Chat Agent 既有根文档（`docs/architecture/domains/agent/modern-chat-agent/`）、Memory 与 Provider Owner 文档、Desktop runtime/UI 规范及模块正向 registry 在对应切片实施时原位更新。原型树目录组织不同，生产只合入本次合同和交互内容，不迁入整棵旧文档结构。
