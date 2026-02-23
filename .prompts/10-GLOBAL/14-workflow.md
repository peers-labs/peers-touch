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

## 🤖 AI Agent Workflow (MUST READ)

> **For AI Assistants**: This section defines the mandatory workflow you MUST follow when completing any task.

### ⚠️ Task Completion Standard

**You can ONLY report "task completed" when ALL of these conditions are met:**

1. ✅ **Code Implementation Complete**: Feature fully implemented according to requirements
2. 🚨 **Lint Passed**: Zero errors, zero warnings
3. 🚨 **Build Succeeded**: Code compiles without errors
4. 🚨 **Tests Passed**: All relevant tests pass
5. ✅ **Functional Verification**: Manually tested and working (when applicable)

**If ANY condition is not met, you MUST fix it before reporting completion. NO EXCEPTIONS.**

---

### 📋 Mandatory Verification Steps (Execute in Order)

After implementing code, execute these steps **in order**. Each step is **mandatory** (🚨).

#### Step 1: 🚨 Lint Check (MANDATORY)

**Client (Dart/Flutter)**:
```bash
cd client/desktop  # or client/mobile
flutter analyze
```

**Station (Go)**:
```bash
cd station
gofmt -l .  # Should output NOTHING
```

**Expected Result**: 0 errors, 0 warnings

**If Failed**:
1. Read ALL error/warning messages carefully
2. Fix EVERY issue (one by one)
3. Re-run lint until it passes
4. **DO NOT skip this step**
5. **DO NOT report "done" until lint passes**

---

#### Step 2: 🚨 Build Check (MANDATORY)

**Client (Desktop)**:
```bash
cd client/desktop

# Choose your platform:
flutter build macos --debug    # macOS
flutter build windows --debug  # Windows
flutter build linux --debug    # Linux
```

**Station**:
```bash
cd station/app
go build -o /tmp/station-test .
```

**Expected Result**: Build succeeds without errors

**If Failed**:
1. Read the FIRST error carefully (later errors may be cascading)
2. Check imports, types, and syntax
3. Fix the error
4. Re-build
5. **DO NOT skip this step**
6. **DO NOT report "done" until build succeeds**

---

#### Step 3: 🚨 Test Check (MANDATORY)

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

**Expected Result**: All tests pass

**If Failed**:
1. Run with verbose flag: `flutter test -v` or `go test -v ./...`
2. Analyze WHY tests failed:
   - New bug in code?
   - Tests need updating?
   - Test data mismatch?
3. Fix code OR update tests
4. Re-run tests
5. **If you cannot fix after multiple attempts**: Report to user with details, do NOT claim completion
6. **DO NOT report "done" if tests fail**

---

#### Step 4: ✅ Functional Verification (RECOMMENDED)

While not strictly mandatory, you should:
- Launch the application
- Manually test the implemented feature
- Check logs for errors
- Test edge cases

---

### 📝 Completion Report Template

**ONLY use this template after ALL mandatory steps (🚨) have passed:**

```markdown
✅ Task Completed

## Implementation
- [List what was implemented]
- [Key changes made]

## Verification Results
- ✅ Lint Check: Passed (0 errors, 0 warnings)
- ✅ Build Check: Success
- ✅ Test Check: All tests passed (X/Y)
- ✅ Functional Test: Manually verified working

## Modified Files
- [file1.dart](file:///path/to/file1.dart)
- [file2.go](file:///path/to/file2.go)

## Notes (if any)
- [Usage instructions or known limitations]
```

---

### 🔧 Failure Handling Procedures

#### When Lint Fails

```
STEP 1: Read all error/warning messages
STEP 2: Understand each issue
STEP 3: Fix according to coding standards (see 13-coding-standards.md)
STEP 4: Re-run flutter analyze / gofmt
STEP 5: Repeat until clean
STEP 6: ⚠️ DO NOT report completion until lint passes
```

**Common lint issues**:
- Unused imports: Remove them
- Unused variables: Remove or use them
- Missing `const`: Add `const` where suggested
- Code formatting: Run `dart format .` or `gofmt -w .`

---

#### When Build Fails

```
STEP 1: Read the compilation error output FULLY
STEP 2: Find the FIRST error (ignore cascading errors)
STEP 3: Check:
   - Are imports correct?
   - Are types matching?
   - Is syntax correct?
STEP 4: Fix the error
STEP 5: Re-build
STEP 6: ⚠️ DO NOT report completion until build succeeds
```

**Common build issues**:
- Import not found: Check package name and path
- Type mismatch: Check variable/parameter types
- Missing dependency: Check `pubspec.yaml` or `go.mod`

---

#### When Tests Fail

```
STEP 1: Run with verbose: flutter test -v / go test -v ./...
STEP 2: Identify WHICH test failed
STEP 3: Analyze WHY:
   Option A: New code introduced a bug → Fix code
   Option B: Test needs updating → Update test
   Option C: Test data is wrong → Fix test data
STEP 4: Make the fix
STEP 5: Re-run tests
STEP 6: If fixed, continue. If not, repeat analysis.
STEP 7: If you CANNOT fix after 2-3 attempts, report to user:
   
   ⚠️ Implementation complete, but tests failing
   
   Failed test: test/path/test_name
   Error message: [exact error]
   
   Attempted fixes:
   - [What you tried]
   
   Need guidance: Should I modify code or update tests?
```

---

### 🚫 Common Mistakes to AVOID

#### ❌ Mistake 1: Reporting Completion Without Verification

**WRONG**:
```
"I've implemented the feature. Code is in feature_page.dart"
```

**Problem**: No lint, no build, no tests run

**CORRECT**:
```
Implement → Lint → Build → Test → Functional Check → Report Complete
```

---

#### ❌ Mistake 2: Asking User About Lint Errors

**WRONG**:
```
"flutter analyze found 3 warnings. Should I fix them?"
```

**Problem**: Lint errors/warnings MUST be fixed, no questions asked

**CORRECT**:
```
[Silently fix all lint issues, then continue]
```

---

#### ❌ Mistake 3: Skipping Tests

**WRONG**:
```
"Feature implemented and manually tested successfully"
(without running flutter test / go test)
```

**Problem**: Automated tests are MANDATORY, not optional

**CORRECT**:
```
[Always run automated tests, even if manual test passed]
```

---

#### ❌ Mistake 4: Reporting Incomplete Work

**WRONG**:
```
"Feature is 90% done, just needs some polish"
```

**Problem**: "90% done" is NOT done

**CORRECT**:
```
[Complete 100% of implementation + all verification steps]
```

---

### ✅ AI Self-Check Checklist

Before reporting "Task Completed", verify:

- [ ] 🚨 Ran Lint Check and it PASSED (0 errors, 0 warnings)
- [ ] 🚨 Ran Build Check and it SUCCEEDED
- [ ] 🚨 Ran Test Check and ALL tests PASSED
- [ ] ✅ Did functional verification (if applicable)
- [ ] 📝 Prepared completion report with verification results
- [ ] ⚠️ If any failed, fixed it OR reported to user

**Only when ALL boxes are checked can you report "Completed".**

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
