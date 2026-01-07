# Coding Standards: Universal Rules

> **Code Style Guidelines for All Platforms**

---

## 🎯 Universal Principles

### 1. **Clarity Over Cleverness**
Simple, readable code beats clever code every time.

### 2. **Consistency Over Convenience**
Follow established patterns even if more verbose.

### 3. **Explicit Over Implicit**
Make dependencies and intentions clear.

---

## 📝 Dart/Flutter Standards (Client)

### Import Ordering

```dart
// 1. Dart SDK imports
import 'dart:async';
import 'dart:convert';

// 2. Flutter imports
import 'package:flutter/material.dart';

// 3. Third-party packages
import 'package:get/get.dart';

// 4. Project imports
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
```

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Files/Directories | snake_case | `home_controller.dart` |
| Classes | PascalCase | `HomeController` |
| Variables/Methods | camelCase | `userName`, `fetchData()` |
| Constants | UPPER_SNAKE_CASE | `MAX_PAGE_SIZE` |
| Private | _prefix | `_privateMethod()` |

### String Style

```dart
// ✅ CORRECT: Single quotes
final name = 'Alice';

// ❌ WRONG: Double quotes (unless string contains single quote)
final name = "Alice";
```

### Variable Declarations

```dart
// ✅ CORRECT: Use final for non-reassigned variables
final userName = 'Alice';
final count = 0.obs; // GetX reactive

// ❌ WRONG: Using var when value doesn't change
var userName = 'Alice';
```

### Flow Control

```dart
// ✅ CORRECT: Always use braces
if (condition) {
  doSomething();
}

// ❌ WRONG: No braces
if (condition) doSomething();
```

### Package Imports

```dart
// ✅ CORRECT: Package imports for lib/ files
import 'package:peers_touch_desktop/features/home/view/home_page.dart';

// ❌ WRONG: Relative imports
import '../features/home/view/home_page.dart';
```

### Deprecated APIs

```dart
// ✅ CORRECT: New API
color.withValues(alpha: 0.5)

// ❌ WRONG: Deprecated
color.withOpacity(0.5)
```

### Logging

```dart
// ✅ CORRECT: Use LoggingService
LoggingService.debug('User logged in');
LoggingService.info('Session created for user: $username');
LoggingService.warning('Token refresh failed, retrying...');
LoggingService.error('Failed to connect to server', error, stackTrace);

// ❌ WRONG: Using print() or println()
print('User logged in');
println('Debug info');
```

**Logging Levels:**
- `debug()`: Development debugging info
- `info()`: Important events (login, logout, etc.)
- `warning()`: Recoverable issues
- `error()`: Errors with exception details

---

## 🏗️ Go Standards (Station)

### File Naming
- snake_case: `user_service.go`

### Package Naming
- lowercase, single word: `package auth`

### Variable Naming
- camelCase for private: `userName`
- PascalCase for public: `UserName`

### Error Handling
```go
// ✅ CORRECT: Always check errors
result, err := doSomething()
if err != nil {
    return nil, fmt.Errorf("failed to do something: %w", err)
}

// ❌ WRONG: Ignoring errors
result, _ := doSomething()
```

### Proto Usage
```go
// ✅ CORRECT: Use Proto structs
import "github.com/peers-labs/peers-touch/station/app/model"

actor := &model.Actor{
    Id: "123",
}

// ❌ WRONG: Manual structs
type Actor struct {
    ID string
}
```

---

## 🚫 Universal Anti-Patterns

### ❌ Hardcoded Strings

```dart
// WRONG
Text('Login')

// CORRECT
Text(tr(LocaleKeys.login))
```

### ❌ Magic Numbers

```dart
// WRONG
if (status == 200) { }

// CORRECT
if (status == HttpStatus.ok) { }
```

### ❌ God Classes

```dart
// WRONG: One controller doing everything
class AppController {
  void login() {}
  void fetchPosts() {}
  void sendMessage() {}
  // ... 50 more methods
}

// CORRECT: Separate controllers per feature
class AuthController { void login() {} }
class PostController { void fetchPosts() {} }
class MessageController { void sendMessage() {} }
```

---

## 📐 Architecture Rules

### Client (Dart/Flutter)

1. **No StatefulWidget** - Use GetX Controllers
2. **No Relative Imports** - Package imports only
3. **No Manual Models** - Proto-generated only
4. **No Direct Dio** - Use HttpService
5. **No Business Logic in Views** - Controllers only

### Station (Go)

1. **Use Proto Structs** - No manual models
2. **Check All Errors** - Never ignore errors
3. **Context Everywhere** - Pass context.Context
4. **Structured Logging** - Use logging framework
5. **No Global State** - Dependency injection

---

## 🎨 Code Comments

### When to Comment

```dart
// ✅ GOOD: Explain WHY, not WHAT
// We use a delay here to prevent rate limiting from the API
await Future.delayed(Duration(seconds: 1));

// ❌ BAD: Stating the obvious
// Increment counter by 1
counter++;
```

### Documentation Comments

```dart
/// Fetches user profile from the server.
///
/// Throws [NetworkException] if the request fails.
/// Returns [Actor] on success.
Future<Actor> fetchProfile(String userId) async {
  // ...
}
```

---

## 📊 Code Organization

### File Length
- **Target**: < 300 lines per file
- **Maximum**: 500 lines (refactor if exceeded)

### Method Length
- **Target**: < 20 lines per method
- **Maximum**: 50 lines (refactor if exceeded)

### Class Responsibilities
- **One class, one responsibility**
- If class name contains "And", it's doing too much

---

## 🧪 Testing Standards

### Test File Naming
```
home_controller.dart → home_controller_test.dart
```

### Test Structure
```dart
void main() {
  group('HomeController', () {
    late HomeController controller;
    
    setUp(() {
      controller = HomeController();
    });
    
    test('should fetch posts on init', () {
      // Arrange
      // Act
      // Assert
    });
  });
}
```

---

## 📚 Related Documents

- **Project Identity**: [10-project-identity.md](./10-project-identity.md)
- **Domain Models**: [12-domain-model.md](./12-domain-model.md)
- **Desktop Standards**: [21-DESKTOP/21.0-base.md](../20-CLIENT/21-DESKTOP/21.0-base.md)

---

*These standards ensure code consistency across the entire Peers-Touch codebase.*
