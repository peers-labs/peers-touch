# Agent Memory Adoption Plan

## 1. 文档定位

本文是 `../agent-memory-architecture.md` 的执行计划附属文档。

本文记录：

- 实施阶段
- 主要交付物
- 落地顺序

架构真源以：

- `../agent-memory-architecture.md`

为准。

## 2. 实施路线

### Phase 1：基础能力（Station + Proto）
1. 创建 `model/domain/memory/` Proto 定义
2. 实现 Station 侧记忆能力骨架（plugin + options + handler + service + db）
3. 实现记忆 CRUD + 搜索 API
4. 实现 Embedding 集成（复用 Provider 体系）

### Phase 2：Agent 集成（核心价值）
1. 实现 Extraction Service（从对话提取记忆）
2. 实现 Retrieval Service（混合检索）
3. 实现 Injection Service（注入 Agent 上下文）
4. 集成到 Agent turn/completion 流程

### Phase 3：Desktop 对接
1. Desktop Rust 层改为调用 Station API（替换 stub）
2. 前端对接真实数据（保持现有 UI）
3. Memory 配置同步到 Station

### Phase 4：生命周期 + 多端同步
1. 实现时间衰减 + 合并 + 归档定时任务
2. 实现 Persona 自动生成
3. SSE 事件推送
4. Mobile 端适配
