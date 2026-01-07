# Peers-Touch Project Rules

> **⚠️ IMPORTANT: This file now points to the new unified prompt system.**  
> **All detailed prompts have been moved to `.prompts/`**

---

## 🎯 Quick Start for AI

**ALWAYS READ THESE FIRST (in order):**

1. **[.prompts/00-META/INDEX.md](../../.prompts/00-META/INDEX.md)** - Navigation guide
2. **[.prompts/10-GLOBAL/10-project-identity.md](../../.prompts/10-GLOBAL/10-project-identity.md)** - What is Peers-Touch?
3. **[.prompts/10-GLOBAL/12-domain-model.md](../../.prompts/10-GLOBAL/12-domain-model.md)** - Proto-based models

**Then read based on your task:**
- **Desktop work**: [.prompts/20-CLIENT/21-DESKTOP/21.0-base.md](../../.prompts/20-CLIENT/21-DESKTOP/21.0-base.md)
- **Mobile work**: [.prompts/20-CLIENT/22-MOBILE/22.0-base.md](../../.prompts/20-CLIENT/22-MOBILE/22.0-base.md)
- **Station work**: [.prompts/30-STATION/30-station-base.md](../../.prompts/30-STATION/30-station-base.md)

---

## 📚 Full Prompt System

All prompts are now organized in `.prompts/` with the following structure:

```
.prompts/
├── 00-META/           # Navigation and meta info
├── 10-GLOBAL/         # Cross-platform rules (READ FIRST)
├── 20-CLIENT/         # Client-side prompts
│   ├── 21-DESKTOP/    # Desktop-specific
│   └── 22-MOBILE/     # Mobile-specific
├── 30-STATION/        # Backend prompts
└── 90-CONTEXT/        # Historical context & ADRs
```

**See [.prompts/00-META/INDEX.md](../../.prompts/00-META/INDEX.md) for complete navigation.**

---

## 🤖 AI Assistant Behavior

**You are a professional software engineer, not a script kiddie.**

### Professional Standards

1. **Use Proper Logging**:
   - Dart/Flutter: `LoggingService.debug()`, `.info()`, `.warning()`, `.error()`
   - Go: `logger.Debug(ctx, ...)`, `.Info()`, `.Warn()`, `.Error()`
   - **NEVER** use `print()`, `println()`, or `fmt.Println()` for debugging

2. **Follow Architecture**:
   - Understand the system design before making changes
   - Don't patch problems - fix root causes
   - Respect separation of concerns (auth in auth module, not scattered)

3. **Write Production Code**:
   - Clean, maintainable, and well-structured
   - Follow project conventions consistently
   - Add proper error handling and logging

4. **Think Before Acting**:
   - Analyze the problem from architectural perspective
   - Consider impact on other components
   - Explain your reasoning clearly

---

## 🔑 Core Principles (Quick Reference)

### Universal Rules (All Platforms)

1. **Proto-First**: All models MUST be defined in `.proto` files
   - Location: `model/domain/*.proto`
   - Generated for Dart (client) and Go (station)
   - **NEVER** create manual model classes

2. **Package Imports Only**: No relative imports
   ```dart
   // ✅ CORRECT
   import 'package:peers_touch_desktop/features/home/view/home_page.dart';
   
   // ❌ WRONG
   import '../features/home/view/home_page.dart';
   ```

3. **Markdown Language Rule**: 
   - English by default
   - Chinese if filename contains `.zh.`

---

### Dart/Flutter Rules (Client)

1. **GetX Mandatory**: All state management via GetX
   - Controllers extend `GetxController`
   - State uses Rx variables (`.obs`)
   - DI via `Get.put()` / `Get.lazyPut()`

2. **No StatefulWidget**: STRICTLY FORBIDDEN
   - Use `StatelessWidget` + `GetxController`
   - See [ADR-002](../../.prompts/90-CONTEXT/decisions/002-no-stateful-widget.md)

3. **Import Ordering**:
   ```dart
   // 1. Dart SDK
   import 'dart:async';
   
   // 2. Flutter
   import 'package:flutter/material.dart';
   
   // 3. Third-party
   import 'package:get/get.dart';
   
   // 4. Project
   import 'package:peers_touch_base/...';
   ```

4. **Code Style**:
   - Single quotes for strings
   - Use `final` for non-reassigned variables
   - Always use braces for flow control
   - Use `LoggingService` instead of `print()`
   - Use `Color.withValues(alpha: x)` not `withOpacity(x)`

5. **Lint Config**: `client/analysis_options.yaml`

---

### Go Rules (Station)

1. **Follow gofmt**: All code must pass `gofmt`
2. **Proto Structs**: Use Proto-generated models
3. **Error Handling**: Always check errors
4. **Context Everywhere**: Pass `context.Context`
5. **Structured Logging**: Use logging framework

**See [.prompts/30-STATION/31-go-standards.md](../../.prompts/30-STATION/31-go-standards.md) for details.**

---

## 🚫 Absolute Prohibitions

These are **NON-NEGOTIABLE** across all platforms:

1. ❌ **No StatefulWidget** (use GetX Controllers)
2. ❌ **No Relative Imports** (use package imports)
3. ❌ **No Manual Models** (use Proto-generated)
4. ❌ **No Hardcoded Strings** (use i18n)
5. ❌ **No Direct Dio Usage** (use HttpService)
6. ❌ **No print()/println()** (use LoggingService for Dart, logger for Go)

---

## 📖 Terminology

For definitions of key terms, see [.prompts/00-META/GLOSSARY.md](../../.prompts/00-META/GLOSSARY.md).

Key terms:
- **Actor**: Federated user identity
- **Station**: Backend server instance
- **Proto**: Protocol Buffers (model definitions)
- **GetX**: State management framework
- **Binding**: GetX dependency injection
- **Feature Module**: Self-contained business module

---

## 🎓 Learning Path

**New to Peers-Touch?** Follow this order:

1. [Project Identity](../../.prompts/10-GLOBAL/10-project-identity.md) - What is this project?
2. [Architecture](../../.prompts/10-GLOBAL/11-architecture.md) - How does it work?
3. [Domain Models](../../.prompts/10-GLOBAL/12-domain-model.md) - Proto system
4. [Coding Standards](../../.prompts/10-GLOBAL/13-coding-standards.md) - Code style
5. Platform-specific base file (21.0, 22.0, or 30.0)

---

## 🔄 Maintenance

- **Prompt Version**: 2.0.0 (2025-12-31)
- **Last Updated**: 2025-12-31
- **Changelog**: [.prompts/00-META/CHANGELOG.md](../../.prompts/00-META/CHANGELOG.md)

---

## ⚠️ Migration Notice

**Old prompt locations** (deprecated):
- ~~`client/desktop/PROMPTs/`~~ → `.prompts/20-CLIENT/21-DESKTOP/`
- ~~`client/mobile/PROMPTs/`~~ → `.prompts/20-CLIENT/22-MOBILE/`
- ~~`station/GO_FORMAT_SPEC.zh.md`~~ → `.prompts/30-STATION/31-go-standards.md`

**All old files have been removed. Use the new `.prompts/` system.**

---

*For complete documentation, start at [.prompts/00-META/INDEX.md](../../.prompts/00-META/INDEX.md)*
