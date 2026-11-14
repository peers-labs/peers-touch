# 持续任务能力 — 复用与清理边界

状态：accepted（Owner 2026-11-02 确认）；生产迁移按 TW-20261102 执行计划切片执行。最终目标是一套有效入口、数据和消费链；不得删除用户历史以换取“无遗产”。

## 保留并扩展的已有责任

**I01 导航与任务投影**：实际生产页面是 `apps/desktop/src/pages/AgentChatPage.tsx`，组合 `components/agent/workbench/AgentWorkbench.tsx`，并有 `pages/AgentChatPageContainer.tsx`。沿 AgentRail/TopicRail/ConversationRail 与 `store/chat.ts` 扩展状态、跨角色筛选、归档和结果关系。禁止引用不存在的 AgentPage 或另建会话真源。

**I02 Profile**：保留身份、头像、独立 SOUL/AGENTS 和 extensions。清理无人消费开关与错误恢复入口；角色停用/删除历史分别处理。新轮规则版本与执行消费者同次接线。

**I03 Portal/文件**：原位扩展 `PortalPanel` 和 `ArtifactDetailView`，接 `packages/client-chat-core/src/attachmentPreview.ts`，统一消息、附件、Search、进度的入口。绑定当前任务/Turn/版本/权限后删除阻断 Thread 的过滤特例与重复 viewer 包装；不能只删过滤造成跨任务泄漏。

**I04 执行宿主**：沿 external runtime/现有 session 恢复与队列接完整事件和双向控制。删除对 command/file_change/todo 的有损投影及错把单次输入当持续交互的路径；保留确属批作业的单次语义。成熟协议/组件优先，不自研第二套通用宿主。

**I05 Memory**：沿 MemoryService、prompt assembly、desktop modules/memory 与 Settings 投影，统一提取、确认、检索、纠错、删除、来源失效。新旧检索不得长期双写；迁移索引和派生缓存后删除错误快照回退。生产 memory path 是 `modules/memory.ts`。

**I06 Search/通知**：沿 Search contributor、searchOpeners 和消息定位，统一真实 identity/anchor；删除 toast-only 定位和静态任务索引等不实消费。通知来自实际请求事件，过时请求重开只读。

**I07 模型**：Dashboard 配置、安装、连接和授权保持真源；Desktop 个人默认/会话覆盖保持消费端。删除重复授权缓存权威、客户端凭据回读和 Profile 作为模型恢复目的地的误接线；保留有效用户数据。

**I08 验收/文档**：同次修正无效 Gate、错误路径和旧完成声明；产物/输入/验证依据与当前源绑定。批准后的候选内容原位并入 governing 产品/架构/UI ID/知识/Acceptance 文档，审阅副本不成为长期第二合同。

**I09 原型**：当前 Shell 深链挂载已有 AgentChat/Profile/model/Search/Settings，没有独立 TaskWorkbench/Model/CSS 和伪工具 harness。既有基础的缺口记录明确；新的终态必须在同一组件边界扩展并经 EDX/admission，不能新搭基础库。

**I10 Project/Atelier**：Project 遗留属于删除/清理，不迁移为另一实体；Atelier 不恢复入口、不作为单任务交付依赖，不擅自删除既有编排数据。

## 架构阶段必须补齐

上述是经过源码定位的复用约束，尚不是完整消费者图。独立架构需逐项展开 import/route/API/event/存储/授权/文档/Acceptance 调用方，定义唯一写端、迁移停止条件、数据保留和清理触发器。

落地必须同次完成消费者切换、旧实现删除、合同同步及真实闭环证明。禁止留兼容 re-export、死路由、重复缓存权威、未消费导出或长期双轨；不以“后续迁移剩余部分”宣称完成。
