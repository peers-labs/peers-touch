# First Principles: Non-Negotiable Rules

> **The Foundation of Peers-Touch Development**  
> These are the rules that MUST NEVER be violated. If you're unsure about anything, come back here.

---

## 🎯 Purpose

This document defines the **hierarchy of rules** for Peers-Touch development, with clear prioritization:

- 🔴 **L0**: Architecture Principles (FORBIDDEN to violate)
- 🚨 **L1**: Mandatory Actions (MUST execute)
- ⭐️ **L2**: Best Practices (STRONGLY recommended)
- 💡 **L3**: Optimization Suggestions (OPTIONAL)

**Rule**: When in conflict, higher level (L0) takes precedence over lower levels.

---

## 🔴 L0: Architecture Principles (FORBIDDEN to Violate)

These are the **non-negotiable** architectural decisions. Violating these will break the project structure.

### 1. Proto-First 🔴

**Rule**: All data models MUST be defined in `.proto` files.

**Why**: 
- Ensures type consistency between Client (Dart) and Station (Go)
- Single source of truth for data structures
- Automatic code generation prevents manual errors

**Locations**:
- Proto files: `model/domain/*.proto`
- Generated Dart: `client/common/peers_touch_base/lib/model/domain/`
- Generated Go: `station/app/model/`

**What's FORBIDDEN**:
```dart
// ❌ WRONG: Manual model class
class User {
  final String id;
  final String name;
  User(this.id, this.name);
}
```

**What's REQUIRED**:
```protobuf
// ✅ CORRECT: Define in .proto
message Actor {
  string id = 1;
  string name = 2;
}
```

**Violation Consequence**:
- Type mismatches between client and server
- Manual maintenance burden
- Breaking changes when API evolves

---

### 2. No StatefulWidget 🔴

**Rule**: Client UI MUST use `StatelessWidget` + `GetxController`. `StatefulWidget` is **STRICTLY FORBIDDEN**.

**Why**:
- Centralized state management
- Easier testing and debugging
- Consistent state update patterns

**See**: [ADR-002](../90-CONTEXT/decisions/002-no-stateful-widget.md)

**What's FORBIDDEN**:
```dart
// ❌ WRONG: StatefulWidget
class MyPage extends StatefulWidget {
  @override
  _MyPageState createState() => _MyPageState();
}
```

**What's REQUIRED**:
```dart
// ✅ CORRECT: StatelessWidget + GetxController
class MyPage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final controller = Get.find<MyController>();
    return Obx(() => Text(controller.data.value));
  }
}
```

**Violation Consequence**:
- State management chaos
- Difficult to track state changes
- Testing becomes impossible

---

### 3. Package Imports Only 🔴

**Rule**: All imports in `lib/` MUST use package imports. Relative imports are **FORBIDDEN**.

**Why**:
- Clear module boundaries
- Prevents circular dependencies
- IDE refactoring support

**What's FORBIDDEN**:
```dart
// ❌ WRONG: Relative import
import '../features/home/view/home_page.dart';
import '../../core/services/api_client.dart';
```

**What's REQUIRED**:
```dart
// ✅ CORRECT: Package import
import 'package:peers_touch_desktop/features/home/view/home_page.dart';
import 'package:peers_touch_desktop/core/services/api_client.dart';
```

**Violation Consequence**:
- Import path chaos
- Refactoring breaks imports
- Circular dependency issues

---

### 4. Station-Desktop 默认 Proto 接口 🔴

**Rule**: Station与Desktop之间的接口**默认全部使用Proto**（application/protobuf），禁止使用JSON。

**Why**:
- Type safety
- Better performance (binary vs text)
- Schema enforcement

**What's FORBIDDEN**:
```go
// ❌ WRONG: JSON endpoint
func HandleRequest(c *gin.Context) {
    var req map[string]interface{}
    c.BindJSON(&req)  // NO!
}
```

**What's REQUIRED**:
```go
// ✅ CORRECT: Proto endpoint
func HandleRequest(c *gin.Context) {
    var req pb.MyRequest
    // Parse protobuf
}
```

**Exception**: JSON is only allowed when **absolutely necessary** (e.g., third-party integration). Must document and plan migration.

---

### 5. No Direct Dio Usage 🔴

