# Domain Models: Proto-First Architecture

> **The Single Source of Truth for All Data Structures**

---

## 🎯 Core Principle

**ALL data models in Peers-Touch MUST be defined in Protocol Buffer (.proto) files.**

This is non-negotiable. Manual model creation is strictly forbidden.

---

## 📍 Model Location

**Source**: `model/domain/*.proto`

**Generated Files**:
- **Dart (Client)**: `client/common/peers_touch_base/lib/model/domain/`
- **Go (Station)**: `station/app/subserver/*/model/`

---

## 🔄 Generation Workflow

### 1. Define Model in Proto

```protobuf
// model/domain/actor/actor.proto
syntax = "proto3";

package peers_touch.model.actor.v1;

option go_package = "github.com/peers-labs/peers-touch/station/app/model;model";

message Actor {
  string id = 1;
  string handle = 2;
  string display_name = 3;
  string avatar_url = 4;
  string bio = 5;
  google.protobuf.Timestamp created_at = 6;
}
```

### 2. Generate for Dart (Client)

```bash
cd model
protoc --dart_out=../client/common/peers_touch_base/lib/model/domain \
       --proto_path=. \
       domain/actor/actor.proto
```

### 3. Generate for Go (Station)

```bash
cd model
protoc --go_out=../station/app/subserver/auth/model \
       --proto_path=. \
       domain/actor/actor.proto
```

### 4. Use in Code

**Dart (Client)**:
```dart
import 'package:peers_touch_base/model/domain/actor/actor.pb.dart';

final actor = Actor()
  ..id = '123'
  ..handle = 'alice'
  ..displayName = 'Alice';
```

**Go (Station)**:
```go
import "github.com/peers-labs/peers-touch/station/app/model"

actor := &model.Actor{
    Id: "123",
    Handle: "alice",
    DisplayName: "Alice",
}
```

---

## 📦 Existing Domain Models

### Core Models

| Proto File | Purpose | Used By |
|-----------|---------|---------|
| `actor/actor.proto` | User/Bot identity | All modules |
| `ai_box/ai_models.proto` | AI model definitions | AI Chat |
| `ai_box/chat.proto` | Chat messages | AI Chat |
| `core/page.proto` | Pagination | All list APIs |

### Adding New Models

**Step 1**: Create `.proto` file in `model/domain/<category>/`

**Step 2**: Define message structure

**Step 3**: Run generation scripts

**Step 4**: Import generated files in client/station code

**Step 5**: NEVER manually edit generated files

---

## ✅ Rules

1. **No Manual Models**: Never create model classes by hand
2. **Proto First**: Always define in .proto before coding
3. **No Edits**: Never edit generated `.pb.dart` or `.pb.go` files
4. **Package Imports**: Always use package imports for generated files
5. **Version Control**: Commit `.proto` files, not generated files (add to .gitignore if needed)

---

## 🚫 Anti-Patterns

### ❌ WRONG: Manual Model

```dart
// DON'T DO THIS
class User {
  final String id;
  final String name;
  
  User({required this.id, required this.name});
}
```

### ✅ CORRECT: Proto-Generated Model

```dart
// DO THIS
import 'package:peers_touch_base/model/domain/actor/actor.pb.dart';

// Use the generated Actor class
final user = Actor()..id = '123'..displayName = 'Alice';
```

---

## 📚 Related Documents

- **Architecture**: [11-architecture.md](./11-architecture.md)
- **Coding Standards**: [13-coding-standards.md](./13-coding-standards.md)

---

*Proto files are the contract between client and station. Treat them as sacred.*
