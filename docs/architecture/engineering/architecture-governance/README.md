# 架构模块治理

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-27 | **Updated**: 2026-10-05
> **Owner**: Architecture Team
> **Module**: `docs/architecture/`, `tooling/scripts/`, `tooling/plugins/`

---

## 1. Document Scope

本文档集定义：

- 架构模块内容完整性的机器契约；
- taxonomy index 与嵌套 module root 的机器契约；
- 已知 document collection 与 capability-owning module 的显式分离；
- 模块 owner、代码作用域、契约根和消费方的正向登记；
- 编辑前知识与架构上下文回执；
- Plan、Review 和 CI 的 fail-closed 校验；
- 当前架构文档只描述目标状态的约束。

本文档集不定义：

- 各业务域自身的产品、协议或运行时语义；
- 已删除接口的历史清单；
- Git 历史或外部审计材料的保存方式；
- 具体客户端或 Station 功能实现。

## 2. 背景与问题

现有文档标准主要约束文件形态，内容完整性由方法论文字要求，但 Plan 校验、
编辑 Hook 和 Review 未共享同一份机器契约。结果是文档、实现和验证可以分别
通过，却没有证明 owner、协议、状态、目录和跨运行时影响已经闭合。

本模块把这些要求收敛为正向声明：系统只接受明确登记的当前模块、能力、
依赖和证据入口。已删除概念不进入现行架构词汇，也不作为永久黑名单维护。

## 3. 设计目标

1. 一个 active 架构模块只有一份机器可读声明。
2. 文档必选项由模块特征推导，而不是由作者自由省略。
3. 能力、owner、契约根、消费方和允许依赖均采用正向 allowlist。
4. 未登记或不完整的当前接口在校验边界 fail closed。
5. 编辑前 Hook、Plan 校验和 Review 使用同一解析器与同一摘要。
6. 历史事实留在 Git 历史或外部证据中，不污染当前真源。
7. 分类 README 不取得模块 ownership，module ID 不绑定目录 basename。

## 4. 文档导航

| 文档 | 说明 |
|---|---|
| [design.md](./design.md) | 边界、执行链路和失败语义 |
| [decisions.md](./decisions.md) | 已接受治理决策 |
| [data-model.md](./data-model.md) | 模块声明、上下文回执和校验结果 |
| [module-layout.md](./module-layout.md) | 文档与工具的目标目录 |
| [integration.md](./integration.md) | Plan、Hook、Review、CI 与存量模块接入 |
| [state-machines.md](./state-machines.md) | 全端状态机目录与 owner 索引 |
| [execution-plans/20260927-architecture-module-governance/plan.md](./execution-plans/20260927-architecture-module-governance/plan.md) | 实施 Plan |

## 5. 当前状态

- Architecture：`active`
- Plan：生命周期状态以实施 Plan Package 为准
- Runtime：不适用，全部验证为 source-only
