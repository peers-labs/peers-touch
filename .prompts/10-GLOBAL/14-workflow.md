# Development Workflow

> **How to Work on Peers-Touch**

---

## 🚀 Getting Started

### 1. **Understand the Project**
- Read [10-project-identity.md](./10-project-identity.md)
- Read [11-architecture.md](./11-architecture.md)
- Read [12-domain-model.md](./12-domain-model.md)

### 2. **Choose Your Platform**
- Desktop → [21-DESKTOP/21.0-base.md](../20-CLIENT/21-DESKTOP/21.0-base.md)
- Mobile → [22-MOBILE/22.0-base.md](../20-CLIENT/22-MOBILE/22.0-base.md)
- Station → [30-STATION/30-station-base.md](../30-STATION/30-station-base.md)

### 3. **Set Up Development Environment**
- Install Flutter SDK (for client)
- Install Go (for station)
- Install protoc (for model generation)

---

## 📋 Feature Development Process

### Step 1: Define Models (if needed)

If your feature requires new data structures:

```bash
# 1. Create .proto file
cd model/domain
mkdir my_feature
vim my_feature/my_model.proto

# 2. Generate for Dart
protoc --dart_out=../../client/common/peers_touch_base/lib/model/domain \
       --proto_path=. \
       domain/my_feature/my_model.proto

# 3. Generate for Go
protoc --go_out=../../station/app/subserver/my_feature/model \
       --proto_path=. \
       domain/my_feature/my_model.proto
```

### Step 2: Create Feature Module (Client)

```bash
cd client/desktop/lib/features
mkdir my_feature
cd my_feature

# Create structure
mkdir controller view model
touch my_feature_binding.dart
touch controller/my_feature_controller.dart
touch view/my_feature_page.dart
```

### Step 3: Implement Controller

```dart
// controller/my_feature_controller.dart
import 'package:get/get.dart';

class MyFeatureController extends GetxController {
  final _data = Rx<MyModel?>(null);
  MyModel? get data => _data.value;
  
  @override
  void onInit() {
    super.onInit();
    _fetchData();
  }
  
  Future<void> _fetchData() async {
    // Implementation
  }
}
```

### Step 4: Implement View

```dart
// view/my_feature_page.dart
import 'package:flutter/material.dart';
import 'package:get/get.dart';

class MyFeaturePage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final controller = Get.find<MyFeatureController>();
    
    return Scaffold(
      body: Obx(() => controller.data != null
        ? Text(controller.data!.name)
        : CircularProgressIndicator()),
    );
  }
}
```

### Step 5: Create Binding

```dart
// my_feature_binding.dart
import 'package:get/get.dart';

class MyFeatureBinding extends Bindings {
  @override
  void dependencies() {
    Get.lazyPut(() => MyFeatureController());
  }
}
```

### Step 6: Register Route

```dart
// app/routes/app_pages.dart
GetPage(
  name: AppRoutes.myFeature,
  page: () => MyFeaturePage(),
  binding: MyFeatureBinding(),
),
```

---

## 🧪 Quality Assurance Workflow

### Before Committing Code

**ALWAYS run these checks before committing:**

#### 1. **Lint Check** (Code Style)

**Client (Dart/Flutter)**:

```bash
cd client/desktop
flutter analyze
```

**Configuration files** (automatically detected):
- Desktop: `client/desktop/analysis_options.yaml`
- Mobile: `client/mobile/analysis_options.yaml`
- Base: `client/common/peers_touch_base/analysis_options.yaml`
- UI: `client/common/peers_touch_ui/analysis_options.yaml`
- Root: `client/analysis_options.yaml`

**How it works**:
- Flutter automatically finds and uses `analysis_options.yaml` in the current directory or parent directories
- No need to specify the config file path manually
- If file doesn't exist, Flutter uses default rules

**Station (Go)**:

```bash
cd station

# Format check (built-in)
gofmt -l .  # List files that need formatting

# Lint check (if golangci-lint is installed)
golangci-lint run
```

**Configuration files** (automatically detected):
- Station: `station/.golangci.yml`
- Root: `.golangci.yml` (at repository root)

**How it works**:
- `gofmt`: Built-in Go formatter, no config needed
- `golangci-lint`: Automatically finds `.golangci.yml` in current or parent directories
- If golangci-lint not installed: `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest`

**Expected result**: No errors or warnings

#### 2. **Build Check** (Compilation)

