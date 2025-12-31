# ADR-002: No StatefulWidget

**Status**: Accepted  
**Date**: 2024  
**Decision Makers**: Architecture Team

---

## Context

Flutter provides two widget types:
- **StatelessWidget**: Immutable, no internal state
- **StatefulWidget**: Mutable, manages internal state with setState()

Most Flutter tutorials teach StatefulWidget first, but it has issues:
- State scattered across many widgets
- Hard to test
- Lifecycle methods (initState, dispose) easy to misuse
- setState() rebuilds entire widget tree
- No clear separation of UI and logic

---

## Decision

**StatefulWidget is FORBIDDEN in Peers-Touch.**

All widgets MUST be StatelessWidget. State is managed externally by GetX Controllers.

---

## Rationale

### Problems with StatefulWidget:
1. **Mixed concerns**: UI and logic in same class
2. **Hard to test**: Need to instantiate widget to test logic
3. **Lifecycle complexity**: initState, didUpdateWidget, dispose, etc.
4. **setState() inefficiency**: Rebuilds entire widget
5. **No dependency injection**: Hard to mock dependencies

### Benefits of StatelessWidget + GetX:
1. **Separation of concerns**: View (UI) vs Controller (logic)
2. **Testable**: Test controllers without widgets
3. **Simple lifecycle**: onInit() and onClose() only
4. **Efficient updates**: Obx() rebuilds only changed parts
5. **DI-friendly**: Controllers injected via Get.find()

---

## Examples

### ❌ WRONG (StatefulWidget):

```dart
class HomePage extends StatefulWidget {
  @override
  _HomePageState createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int counter = 0;
  
  @override
  void initState() {
    super.initState();
    fetchData();
  }
  
  void fetchData() async {
    // Business logic mixed with UI
  }
  
  @override
  Widget build(BuildContext context) {
    return Text('$counter');
  }
}
```

### ✅ CORRECT (StatelessWidget + GetX):

```dart
// Controller (separate file)
class HomeController extends GetxController {
  final counter = 0.obs;
  
  @override
  void onInit() {
    super.onInit();
    fetchData();
  }
  
  Future<void> fetchData() async {
    // Business logic here
  }
}

// View (separate file)
class HomePage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final controller = Get.find<HomeController>();
    
    return Obx(() => Text('${controller.counter}'));
  }
}
```

---

## Consequences

### Positive:
- Clear separation of concerns
- Easy to test controllers
- Consistent architecture
- AI can generate correct code easily
- Better performance (Obx vs setState)

### Negative:
- Learning curve for developers used to StatefulWidget
- Cannot use Flutter's built-in state management
- Requires understanding GetX

---

## Enforcement

- **Code review**: Reject any PR with StatefulWidget
- **Linting**: Add custom lint rule to detect StatefulWidget
- **AI prompts**: Explicitly forbid StatefulWidget in all prompts

---

## Exceptions

**NONE**. There are no valid exceptions to this rule.

Even for simple cases like TextEditingController, use GetX:

```dart
class MyController extends GetxController {
  final textController = TextEditingController();
  
  @override
  void onClose() {
    textController.dispose();
    super.onClose();
  }
}
```

---

## Related Decisions

- [ADR-001: Why GetX](./001-why-getx.md)
- [ADR-003: Proto as Source](./003-proto-as-source.md)

---

*This is a non-negotiable architectural principle.*
