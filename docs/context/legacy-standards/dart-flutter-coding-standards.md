> **Historical reference (Flutter/GetX era)**. This section was extracted from the original consolidated coding-standards.md.
> Current coding standards live in `docs/global/coding-standards.md` and `docs/global/coding-guide/`.

---

## Dart/Flutter Standards (Client)

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
import 'package:peers_touch_desktop/features<home>/home_page.dart';

// ❌ WRONG: Relative imports
import '../features<home>/home_page.dart';
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

## Architecture Rules (Client - Dart/Flutter)

1. **No StatefulWidget** - Use GetX Controllers
2. **No Relative Imports** - Package imports only
3. **No Manual Models** - Proto-generated only
4. **No Direct Dio** - Use HttpService
5. **No Business Logic in Views** - Controllers only
