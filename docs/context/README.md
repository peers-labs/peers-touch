# Context: Historical Context & Evolution

> **Purpose**: This directory contains historical context, implementation reports, evolution history, and architecture decision records (ADRs) for the Peers-Touch project.

---

## 📂 Directory Structure

```
docs/context/
├── decisions/              # Architecture Decision Records (ADRs)
├── implementation-reports/ # Technical implementation reports
├── evolution/              # Development history and daily logs
└── features/               # Feature planning and roadmaps
```

---

## 📋 Contents

### 🏛️ Architecture Decision Records (ADRs)

**Location**: [`decisions/`](./decisions/)

- [ADR-001: Proto-First Domain Modeling](./decisions/001-proto-first-domain-modeling.md)
- [ADR-002: No StatefulWidget Policy](./decisions/002-no-stateful-widget.md)

### 📊 Implementation Reports

**Location**: [`implementation-reports/`](./implementation-reports/)

Technical reports documenting completed feature implementations:

- [**ActivityPub Implementation Report**](./implementation-reports/ACTIVITYPUB_IMPLEMENTATION_REPORT.zh.md) (32KB)
  - ActivityPub 协议集成的完整实现报告
  - 包含联邦化通信、Actor 模型、消息传递等技术细节
  - **Archived**: 2025-01-05 (from project root)

- [**Reply Field Implementation**](./implementation-reports/REPLY_FIELD_IMPLEMENTATION.zh.md) (5.9KB)
  - Reply 字段实现的技术文档
  - 包含数据模型、API 设计、前端集成
  - **Archived**: 2025-01-05 (from project root)

### 📖 Evolution History

**Location**: [`evolution/`](./evolution/)

Development logs and project evolution records:

- [**Development Daily Log**](./evolution/DEVOLOPMENT_DAILY.zh.md) (11KB)
  - 项目开发日志,记录每日进展和决策
  - 包含问题解决过程、技术选型讨论
  - **Archived**: 2025-01-05 (from project root)

### 🚀 Feature Planning & Roadmaps

**Location**: [`features/`](./features/)

Feature planning documents and roadmaps:

- [**Launch Screen Integration Guide**](./features/LAUNCH_SCREEN_INTEGRATION.md) (6.2KB)
  - Launch Screen 功能的集成指南
  - 包含配置步骤、依赖注入、路由设置、API 集成
  - **Archived**: 2025-01-05 (from project root)

- [**Launch Screen Roadmap**](./features/LAUNCH_SCREEN_ROADMAP.md) (22KB)
  - Launch Screen 功能的完整开发路线图
  - 包含 4 个开发阶段:MVP、数据集成、高级功能、插件系统
  - **Archived**: 2025-01-05 (from project root)

- [**Radar Search Next Steps**](./features/RADAR_SEARCH_NEXT_STEPS.md) (2.5KB)
  - Radar Search 功能的下一步开发计划
  - 包含功能增强、性能优化、用户体验改进
  - **Archived**: 2025-01-05 (from project root)

---

## 🔍 Usage Guidelines

### When to Add Documents Here

Add documents to `docs/context/` when:

1. **Implementation Reports**: Feature is completed and stable
2. **Evolution History**: Recording significant development milestones
3. **ADRs**: Making architectural decisions that need documentation
4. **Feature Planning**: Feature has been planned but not yet started, or completed and archived

### When NOT to Add Documents Here

Keep documents in project root when:

1. **Active Development**: Feature is currently being developed
2. **Integration Guides**: Actively referenced by developers
3. **Project Entry Points**: README.md, PROJECT.md

### Archive Metadata

When moving documents here, add metadata at the top:

```markdown
> **Archived**: 2025-01-05  
> **Original Location**: `/PROJECT_ROOT/FILENAME.md`  
> **Reason**: Feature completed and stable
```

---

## 📚 Related Documentation

- [Project Identity](../global/project-identity.md) - What is Peers-Touch?
- [Architecture Overview](../global/architecture.md) - System architecture
- [Prompt System Index](../meta/INDEX.md) - Complete navigation

---

*Last Updated: 2025-01-05*
