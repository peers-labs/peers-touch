# Peers-Touch Prompt System

> **Unified Documentation for AI and Developers**  
> Version 2.0.0 | Last Updated: 2025-12-31

---

## 🎯 What is This?

This is the **centralized prompt system** for the Peers-Touch project. It provides:
- **Architectural guidelines** for all platforms (Desktop, Mobile, Station)
- **Coding standards** and best practices
- **Historical context** (why decisions were made)
- **Navigation guides** for AI assistants

---

## 🚀 Quick Start

### For AI Assistants

**ALWAYS start here**: [00-META/INDEX.md](./00-META/INDEX.md)

Then follow the reading strategy based on your task:
- **Desktop work**: Read `10-GLOBAL/` → `21-DESKTOP/`
- **Mobile work**: Read `10-GLOBAL/` → `22-MOBILE/`
- **Station work**: Read `10-GLOBAL/` → `30-STATION/`

### For Developers

1. Read [10-GLOBAL/10-project-identity.md](./10-GLOBAL/10-project-identity.md) to understand what Peers-Touch is
2. Read [10-GLOBAL/11-architecture.md](./10-GLOBAL/11-architecture.md) to understand the system architecture
3. Read your platform-specific base file:
   - Desktop: [20-CLIENT/21-DESKTOP/21.0-base.md](./20-CLIENT/21-DESKTOP/21.0-base.md)
   - Mobile: [20-CLIENT/22-MOBILE/22.0-base.md](./20-CLIENT/22-MOBILE/22.0-base.md)
   - Station: [30-STATION/30-station-base.md](./30-STATION/30-station-base.md)

---

## 📂 Directory Structure

```
.prompts/
├── 00-META/                       # Start here!
│   ├── INDEX.md                   # Navigation guide (READ FIRST)
│   ├── GLOSSARY.md                # Terminology reference
│   └── CHANGELOG.md               # Version history
│
├── 10-GLOBAL/                     # Cross-platform rules
│   ├── 10-project-identity.md     # What is Peers-Touch?
│   ├── 11-architecture.md         # System architecture
│   ├── 12-domain-model.md         # Proto-based models
│   ├── 13-coding-standards.md     # Universal code style
│   └── 14-workflow.md             # Development workflow
│
├── 20-CLIENT/                     # Client platforms
│   ├── 21-DESKTOP/                # Desktop (Flutter + GetX)
│   │   ├── 21.0-base.md           # Base architecture
│   │   ├── 21.1-scaffolding.md    # Directory structure
│   │   ├── 21.2-core-principles.md # Core principles
│   │   ├── 21.9-task-template.md  # Task template
│   │   └── features/              # Feature-specific prompts
│   │       ├── ai-chat.md
│   │       ├── settings.md
│   │       └── profile.md
│   │
│   └── 22-MOBILE/                 # Mobile (Flutter + GetX)
│       ├── 22.0-base.md           # Base architecture
│       ├── 22.1-description.md    # Project description
│       ├── 22.2-ui-skeleton.md    # UI skeleton
│       ├── 22.3-components.md     # Component guidelines
│       ├── 22.4-theme.md          # Theme system
│       ├── 22.5-animation.md      # Animation guidelines
│       └── 22.6-visual.md         # Visual standards
│
├── 30-STATION/                    # Backend (Go)
│   ├── 30-station-base.md         # Base architecture
│   ├── 31-go-standards.md         # Go coding standards
│   └── subsystems/                # Subsystem-specific prompts
│
└── 90-CONTEXT/                    # Historical context
    ├── decisions/                 # Architecture Decision Records (ADRs)
    │   ├── 001-why-getx.md        # Why we chose GetX
    │   ├── 002-no-stateful-widget.md # Why no StatefulWidget
    │   └── 003-proto-as-source.md # Why Proto-first
    └── evolution/                 # Migration guides
```

---

## 🎯 Design Principles

### 1. **Hierarchical Organization**
- **00-**: Meta information (navigation, glossary)
- **10-**: Global rules (apply to all platforms)
- **20-**: Client platforms (Desktop, Mobile)
- **30-**: Station backend
- **90-**: Historical context (ADRs, evolution)

### 2. **Single Entry Point**
- All navigation starts at [00-META/INDEX.md](./00-META/INDEX.md)
- Clear reading priorities (MUST/SHOULD/OPTIONAL)

### 3. **Separation of Concerns**
- **Rules** (what to do) in 10-30 layers
- **Context** (why we do it) in 90 layer

### 4. **AI-Friendly**
- Clear file naming (numbered for priority)
- Explicit reading strategies
- No ambiguity in rules

---

## 📖 Key Documents

### Must Read (Everyone)
1. [INDEX.md](./00-META/INDEX.md) - Navigation guide
2. [10-project-identity.md](./10-GLOBAL/10-project-identity.md) - Project overview
3. [12-domain-model.md](./10-GLOBAL/12-domain-model.md) - Proto system

### Platform-Specific
- **Desktop**: [21.0-base.md](./20-CLIENT/21-DESKTOP/21.0-base.md)
- **Mobile**: [22.0-base.md](./20-CLIENT/22-MOBILE/22.0-base.md)
- **Station**: [30-station-base.md](./30-STATION/30-station-base.md)

### Understanding "Why"
- [001-why-getx.md](./90-CONTEXT/decisions/001-why-getx.md)
- [002-no-stateful-widget.md](./90-CONTEXT/decisions/002-no-stateful-widget.md)
- [003-proto-as-source.md](./90-CONTEXT/decisions/003-proto-as-source.md)

---

## 🔄 Version History

**Current Version**: 2.0.0 (2025-12-31)

### Major Changes in 2.0.0
- ✅ Unified all prompts into `.prompts/` directory
- ✅ Created hierarchical structure (00-, 10-, 20-, 30-, 90-)
- ✅ Added INDEX.md as single entry point
- ✅ Added GLOSSARY.md for terminology
- ✅ Added ADRs to explain design decisions
- ✅ Migrated all Desktop prompts
- ✅ Migrated all Mobile prompts
- ✅ Created Station prompts
- ✅ Updated `.trae/rules/project_rules.md` to point here
- ✅ Removed all old scattered prompt files

See [CHANGELOG.md](./00-META/CHANGELOG.md) for detailed history.

---

## 🤝 Contributing

### Adding New Prompts

1. Determine the correct layer (10/20/30/90)
2. Follow the numbering convention
3. Update [INDEX.md](./00-META/INDEX.md) if navigation changes
4. Update [GLOSSARY.md](./00-META/GLOSSARY.md) if new terms added
5. Update [CHANGELOG.md](./00-META/CHANGELOG.md)

### Updating Existing Prompts

1. Make your changes
2. Update "Last Updated" date
3. Add entry to [CHANGELOG.md](./00-META/CHANGELOG.md)

---

## 📞 Getting Help

- **Can't find what you need?** Check [INDEX.md](./00-META/INDEX.md)
- **Don't understand a term?** Check [GLOSSARY.md](./00-META/GLOSSARY.md)
- **Want to know why?** Check [90-CONTEXT/decisions/](./90-CONTEXT/decisions/)

---

## ⚠️ Important Notes

1. **This is the source of truth** - All other documentation should reference these prompts
2. **Keep it updated** - Outdated prompts are worse than no prompts
3. **Be consistent** - Follow the established patterns
4. **Think of AI** - Write prompts that AI can easily parse and follow

---

*For the complete navigation guide, start at [00-META/INDEX.md](./00-META/INDEX.md)*