**Rule**: Client code MUST use `HttpService` wrapper, NOT Dio directly.

**Why**:
- Centralized request/response handling
- Consistent error handling
- Easy to add interceptors globally

**What's FORBIDDEN**:
```dart
// ❌ WRONG: Direct Dio
final dio = Dio();
final response = await dio.get('/api/user');
```

**What's REQUIRED**:
```dart
// ✅ CORRECT: Use HttpService
final http = Get.find<HttpService>();
final response = await http.get('/api/user');
```

---

### 6. No Hardcoded Strings 🔴

**Rule**: All user-facing strings MUST use i18n. Hardcoded strings are **FORBIDDEN**.

**What's FORBIDDEN**:
```dart
// ❌ WRONG: Hardcoded
Text('Login')
```

**What's REQUIRED**:
```dart
// ✅ CORRECT: i18n
Text(tr(LocaleKeys.login))
```

---

### 7. Proper Logging 🔴

**Rule**: Use proper logging framework. `print()` / `println()` / `fmt.Println()` are **FORBIDDEN** in production code.

**Client (Dart)**:
```dart
// ❌ WRONG
print('User logged in');

// ✅ CORRECT
LoggingService.info('User logged in');
```

**Station (Go)**:
```go
// ❌ WRONG
fmt.Println("Processing request")

// ✅ CORRECT
logger.Info(ctx, "Processing request")
```

**See**: [35-lib-usage.md](../../30-STATION/35-lib-usage.md) for Station logging details.

---

## 🚨 L1: Mandatory Actions (MUST Execute)

These are the **required steps** that MUST be executed before reporting completion. Non-negotiable.

### Verification Steps (Execute in Order) 🚨

After completing any code implementation, you MUST execute these steps **in order**:

#### 1. Lint Check 🚨

**Client**:
```bash
cd client/desktop  # or client/mobile
flutter analyze
```

**Station**:
```bash
cd station
gofmt -l .  # Should output nothing
```

**Expected**: Zero errors, zero warnings

**If Failed**: 
- Read all error messages carefully
- Fix ALL issues
- Re-run lint
- **DO NOT** report "done" until lint passes

---

#### 2. Build Check 🚨

**Client (Desktop)**:
```bash
cd client/desktop

# macOS
flutter build macos --debug

# Windows  
flutter build windows --debug

# Linux
flutter build linux --debug
```

**Station**:
```bash
cd station/app
go build -o /tmp/station-test .
```

**Expected**: Build succeeds without errors

**If Failed**:
- Read compilation errors
- Fix imports, types, syntax
- Re-build
- **DO NOT** report "done" until build succeeds

---

#### 3. Test Check 🚨

**Client**:
```bash
cd client/desktop  # or client/mobile
flutter test
```

**Station**:
```bash
cd station
go test ./...
```

**Expected**: All tests pass

**If Failed**:
- Analyze failing tests
- Fix code or update tests
- Re-run tests
- If cannot fix after multiple attempts, report to user with details
- **DO NOT** report "done" if tests fail

---

### Reporting Completion Standard 🚨

**Only report "task completed" when ALL of these are true:**

1. ✅ Code implementation is complete
2. ✅ Lint passes (0 errors, 0 warnings)
3. ✅ Build succeeds
4. ✅ Tests pass (all of them)
5. ✅ Functional verification done (if applicable)

**Report Template** (use this when all checks pass):

```
✅ Task completed

## Implementation
- [What was implemented]

## Verification Results
- ✅ Lint Check: Passed (0 errors, 0 warnings)
- ✅ Build Check: Success
- ✅ Test Check: All tests passed (X/X)
- ✅ Functional Test: Verified working

## Modified Files
- [file1.dart](file:///path/to/file1.dart)
- [file2.go](file:///path/to/file2.go)
```

---

## ⭐️ L2: Best Practices (STRONGLY Recommended)

These are **strongly recommended** practices. While not mandatory, ignoring them will lead to technical debt.

### Code Style ⭐️

1. **Single quotes** for strings (Dart)
   ```dart
   final name = 'Alice';  // ✅
   final name = "Alice";  // ❌
   ```

2. **Use `final`** for non-reassigned variables
   ```dart
   final count = 10;  // ✅
   var count = 10;    // ❌ (if not reassigned)
   ```