```bash
# Client (Desktop)
cd client/desktop

# macOS
flutter build macos --debug

# Windows
flutter build windows --debug

# Linux
flutter build linux --debug

# Client (Mobile)
cd client/mobile

# Android
flutter build apk --debug

# iOS (macOS only)
flutter build ios --debug

# Station (Go)
cd station/app

# Unix-like (macOS/Linux)
go build -o /tmp/station-test .

# Windows
go build -o %TEMP%\station-test.exe .
```

**Expected result**: Build succeeds without errors

#### 3. **Test Check** (Unit/Integration Tests)

```bash
# Client tests
cd client/desktop
flutter test

# Station tests
cd station
go test ./...
```

**Expected result**: All tests pass

---

### Quality Checklist

Before marking a task as "done", verify:

- [ ] **Lint passes**: `flutter analyze` or `gofmt` shows no errors
- [ ] **Build succeeds**: Application compiles without errors
- [ ] **Tests pass**: All unit tests pass
- [ ] **No debug code**: No `print()`, `console.log`, or debug statements
- [ ] **Documentation updated**: API docs, comments, and prompts are current
- [ ] **Code reviewed**: Self-review against coding standards

---

### Automated Quality Gates (Recommended)

Set up pre-commit hooks to automatically run checks:

**Unix-like (macOS/Linux)** - `.git/hooks/pre-commit`:

```bash
#!/bin/bash

echo "Running quality checks..."

# Lint - Client
cd client/desktop && flutter analyze
if [ $? -ne 0 ]; then
    echo "❌ Flutter analyze failed"
    exit 1
fi

# Lint - Station
cd ../../station && gofmt -l . | grep -q .
if [ $? -eq 0 ]; then
    echo "❌ Go format check failed. Run: gofmt -w ."
    exit 1
fi

# Build - Client (choose your platform)
cd ../client/desktop && flutter build macos --debug  # or windows/linux
if [ $? -ne 0 ]; then
    echo "❌ Client build failed"
    exit 1
fi

# Build - Station
cd ../../station/app && go build -o /tmp/station-test .
if [ $? -ne 0 ]; then
    echo "❌ Station build failed"
    exit 1
fi

echo "✅ All checks passed"
```

**Windows** - `.git/hooks/pre-commit` (Git Bash):

```bash
#!/bin/bash

echo "Running quality checks..."

# Lint - Client
cd client/desktop && flutter analyze
if [ $? -ne 0 ]; then
    echo "❌ Flutter analyze failed"
    exit 1
fi

# Lint - Station
cd ../../station && gofmt -l . | findstr /R "."
if [ $? -eq 0 ]; then
    echo "❌ Go format check failed. Run: gofmt -w ."
    exit 1
fi

# Build - Client
cd ../client/desktop && flutter build windows --debug
if [ $? -ne 0 ]; then
    echo "❌ Client build failed"
    exit 1
fi

# Build - Station
cd ../../station/app && go build -o %TEMP%/station-test.exe .
if [ $? -ne 0 ]; then
    echo "❌ Station build failed"
    exit 1
fi

echo "✅ All checks passed"
```

**Note**: Make the hook executable:
```bash
# Unix-like
chmod +x .git/hooks/pre-commit

# Windows (Git Bash)
chmod +x .git/hooks/pre-commit
```

### Write Tests

```dart
// test/features/my_feature/controller/my_feature_controller_test.dart
void main() {
  group('MyFeatureController', () {
    test('should fetch data on init', () async {
      // Arrange
      final controller = MyFeatureController();
      
      // Act
      controller.onInit();
      await Future.delayed(Duration(milliseconds: 100));
      
      // Assert
      expect(controller.data, isNotNull);
    });
  });
}
```

---

## 🔍 Code Review Checklist

Before submitting code, verify:

- [ ] All models are Proto-generated (no manual models)
- [ ] All widgets are StatelessWidget (no StatefulWidget)
- [ ] All imports are package imports (no relative imports)
- [ ] All strings are i18n (no hardcoded strings)
- [ ] All state is in Controllers (no state in Views)
- [ ] Code follows naming conventions
- [ ] Tests are written and passing
- [ ] No console.log or print() statements
- [ ] Documentation is updated

---

## 📚 Related Documents

- **Coding Standards**: [13-coding-standards.md](./13-coding-standards.md)
- **Architecture**: [11-architecture.md](./11-architecture.md)

---

*Follow this workflow to maintain code quality and consistency.*
