# Peers-Touch Prompt System Index

> **Navigation Guide for AI and Developers**  
> This is the entry point for understanding how to work with the Peers-Touch codebase.

---

## 🎯 Quick Navigation by Task

| I want to... | Read These Prompts |
|--------------|-------------------|
| **Develop Desktop features** | `10-GLOBAL/10-project-identity.md` → `10-GLOBAL/12-domain-model.md` → `21-DESKTOP/21.0-base.md` |
| **Develop Mobile features** | `10-GLOBAL/10-project-identity.md` → `10-GLOBAL/12-domain-model.md` → `22-MOBILE/22.0-base.md` |
| **Work on Shared Code** | `20-CLIENT/23-COMMON/23.0-base.md` |
| **Work on Backend/Station** | `10-GLOBAL/10-project-identity.md` → `30-STATION/30-station-base.md` → `30-STATION/32-app-layer.md` |
| **Understand project architecture** | `10-GLOBAL/11-architecture.md` → `10-GLOBAL/12-domain-model.md` |
| **Add Proto models** | `10-GLOBAL/12-domain-model.md` |

---

## 📚 Navigation by Role

### Frontend Developer (Client)
**Priority Reading Order:**
1. `10-GLOBAL/10-project-identity.md` - Understand what Peers-Touch is
2. `10-GLOBAL/12-domain-model.md` - Learn the Proto-based model system
3. **Common Library**: `20-CLIENT/23-COMMON/23.0-base.md`
4. Choose your platform:
   - **Desktop**: `21-DESKTOP/21.0-base.md`
   - **Mobile**: `22-MOBILE/22.0-base.md`

### Backend Developer (Station)
**Priority Reading Order:**
1. `10-GLOBAL/10-project-identity.md`
2. `10-GLOBAL/11-architecture.md`
3. `30-STATION/30-station-base.md`
4. **App Logic**: `30-STATION/32-app-layer.md`
5. **Frame Core**: `30-STATION/33-frame-layer.md`
6. `30-STATION/31-go-standards.md`

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
│   │   ├── ...                    # Other desktop docs
│   │   └── features/              # Feature-specific prompts
│   │
│   ├── 22-MOBILE/                 # Mobile (Flutter + GetX)
│   │   ├── 22.0-base.md           # Base architecture
│   │   └── ...                    # Other mobile docs
│   │
│   └── 23-COMMON/                 # Shared Code (NEW)
│       ├── 23.0-base.md           # Principles for shared code
│       └── 23.1-packages.md       # peers_touch_base & ui details
│
├── 30-STATION/                    # Backend/Station prompts
│   ├── 30-station-base.md         # Base architecture
│   ├── 31-go-standards.md         # Go coding standards
│   ├── 32-app-layer.md            # App/Subserver development (NEW)
│   └── 33-frame-layer.md          # Frame/Core development (NEW)
│
└── 90-CONTEXT/                    # Historical context
    ├── decisions/                 # Architecture Decision Records
    └── ...
```

---

## 🤖 AI Reading Strategy

### When working on Client Common code:
```
MUST READ:
1. 20-CLIENT/23-COMMON/23.0-base.md
2. 20-CLIENT/23-COMMON/23.1-packages.md
```

### When working on Station code:
```
MUST READ (in order):
1. 30-STATION/30-station-base.md
2. 30-STATION/32-app-layer.md (if working on business logic)
3. 30-STATION/33-frame-layer.md (if working on core infra)
4. 30-STATION/31-go-standards.md
```

---

## 📝 Prompt Versioning

**Current Version**: 2.1.0 (2025-01-02) - Added Common and Station Layer docs.

---

*For questions or suggestions about this prompt system, contact the architecture team.*
