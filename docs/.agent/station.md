# Station Agent Entry

> Load this file when working on `apps/station/`.
> Parent rules: [AGENTS.md](../../AGENTS.md)

---

## 1. Role Of This File

This file is an **Agent navigation + guardrail entry**, not the Station architecture or coding-standard source of truth.

Use it to answer:

- Which Station documents must be read first
- Which hard constraints cannot be violated
- Which verification commands must run before completion

Do **not** use this file as the place to redefine Station architecture, Subserver design, or full Go coding standards.

---

## 2. Read These Sources First

### Platform Sources

- [Station Base](file://docs/station/base.md)
- [App Layer](file://docs/station/app-layer.md)
- [Frame Layer](file://docs/station/frame-layer.md)
- [Subserver Standard](file://docs/station/subserver-standard.md)

### Architecture Sources

- [Project Architecture](file://docs/global/architecture.md)
- [Station/Desktop Scope Boundary](file://docs/architecture/boundaries/station-desktop-scope-boundary.md)
- [Unified Handler Architecture](file://docs/architecture/runtime/unified-handler-architecture.md)

### Specification Sources

- [Station Coding Guide](file://docs/global/coding-guide/station)
- [Common Coding Guide](file://docs/global/coding-guide/common)

---

## 3. Hard Constraints

- Use proto-generated models; do not create manual parallel domain models.
- Station business code must follow DDD/Subserver boundaries; do not collapse all logic into handlers.
- Always pass `context.Context` through call chains where the platform standard requires it.
- Use project logging facilities; do not use `fmt.Println`, stdlib `log.*`, or ad-hoc debug logging.
- Do not introduce global mutable state when dependency injection or scoped state is the intended design.
- Error handling must be explicit; do not silently swallow errors.

---

## 4. Verification Commands

```bash
cd apps/station
gofmt -l .
go test ./...
./tooling/scripts/check-go-style.sh
```

---

## 5. What This File Does Not Define

- It does not define the full Station architecture body.
- It does not define the complete Subserver structure specification.
- It does not define the full Go coding standard text.

If you need those answers, go to the linked source documents above.
