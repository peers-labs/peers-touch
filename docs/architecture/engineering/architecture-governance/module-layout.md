# 架构模块治理 - 模块目录结构

> **Status**: active
> **Version**: v1.4
> **Created**: 2026-09-27 | **Updated**: 2026-10-20
> **Owner**: Architecture Team

---

## 1. 目录树

```text
docs/architecture/
├── README.md
├── architecture.md
├── system-context.diagram.json
├── system-context.svg
├── architecture.diagram.json
├── architecture.svg
├── runtime-topology.diagram.json
├── runtime-topology.svg
├── authority-map.diagram.json
├── authority-map.svg
├── journey-*.diagram.json
├── journey-*.svg
├── engineering-control-plane.diagram.json
├── engineering-control-plane.svg
└── references.md

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
├── diagram-render.mjs
├── diagram-render.test.mjs
├── document-index.mjs
├── document-index.test.mjs
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
| `docs/architecture/architecture.md` | 项目级架构叙事与 canonical SVG 入口 |
| `docs/architecture/*.diagram.json` | 项目级 Diagram ID、viewpoint、layout-specific scene 和单语义连线 spec |
| `docs/architecture/*.svg` | 统一 renderer 生成的项目级 canonical 图 |
| `docs/architecture/README.md` | Registry 驱动的模块索引与架构导航 |
| `docs/architecture/references.md` | 从 Diagram spec、SVG 资产与 Markdown link graph 生成的反向引用 |
| `architecture-modules.json` | taxonomy indexes、active 模块、路径、能力、证据与有界 reuse divergence 的正向登记 |
| `diagram-render.mjs` | 按 viewpoint 独立语法生成统一暗色架构 SVG，校验边界、重叠、引用、文本容量与正交路由并提供 `--check` |
| `diagram-render.test.mjs` | 校验 spec discovery、旧通用卡片 schema 已删除、viewpoint 视觉结构与已提交 SVG 新鲜度 |
| `document-index.mjs` | 从 module registry、Diagram spec 和 SVG 引用生成模块索引与反向引用 |
| `document-index.test.mjs` | 证明已提交索引与当前 registry、diagram marker 和引用图一致 |
| `module-governance.mjs` | 唯一 registry parser、validator、matcher、cross-client shared dependency collector 和 receipt renderer |
| `module-governance.test.mjs` | schema、文档推导、索引、能力引用、复用登记和路径匹配测试 |
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