3. **Always use braces** for flow control
   ```dart
   if (condition) {    // ✅
     doSomething();
   }
   
   if (condition) doSomething();  // ❌
   ```

4. **Context everywhere** (Go)
   ```go
   func DoSomething(ctx context.Context) error {  // ✅
       logger.Info(ctx, "doing something")
       return someOperation(ctx)
   }
   ```

### Error Handling ⭐️

**Go**: Always check errors
```go
// ✅ CORRECT
result, err := doSomething()
if err != nil {
    return fmt.Errorf("failed to do something: %w", err)
}

// ❌ WRONG
result, _ := doSomething()  // Ignoring errors
```

**Dart**: Use try-catch for async operations
```dart
// ✅ CORRECT
try {
  final data = await fetchData();
} catch (e, stackTrace) {
  LoggingService.error('Failed to fetch data', e, stackTrace);
}
```

### Documentation ⭐️

Write comments that explain **WHY**, not WHAT:
```dart
// ✅ GOOD: Explains reasoning
// We use a delay here to prevent rate limiting from the API
await Future.delayed(Duration(seconds: 1));

// ❌ BAD: States the obvious
// Increment counter by 1
counter++;
```

---

## 💡 L3: Optimization Suggestions (OPTIONAL)

These are **optional optimizations**. Nice to have, but not required.

### File Length 💡
- Target: < 300 lines per file
- Maximum: 500 lines (consider refactoring if exceeded)

### Method Length 💡
- Target: < 20 lines per method
- Maximum: 50 lines (consider refactoring if exceeded)

### Code Organization 💡
- One class, one responsibility
- If class name contains "And", it's probably doing too much

### Performance 💡
- Use `const` constructors when possible (Flutter)
- Lazy initialization for expensive operations
- Cache computed values when appropriate

---

## 📊 Rule Hierarchy Summary

```
Priority   Level  Rule Type              Can Skip?   Consequence if Violated
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 Highest   L0   Architecture Principles    NEVER      Project breaks
🚨 High      L1   Mandatory Actions          NEVER      Quality fails
⭐️ Medium    L2   Best Practices            AVOID      Technical debt
💡 Low       L3   Optimization Suggestions   OK         Missed optimization
```

---

## 🔧 Conflict Resolution

### When rules conflict:

1. **L0 > L1 > L2 > L3**: Higher level always wins
2. **Specific > General**: Specific platform rules override general rules
3. **Documented Exceptions**: Some L0 rules have documented exceptions (e.g., JSON for third-party APIs)

### Example Conflicts:

**Scenario**: "Should I use JSON for this Station-Desktop API?"
- L0 says: Use Proto
- Exception: Only if absolutely necessary
- **Resolution**: Use Proto unless you have a documented reason for JSON

**Scenario**: "Lint found 2 warnings, but build succeeds. Can I report done?"
- L1 says: Lint must pass (0 warnings)
- **Resolution**: Fix the warnings first, then report done

---

## 📚 Related Documents

| Topic | Document | Priority |
|-------|----------|----------|
| Workflow | [14-workflow.md](./14-workflow.md) | 🚨 L1 |
| Coding Standards | [13-coding-standards.md](./13-coding-standards.md) | ⭐️ L2 |
| Proto Models | [12-domain-model.md](./12-domain-model.md) | 🔴 L0 |
| Desktop Rules | [21-DESKTOP/21.0-base.md](../20-CLIENT/21-DESKTOP/21.0-base.md) | Platform |
| Station Libraries | [30-STATION/35-lib-usage.md](../30-STATION/35-lib-usage.md) | 🔴 L0 |

---

## ✅ Quick Self-Check

Before reporting "task completed", ask yourself:

- [ ] Did I define all models in `.proto` files? (L0)
- [ ] Did I avoid `StatefulWidget`? (L0)
- [ ] Did I use package imports? (L0)
- [ ] Did I run `flutter analyze` / `gofmt` and it passed? (L1)
- [ ] Did I run build and it succeeded? (L1)
- [ ] Did I run tests and they all passed? (L1)
- [ ] Did I use proper logging (not `print()`)?  (L0)

If ANY answer is "No", **do not report completion** - fix it first.

---

*These principles are the foundation of Peers-Touch. When in doubt, come back here.*
