# 架构模块治理 - 设计决策

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-27 | **Updated**: 2026-10-05
> **Owner**: Architecture Team

---

## 决策索引

| ID | 决策 | 状态 |
|---|---|---|
| AMG-D01 | 模块文档是真源，机器声明是闭合投影 | accepted |
| AMG-D02 | 当前架构只维护正向 allowlist | accepted |
| AMG-D03 | 模块特征决定必需文档 | accepted |
| AMG-D04 | Hook、Plan 与 Review 共享解析器 | accepted |
| AMG-D05 | 存量模块在首次变更时纳入治理 | accepted |

## AMG-D01：模块文档是真源，机器声明是闭合投影

**Status**: accepted
**Date**: 2026-09-27

### Context

纯文档无法被工具稳定消费，独立配置又容易变成第二套设计。

### Decision

架构文档定义语义；机器声明登记 taxonomy index、已知 document collection、
稳定 module ID、物理 root、能力 ID、依赖和证据引用，并由校验器证明两者一致。
分类 index 与 document collection 都不取得 capability ownership。Module ID
不从目录 basename 推导。

### Rationale

文档适合表达设计语义，机器声明适合表达闭合集合。二者按引用关系组合，既能
自动校验，又不会产生两份可独立演进的架构定义。

### Alternatives Considered

- 只保留人工文档检查：无法稳定接入 Hook、Plan 和 CI。
- 在 registry 复制完整协议：会形成第二语义真源。

### Consequences

声明不能新增文档未接受的 owner、能力或依赖。Document collection 只表达存量
文档 root 已知且可维护，不等同于完整 module registration。物理目录可以按业务域
和平台边界嵌套，而稳定 module ID 不随信息架构调整而变化。

---

## AMG-D02：当前架构只维护正向 allowlist

**Status**: accepted
**Date**: 2026-09-27

### Context

永久维护已删除名称会扩大词汇、理解成本和误用概率。

### Decision

现行文档和治理声明只描述允许存在的当前能力。删除事实由 Git 历史或外部审计
证据承载，不在 active 架构中维护旧名称清单。

### Rationale

完整的当前能力集合可以直接发现未知入口，同时避免把已删除名称继续传播到
文档、测试和实现上下文。

### Alternatives Considered

- 永久维护删除清单：拒绝，因为它会持续扩大过时词汇。
- 只抽查已知入口：拒绝，因为新出现的未知入口可能漏检。

### Consequences

校验器从完整正向 inventory 发现未知接口，不能依赖已知旧名称黑名单。

---

## AMG-D03：模块特征决定必需文档

**Status**: accepted
**Date**: 2026-09-27

### Context

把数据模型、模块布局和集成文档统一标为可选，会允许高风险模块省略关键内容。

### Decision

协议、状态、持久化、ownership、目录布局和跨运行时特征分别触发对应必需文档。

### Rationale

模块风险来自其实际特征，而不是目录规模。机械推导能让同类模块遵守一致的
最低内容契约。

### Alternatives Considered

- 所有文件一律必选：会给简单模块增加无信息文档。
- 完全由作者选择：无法阻止高风险模块省略关键说明。

### Consequences

作者必须显式声明模块特征，validator 负责推导并校验文件集合。

---

## AMG-D04：Hook、Plan 与 Review 共享解析器

**Status**: accepted
**Date**: 2026-09-27

### Context

编辑前提示、计划校验和合并前检查若各自实现规则，会产生不一致。

### Decision

三条链路调用同一治理模块。Hook 生成只读 Context Receipt，Plan 校验绑定
architecture sources，Review/CI 校验 changed paths。

### Rationale

共享解析器让同一输入在编辑前、计划验证和评审阶段得到同一结果，并把规则
漂移集中为一个可测试的实现问题。

### Alternatives Considered

- 三处独立实现：拒绝，因为规则会分叉。
- 只在 CI 校验：拒绝，因为错误发现时间过晚。

### Consequences

共享解析器故障时全部 fail closed；Hook 不获得额外状态写权限。

---

## AMG-D05：存量模块在首次变更时纳入治理

**Status**: accepted
**Date**: 2026-09-27

### Context

一次性要求所有存量模块补齐声明会制造与当前改动无关的大规模迁移。

### Decision

新模块立即登记；现有 active 模块在其文档首次发生变更时必须登记并补齐。
已登记模块始终接受完整校验。

### Rationale

按真实变更逐步扩大覆盖面，可以保持每次改动可审查，同时保证治理覆盖只增不减。

### Alternatives Considered

- 一次性回填全部模块：范围过大且与当前交付无关。
- 永久豁免存量模块：会形成无法收敛的双轨规则。

### Consequences

覆盖面随真实改动单调扩大，不提供绕过已登记模块的降级开关。
