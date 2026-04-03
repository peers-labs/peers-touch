# ADR-003: Proto as Single Source of Truth

**Status**: Accepted  
**Date**: 2024  
**Decision Makers**: Architecture Team

---

## Context

Peers-Touch has three platforms:
- **Desktop** (Flutter/Dart)
- **Mobile** (Flutter/Dart)
- **Station** (Go)

All three need to share the same data models. Options:
1. **Manual models**: Write models separately for each platform
2. **JSON Schema**: Define models in JSON, generate code
3. **Protocol Buffers**: Define models in .proto, generate code
4. **OpenAPI/Swagger**: Define API first, generate models

---

## Decision

**Protocol Buffers (.proto files) are the SINGLE SOURCE OF TRUTH for all data models.**

All models MUST be defined in `model/domain/*.proto` and generated for Dart and Go.

Manual model creation is STRICTLY FORBIDDEN.

---

## Rationale

### Why Protocol Buffers?

1. **Type safety**: Strong typing across platforms
2. **Versioning**: Built-in backward/forward compatibility
3. **Performance**: Binary serialization is fast and compact
4. **Multi-language**: Official support for Dart, Go, and 50+ languages
5. **Tooling**: Excellent IDE support and validation
6. **Documentation**: Proto files are self-documenting

### Why not others?

- **Manual models**: Too error-prone, models drift over time
- **JSON Schema**: Less mature tooling, no binary format
- **OpenAPI**: API-first, not model-first; more complex

---

## Workflow

### 1. Define Model

```protobuf
// model/domain/actor/actor.proto
syntax = "proto3";

package peers_touch.model.actor.v1;

message Actor {
  string id = 1;
  string handle = 2;
  string display_name = 3;
}
```

### 2. Generate for Dart

```bash
protoc --dart_out=client/common/peers_touch_base/lib/model/domain \
       domain/actor/actor.proto
```

### 3. Generate for Go

```bash
protoc --go_out=station/app/model \
       domain/actor/actor.proto
```

### 4. Use in Code

**Dart**:
```dart
import 'package:peers_touch_base/model/domain/actor/actor.pb.dart';

final actor = Actor()
  ..id = '123'
  ..handle = 'alice';
```

**Go**:
```go
import "github.com/peers-labs/peers-touch/station/app/model"

actor := &model.Actor{
    Id: "123",
    Handle: "alice",
}
```

---

## Consequences

### Positive:
- **Consistency**: Same models across all platforms
- **Type safety**: Compile-time errors for mismatches
- **Versioning**: Easy to evolve models
- **Performance**: Fast binary serialization
- **Documentation**: Proto files document the data model

### Negative:
- **Learning curve**: Developers need to learn Proto syntax
- **Build step**: Must run protoc after model changes
- **Boilerplate**: Generated code is verbose (but we don't edit it)

---

## Rules

### ✅ DO:
- Define all models in .proto files
- Use Proto-generated classes in code
- Version your proto files (v1, v2, etc.)
- Document fields with comments

### ❌ DON'T:
- Create manual model classes
- Edit generated .pb.dart or .pb.go files
- Use Map<String, dynamic> for structured data
- Bypass Proto for "quick prototypes"

---

## Enforcement

- **Code review**: Reject any manual model classes
- **Linting**: Detect manual models in client/station code
- **AI prompts**: Explicitly require Proto-generated models
- **Build process**: Fail if generated files are missing

---

## Exceptions

**Very rare exceptions** (must be approved by architecture team):
- Internal-only models that never cross platform boundaries
- Temporary models for refactoring (must be removed within 1 sprint)

---

## Migration Strategy

For existing manual models:
1. Create equivalent .proto definition
2. Generate code
3. Replace manual model with generated model
4. Delete manual model file
5. Update all references

---

## Related Decisions

- [ADR-001: Why GetX](./001-why-getx.md)
- [ADR-002: No StatefulWidget](./002-no-stateful-widget.md)

---

*Proto files are the contract between client and station. This is non-negotiable.*
