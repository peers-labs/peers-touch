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

## 🧪 Testing Workflow

### Run Tests

```bash
# Client tests
cd client/desktop
flutter test

# Station tests
cd station
go test ./...
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
