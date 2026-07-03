---
name: "pt-architecture-execution-methodology"
description: "将架构设计拆解为可落地执行计划与成长评价体系。Invoke when doing architecture landing, execution planning, domain decomposition, or migration design."
---

# Architecture Execution Methodology

## Purpose
- 将“架构想法”转化为“可落地的执行计划、迁移路径、验收标准与成长评估体系”。
- 避免按页面、接口、人头或零散模块拆任务，导致架构文档无法指导真实实施。
- 适用于需要同时回答“怎么做”“为什么这么拆”“如何验证成效”的架构设计场景。

## Invoke When
- 需要做架构落地设计，而不是只做概念分析。
- 需要给出执行计划、迁移计划、分领域任务拆解。
- 需要将现有系统升级为新的领域模型，如 `ai_chat -> agent`。
- 需要判断一个能力体系是否真的形成闭环并可验证成长。
- 需要给 `docs/architecture/*` 或相似架构目录编写正式规格与实施文档。

## Core Principle
- 先拆领域责任，再串执行闭环，再排依赖顺序，最后定义可验证交付。
- 任何执行计划都必须能回答：
  - 为什么这样拆。
  - 谁依赖谁。
  - 每一块交付什么。
  - 如何判断这块真的成功。

## Method

### Step 1. Define the Real Upgrade Goal
- 先界定本次设计到底是在：
  - 新建能力
  - 存量升级
  - 领域重命名
  - 架构迁移
- 明确“目标不是字符串替换，而是领域升级”这类关键判断。
- 输出：
  - 背景
  - 当前问题
  - 目标定义
  - 非目标

### Step 2. Identify Domain Responsibilities
- 优先按领域责任拆，不按页面或接口拆。
- 识别最小且不可混淆的主责任域。
- 常见判断方法：
  - 谁提供上下文
  - 谁执行主链路
  - 谁产出长期资产
  - 谁判定资产是否值得沉淀
  - 谁评价系统是否真的变好
- 输出：
  - 领域清单
  - 每个领域的职责边界
  - 领域间协作关系

### Step 3. Rebuild the Turn Lifecycle
- 用一次完整执行生命周期校验领域拆分是否成立。
- 推荐从以下链路推演：
  - 输入
  - 上下文装配
  - memory 检索
  - skill 路由
  - 执行
  - trace
  - review
  - promote
  - growth
- 如果某个领域无法在闭环中找到位置，说明拆分有问题。
- 输出：
  - 标准时序
  - 最小执行单元
  - 闭环阶段映射

### Step 4. Sort by Dependency, Not by Excitement
- 实施顺序必须由依赖拓扑决定，而不是由“哪个模块最酷”决定。
- 典型顺序：
  - 底座上下文
  - 主执行链
  - review 判定器
  - 资产层
  - growth 度量层
- 输出：
  - 依赖关系
  - 分阶段路线
  - 每阶段风险

### Step 5. Define Deliverables Per Domain
- 每个领域必须产物化，不能只写目标。
- 每个领域文档至少包含：
  - 领域范围
  - 当前存量
  - 目标产物
  - 执行步骤
  - 验收标准
- 产物示例：
  - 新目录结构
  - 核心服务
  - 协议对象
  - 数据表
  - 兼容层
  - Dashboard 指标

### Step 6. Design the Evaluation System
- 所有架构落地都要定义“怎么证明它真的成功了”。
- 如果是 Agent、Memory、Skill、Review 一类系统，必须区分：
  - 有资产沉淀
  - 真实成长
  - 错误成长
- 推荐按四层评价：
  - 资产层
  - 行为层
  - 对照层
  - 长期层
- 输出：
  - growth 指标
  - 反指标
  - 治理动作
  - 实验与回归方法

### Step 7. Cover the Impact Surface
- 存量升级类需求必须覆盖所有受影响层：
  - 后端子服务
  - 协议与生成代码
  - 桥接层
  - 前端 API
  - 页面与控制台
  - 日志、监控、Dashboard
  - 术语与文档
- 输出：
  - 影响面清单
  - 兼容策略
  - 切换顺序

## Execution Plan Writing Standard
- 架构文档放在 `docs/architecture/<domain>/`。
- 执行计划单独建目录，如 `execution-plans/`。
- 执行计划按领域分目录，不按 phase 直接平铺。
- 文件名统一使用：`日期-需求名.md`。
- 优先让“领域稳定、阶段可演进”，而不是“阶段固定、领域被打碎”。

## Acceptance Checklist
- 是否先定义了真实升级目标，而不是直接开始 rename。
- 是否按领域而非页面拆分。
- 是否给出了完整执行闭环。
- 是否按依赖关系排了实施顺序。
- 是否每个领域都有明确交付物和验收标准。
- 是否有成长或成效的评估方法。
- 是否覆盖了存量系统的组件影响面与兼容策略。

## Anti-Patterns
- 只按页面或前后端模块拆任务。
- 只写“要支持 memory / skill”，不写谁负责 review 与 growth。
- 只列 phase，不写领域边界。
- 只写目标，不写交付物。
- 只写正向指标，不写退化指标。
- 把所有内容堆进一个“大 service”。

## Output Template
- 总览文档：升级背景、目标、命名策略、迁移总览。
- 架构文档：领域模型、目录结构、执行闭环、核心对象。
- 评估文档：成长定义、指标、实验、治理。
- 执行计划：按领域拆分，每个领域一份落地文档。

## Example
- 当需求是“把 `ai_chat` 升级为 `agent` 并落地 memory / skill / review / growth”时：
  - 不先做 rename。
  - 先定义：这是领域升级，不是功能追加。
  - 再拆：`conversation / execution / memory / skill / review / growth / migration`
  - 再排：`conversation -> execution -> review -> memory/skill -> growth`
  - 再落：总览、架构、评估体系、分领域执行计划。
