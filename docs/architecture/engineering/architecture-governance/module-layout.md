# 架构模块治理 - 模块目录结构

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-27 | **Updated**: 2026-10-05
> **Owner**: Architecture Team

---

## 1. 目录树

```text
docs/architecture/engineering/architecture-governance/
├── README.md
├── design.md
├── decisions.md
├── data-model.md
├── module-layout.md
├── integration.md
├── architecture-modules.json
└── execution-plans/
    └── 20260927-architecture-module-governance/

tooling/scripts/architecture/
├── module-governance.mjs
└── module-governance.test.mjs

tooling/scripts/plan/
└── plan-package.mjs

tooling/scripts/review/
└── knowledge-match.sh

tooling/scripts/local-dev/
├── workflow-kernel.mjs
└── workflow-host-adapters.mjs

tooling/plugins/pt-ew-plugin/
└── scripts/
    └── hook-entry.mjs

tooling/scripts/
├── agent-integration-audit.py
└── agent-integration-control.py

tooling/skills/
├── pt-architecture-design-methodology/
├── pt-github-review/
└── pt-plan-and-document/
```

## 2. 文件职责

| 路径 | 职责 |
|---|---|
| `architecture-modules.json` | taxonomy indexes、active 模块、路径、能力与证据的正向登记 |
| `module-governance.mjs` | 唯一 registry parser、validator、matcher 和 receipt renderer |
| `module-governance.test.mjs` | schema、文档推导、索引、能力引用和路径匹配测试 |
| `plan-package.mjs` | 对已登记 architecture sources 调用共享校验 |
| `knowledge-match.sh` | 对 changed paths 调用共享校验并保留 knowledge 新鲜度检查 |
| `workflow-kernel.mjs` | 在写入授权前请求 Context Receipt |
| `workflow-host-adapters.mjs` | 将已判定的 allow 与只读 context 转成宿主响应 |
| `hook-entry.mjs` | 宿主输入输出适配，不复制治理规则 |
| `agent-integration-audit.py` | 将共享 parser 纳入安装完整性审计 |
| `agent-integration-control.py` | 将共享 parser 纳入安装源目录摘要 |
| 架构、计划与 Review Skills | 要求 active 模块登记正向投影并在评审时执行共享校验 |

## 3. 依赖关系

```text
architecture documents
       |
       v
architecture-modules.json
       |
       v
module-governance.mjs
  |          |          |
  v          v          v
Hook       Plan       Review/CI
```

依赖方向固定：

- 宿主 adapter 依赖 workflow kernel；
- workflow kernel、Plan 和 Review 依赖共享 parser；
- parser 只读取仓库真源；
- 文档和 registry 不依赖工具实现；
- 业务模块不依赖治理工具。
