# Peers-Touch Prompt System Index

> **Navigation Guide for AI and Developers**  
> This is the entry point for understanding how to work with the Peers-Touch codebase.

---

## 🎯 Quick Navigation by Task

| I want to... | Read These Prompts |
|--------------|-------------------|
| **Develop Desktop features** | `10-GLOBAL/10-project-identity.md` → `10-GLOBAL/12-domain-model.md` → `21-DESKTOP/21.0-base.md` → `21-DESKTOP/21.1-scaffolding.md` |
| **Develop Mobile features** | `10-GLOBAL/10-project-identity.md` → `10-GLOBAL/12-domain-model.md` → `22-MOBILE/22.0-base.md` |
| **Work on Backend/Station** | `10-GLOBAL/10-project-identity.md` → `10-GLOBAL/12-domain-model.md` → `30-STATION/30-station-base.md` → `30-STATION/31-go-standards.md` |
| **Understand project architecture** | `10-GLOBAL/11-architecture.md` → `10-GLOBAL/12-domain-model.md` |
| **Add Proto models** | `10-GLOBAL/12-domain-model.md` |
| **Understand design decisions** | `90-CONTEXT/decisions/` |

---

## 📚 Navigation by Role

### Frontend Developer (Client)
**Priority Reading Order:**
1. `10-GLOBAL/10-project-identity.md` - Understand what Peers-Touch is
2. `10-GLOBAL/12-domain-model.md` - Learn the Proto-based model system
3. Choose your platform:
   - **Desktop**: `21-DESKTOP/21.0-base.md` → `21-DESKTOP/21.1-scaffolding.md`
   - **Mobile**: `22-MOBILE/22.0-base.md`
4. `10-GLOBAL/13-coding-standards.md` - Dart/Flutter code style

### Backend Developer (Station)
**Priority Reading Order:**
1. `10-GLOBAL/10-project-identity.md`
2. `10-GLOBAL/11-architecture.md` - Three-tier collaboration
3. `10-GLOBAL/12-domain-model.md` - Proto models
4. `30-STATION/30-station-base.md`
5. `30-STATION/31-go-standards.md`

### Architect / Tech Lead
**Priority Reading Order:**
1. `10-GLOBAL/11-architecture.md`
2. `90-CONTEXT/decisions/` - All ADRs
3. Platform-specific base files

---

## 🗂️ Directory Structure

```
.prompts/
├── 00-META/                       # Meta Information
│   ├── INDEX.md                   # 👈 You are here
│   ├── GLOSSARY.md                # Terminology reference
│   └── CHANGELOG.md               # Prompt evolution history
│
├── 10-GLOBAL/                     # Cross-platform rules (READ FIRST)
│   ├── 10-project-identity.md     # What is Peers-Touch?
│   ├── 11-architecture.md         # Overall architecture
│   ├── 12-domain-model.md         # Proto-based domain models
│   ├── 13-coding-standards.md     # Universal coding standards
│   └── 14-workflow.md             # Development workflow
│
├── 20-CLIENT/                     # Client-side prompts
│   ├── 21-DESKTOP/                # Desktop (Flutter + GetX)
│   │   ├── 21.0-base.md           # Base architecture
│   │   ├── 21.1-scaffolding.md    # Directory structure
│   │   ├── 21.2-ui-system.md      # UI component system
│   │   ├── 21.9-task-template.md  # Task template
│   │   └── features/              # Feature-specific prompts
│   │       ├── ai-chat.md
│   │       ├── settings.md
│   │       └── profile.md
│   │
│   └── 22-MOBILE/                 # Mobile (Flutter + GetX)
│       ├── 22.0-base.md           # Base architecture
│       ├── 22.1-ui-skeleton.md    # UI skeleton
│       ├── 22.2-components.md     # Component guidelines
│       ├── 22.3-theme.md          # Theme system
│       ├── 22.4-animation.md      # Animation guidelines
│       └── 22.5-visual.md         # Visual standards
│
├── 30-STATION/                    # Backend/Station prompts
│   ├── 30-station-base.md         # Base architecture
│   ├── 31-go-standards.md         # Go coding standards
│   ├── 32-api-design.md           # API design principles
│   └── subsystems/                # Subsystem-specific
│       ├── auth.md
│       ├── posting.md
│       └── activitypub.md
│
└── 90-CONTEXT/                    # Historical context
    ├── decisions/                 # Architecture Decision Records
    │   ├── 001-why-getx.md
    │   ├── 002-no-stateful-widget.md
    │   └── 003-proto-as-source.md
    └── evolution/                 # Migration guides
        └── v1-to-v2-migration.md
```

---

## 🤖 AI Reading Strategy

### When working on Desktop code:
```
MUST READ (in order):
1. 10-GLOBAL/10-project-identity.md
2. 10-GLOBAL/12-domain-model.md
3. 21-DESKTOP/21.0-base.md
4. 21-DESKTOP/21.1-scaffolding.md

SHOULD READ:
- 10-GLOBAL/13-coding-standards.md
- 21-DESKTOP/21.2-ui-system.md
- Relevant feature prompt in 21-DESKTOP/features/

OPTIONAL:
- 90-CONTEXT/decisions/ (for understanding "why")
```

### When working on Mobile code:
```
MUST READ (in order):
1. 10-GLOBAL/10-project-identity.md
2. 10-GLOBAL/12-domain-model.md
3. 22-MOBILE/22.0-base.md

SHOULD READ:
- 10-GLOBAL/13-coding-standards.md
- 22-MOBILE/22.1-ui-skeleton.md through 22.5-visual.md
```

### When working on Station code:
```
MUST READ (in order):
1. 10-GLOBAL/10-project-identity.md
2. 10-GLOBAL/11-architecture.md
3. 10-GLOBAL/12-domain-model.md
4. 30-STATION/30-station-base.md
5. 30-STATION/31-go-standards.md

SHOULD READ:
- Relevant subsystem prompt in 30-STATION/subsystems/
```

---

## 📖 Terminology

For definitions of key terms (ActorID, Federation, Proto, etc.), see [GLOSSARY.md](./GLOSSARY.md).

---

## 📝 Prompt Versioning

This prompt system follows semantic versioning. See [CHANGELOG.md](./CHANGELOG.md) for the evolution history.

**Current Version**: 2.0.0 (2025-12-31)

---

## 🔄 Maintenance

- **Owner**: Project Architecture Team
- **Last Updated**: 2025-12-31
- **Review Cycle**: Quarterly or on major architecture changes

---

## ⚠️ Important Notes

1. **GLOBAL prompts are the foundation** - Always read them first
2. **Platform-specific prompts inherit from GLOBAL** - Don't duplicate rules
3. **Feature prompts are optional** - Only read when working on that specific feature
4. **ADRs explain the "why"** - Read them to understand design rationale

---

*For questions or suggestions about this prompt system, contact the architecture team.*
