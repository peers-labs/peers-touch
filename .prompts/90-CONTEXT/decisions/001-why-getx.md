# ADR-001: Why GetX for State Management?

**Status**: Accepted  
**Date**: 2024  
**Decision Makers**: Architecture Team

---

## Context

Flutter offers multiple state management solutions:
- Provider
- Riverpod
- Bloc/Cubit
- GetX
- MobX
- Redux

We needed to choose one for Peers-Touch that would:
1. Handle complex state across multiple screens
2. Provide dependency injection
3. Support routing
4. Be easy for AI to understand and generate code for
5. Have good performance

---

## Decision

We chose **GetX** as the unified solution for:
- State management (reactive variables)
- Dependency injection (Get.put/Get.lazyPut)
- Routing (Get.to/Get.toNamed)

---

## Rationale

### Pros of GetX:
1. **All-in-one**: State + DI + Routing in one package
2. **Simple API**: Easy to learn and use
3. **Minimal boilerplate**: Less code than Bloc or Provider
4. **Performance**: Reactive updates only where needed
5. **AI-friendly**: Clear patterns that AI can follow
6. **Automatic disposal**: Controllers auto-dispose when not needed

### Cons of GetX:
1. **Opinionated**: Forces a specific architecture
2. **Community split**: Some Flutter devs prefer other solutions
3. **Magic**: Uses reflection and global state (some consider this "bad practice")

### Why not others?
- **Provider**: Too much boilerplate, no routing
- **Bloc**: Excellent but verbose, steep learning curve
- **Riverpod**: Modern but complex, less AI-friendly

---

## Consequences

### Positive:
- Consistent code patterns across all features
- Fast development (less boilerplate)
- Easy for AI to generate correct code
- Good performance

### Negative:
- Locked into GetX ecosystem
- Some developers may prefer other solutions
- Global state can be abused if not careful

---

## Enforcement

- **Mandatory**: All new features MUST use GetX
- **Forbidden**: StatefulWidget (use GetX Controllers instead)
- **Required**: All Controllers extend GetxController
- **Required**: All state uses Rx variables (.obs)

---

## Related Decisions

- [ADR-002: No StatefulWidget](./002-no-stateful-widget.md)

---

*This decision is foundational to the Peers-Touch architecture and should not be changed lightly.*
